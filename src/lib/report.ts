import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { copySheet, recalcOnLoad, writeCells, type CellValue } from './xlsx';
import type { SheetCells } from './expenses';
import { sql } from './db';
import { listStaff, listStores, punchesBetween, ratesFor } from './data';
import { buildReportRows, type ReportRow } from './calc';
import { daysInMonth, ymd, jstParts } from './time';

export const FIRST_ROW = 19;  // アルバイト・パート欄の1行目
export const LAST_ROW = 53;   // （当月異動者）欄の手前まで
const EXPENSE_PART = 'xl/worksheets/sheet2.xml'; // 現金経費精算
const TRAVEL_PART = 'xl/worksheets/sheet3.xml';  // 旅費精算

export async function reportData(year: number, month: number) {
  const from = ymd(year, month, 1), to = ymd(year, month, daysInMonth(year, month));
  const [staff, stores, punches] = await Promise.all([listStaff({ includeInactive: true }), listStores(true), punchesBetween(from, to)]);
  const hourly = staff.filter((s) => s.pay_type === 'hourly');
  const rates = await ratesFor(hourly.map((s) => s.id));
  const byDay = new Map<string, { staffId: number; date: string; punches: { kind: 'in' | 'break_start' | 'break_end' | 'out'; minute: number }[] }>();
  const today = jstParts().date;
  for (const p of punches) {
    if (p.work_date >= today) continue; // 今日（勤務中の人がいる日）は締めの対象にしない
    const k = `${p.staff_id}|${p.work_date}`;
    const e = byDay.get(k) ?? { staffId: p.staff_id, date: p.work_date, punches: [] };
    e.punches.push({ kind: p.kind, minute: p.minute });
    byDay.set(k, e);
  }
  const storeOrder = new Map(stores.map((s) => [s.id, s.sort]));
  const sorted = [...hourly].sort((a, b) => (storeOrder.get(a.store_id ?? 0) ?? 99) - (storeOrder.get(b.store_id ?? 0) ?? 99) || a.sort - b.sort || a.id - b.id);
  const res = buildReportRows({
    staff: sorted.map((s) => ({
      id: s.id, name: s.name, store: stores.find((x) => x.id === s.store_id)?.name ?? '', employment: s.employment,
      transport: s.transport_per_day, commuteMeans: s.commute_means, rates: rates.get(s.id) ?? [],
    })),
    days: [...byDay.values()],
  });
  const [{ pay_day }] = await sql<{ pay_day: number }[]>`select pay_day from settings where id = 1`;
  return { ...res, header: { m: month, last: daysInMonth(year, month), payM: month === 12 ? 1 : month + 1, payD: pay_day } };
}

/** 給与報告フォーム（税理士事務所の書式）に記入した Excel を作る。計算式・書式はひな形のまま。
 *  sheets：「現金経費精算」「旅費精算」に書くもの（旅費精算が2枚以上なら、シートを複製して足す） */
export async function buildReportXlsx(rows: ReportRow[], header: { m: number; last: number; payM: number; payD: number }, sheets: SheetCells[] = []): Promise<Uint8Array> {
  if (rows.length > LAST_ROW - FIRST_ROW + 1) throw new Error(`行数がフォームの上限（${LAST_ROW - FIRST_ROW + 1}行）を超えています`);
  const tpl = await readFile(join(process.cwd(), 'templates/kyuyo_houkoku_template.xlsx'));
  const zip = await JSZip.loadAsync(tpl);
  const cells: [string, CellValue][] = [];
  const set = (ref: string, v: CellValue) => cells.push([ref, v]);
  set('F3', header.m); set('H3', header.last); set('K3', header.payM); set('M3', header.payD);
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) for (const c of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'O', 'P', 'Q', 'R', 'S', 'T', 'U']) set(`${c}${r}`, null);
  rows.forEach((d, i) => {
    const r = FIRST_ROW + i, s = (k: string, v: CellValue) => set(`${k}${r}`, v);
    s('A', '×'); s('B', d.store); s('C', d.name); s('D', d.employment); s('E', '時給'); s('F', d.days);
    s('G', Math.floor(d.regularMin / 60)); s('H', d.regularMin % 60);
    if (d.overtimeMin) { s('I', Math.floor(d.overtimeMin / 60)); s('J', d.overtimeMin % 60); }
    s('K', d.hourly);
    if (d.nightPay) s('P', d.nightPay);
    if (d.transport) { s('R', d.commuteMeans ?? '電車'); s('S', d.transport); }
    s('M', { f: `ROUND(((G${r}+H${r}/60)*K${r}),0)+(F${r}*L${r})` });
    s('N', { f: `ROUND((ROUND(K${r}*1.25,3)*(I${r}+J${r}/60)+ROUND(L${r}/8*1.25,3)*(I${r}+J${r}/60)),0)` });
    s('V', { f: `S${r}*F${r}+T${r}+U${r}` });
    s('W', { f: `M${r}+N${r}+O${r}+P${r}+Q${r}+V${r}` });
    s('Z', '有・無'); s('AA', '有・無');
  });
  await writeCells(zip, 'xl/worksheets/sheet1.xml', cells);

  // 現金経費精算・旅費精算（旅費精算の2枚目からは、書き込む前のひな形を複製）
  const expense = sheets.find((x) => x.kind === 'expense');
  const travels = sheets.filter((x) => x.kind === 'travel');
  const parts = [TRAVEL_PART];
  for (let i = 1; i < travels.length; i++) parts.push(await copySheet(zip, TRAVEL_PART, travels[i].name));
  if (expense) await writeCells(zip, EXPENSE_PART, expense.cells);
  for (let i = 0; i < travels.length; i++) await writeCells(zip, parts[i], travels[i].cells);

  await recalcOnLoad(zip);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
