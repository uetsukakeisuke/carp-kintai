import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { sql } from './db';
import { listStaff, listStores, punchesBetween, ratesFor } from './data';
import { buildReportRows, type ReportRow } from './calc';
import { daysInMonth, ymd, jstParts } from './time';

export const FIRST_ROW = 19;  // アルバイト・パート欄の1行目
export const LAST_ROW = 53;   // （当月異動者）欄の手前まで

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

/** 給与報告フォーム（税理士事務所の書式）に記入した Excel を作る。計算式・書式はひな形のまま。 */
export async function buildReportXlsx(rows: ReportRow[], header: { m: number; last: number; payM: number; payD: number }): Promise<Uint8Array> {
  if (rows.length > LAST_ROW - FIRST_ROW + 1) throw new Error(`行数がフォームの上限（${LAST_ROW - FIRST_ROW + 1}行）を超えています`);
  const tpl = await readFile(join(process.cwd(), 'templates/kyuyo_houkoku_template.xlsx'));
  const zip = await JSZip.loadAsync(tpl);
  const sp = 'xl/worksheets/sheet1.xml';
  const doc = new DOMParser().parseFromString(await zip.file(sp)!.async('string'), 'application/xml');
  const NS = doc.documentElement.namespaceURI!;
  const sd = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
  const colN = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const split = (ref: string) => { const m = /^([A-Z]+)(\d+)$/.exec(ref)!; return [m[1], Number(m[2])] as const; };
  const kids = (el: Element) => Array.from(el.childNodes as unknown as ArrayLike<Node>).filter((x) => x.nodeType === 1) as Element[];
  function rowEl(n: number) {
    let before: Element | null = null;
    for (const r of kids(sd)) { const rn = Number(r.getAttribute('r')); if (rn === n) return r; if (rn > n) { before = r; break; } }
    const r = doc.createElementNS(NS, 'row'); r.setAttribute('r', String(n)); sd.insertBefore(r, before); return r;
  }
  function cellEl(ref: string) {
    const [c, n] = split(ref), row = rowEl(n);
    let before: Element | null = null;
    for (const x of kids(row)) { const xr = x.getAttribute('r')!; if (xr === ref) return x; if (colN(split(xr)[0]) > colN(c)) { before = x; break; } }
    const x = doc.createElementNS(NS, 'c'); x.setAttribute('r', ref); row.insertBefore(x, before); return x;
  }
  function set(ref: string, v: string | number | { f: string } | null) {
    const c = cellEl(ref);
    while (c.firstChild) c.removeChild(c.firstChild);
    c.removeAttribute('t');
    if (v === null || v === '') return;
    if (typeof v === 'number') { const e = doc.createElementNS(NS, 'v'); e.appendChild(doc.createTextNode(String(v))); c.appendChild(e); }
    else if (typeof v === 'object') { const e = doc.createElementNS(NS, 'f'); e.appendChild(doc.createTextNode(v.f)); c.appendChild(e); }
    else { c.setAttribute('t', 'inlineStr'); const is = doc.createElementNS(NS, 'is'), t = doc.createElementNS(NS, 't'); t.appendChild(doc.createTextNode(v)); is.appendChild(t); c.appendChild(is); }
  }
  set('F3', header.m); set('H3', header.last); set('K3', header.payM); set('M3', header.payD);
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) for (const c of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'O', 'P', 'Q', 'R', 'S', 'T', 'U']) set(`${c}${r}`, null);
  rows.forEach((d, i) => {
    const r = FIRST_ROW + i, s = (k: string, v: string | number | { f: string } | null) => set(`${k}${r}`, v);
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
  zip.file(sp, new XMLSerializer().serializeToString(doc));
  const wp = 'xl/workbook.xml';
  let wx = await zip.file(wp)!.async('string');
  wx = /<calcPr[^>]*\/>/.test(wx)
    ? wx.replace(/<calcPr([^>]*?)\s*\/>/, (_m, a: string) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`)
    : wx.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  zip.file(wp, wx);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
