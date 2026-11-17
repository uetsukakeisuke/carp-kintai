import 'server-only';
import { sql, audit } from './db';
import { listStaff, ensurePeriod, partsReady, readParts, minWages } from './data';
import { hashPin, INITIAL_PIN } from './auth';
import { minWageAt } from './calc';
import { daysInMonth, ymd, jstParts } from './time';
import { readFirstSheet } from './xlsx-read';
import { decodeText, deriveWages, importDiff, matchStaff, nameKey, parseCsv, parseShiftTable, type ExistingShift, type ImportCounts, type ImportDay, type ImportEntry } from './shift-import';
import { cleanParts } from './shift-parts';

export const MAX_FILE = 3 * 1024 * 1024;
const NEED_SQL = 'データベースの準備がまだです。Supabase の SQL Editor で db/update-2026-11-17-shifts.sql を実行してから、もう一度取り込んでください';

/** wage：スマレジの日ごとの人件費から計算した時給（計算できないときは null） */
export type PreviewRow = { name: string; staffId: number | null; days: ImportDay[]; wage: number | null };
export type ImportPreview = {
  ym: string; format: 'grid' | 'list'; rows: PreviewRow[]; warnings: string[];
  staff: { id: number; name: string }[]; existing: ExistingShift[]; partsReady: boolean;
  minWage: number; // その月の最低賃金（新しく登録する人の時給の下限）
};

/** ファイルを読んで、人ごとの時間帯とアプリのスタッフの当てはめ・今入っている下書きを返す（まだ保存しない） */
export async function previewImport(storeId: number, bytes: Uint8Array): Promise<ImportPreview | string> {
  let grid: string[][];
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b; // xlsx は zip（PK）
  try {
    grid = zip ? await readFirstSheet(bytes) : parseCsv(decodeText(bytes));
  } catch {
    return zip ? 'Excel のファイルが読めませんでした。スマレジから出力し直したファイルを選んでください。' : 'ファイルが読めませんでした。';
  }
  const parsed = parseShiftTable(grid);
  if (typeof parsed === 'string') return parsed;
  const [y, m] = parsed.ym.split('-').map(Number);
  const from = ymd(y, m, 1), to = ymd(y, m, daysInMonth(y, m));
  const [staffRows, existing, ready, mws] = await Promise.all([listStaff({ storeId }), monthDrafts(storeId, from, to), partsReady(), minWages()]);
  const staff = staffRows.map((s) => ({ id: s.id, name: s.name, kana: s.kana }));
  const wages = deriveWages(parsed.rows, parsed.dayCost);
  const rows = parsed.rows.map((r, i) => ({ name: r.name, staffId: matchStaff(r.name, staff), days: r.days, wage: wages[i] }));
  return {
    ym: parsed.ym, format: parsed.format, rows, warnings: parsed.warnings, staff: staff.map(({ id, name }) => ({ id, name })), existing, partsReady: ready,
    minWage: Math.max(minWageAt(mws, from), minWageAt(mws, to)),
  };
}

async function monthDrafts(storeId: number, from: string, to: string, staffIds?: number[]): Promise<ExistingShift[]> {
  const rows = await sql<{ staff_id: number; work_date: string; start_min: number; end_min: number; parts: unknown }[]>`
    select staff_id, work_date, start_min, end_min, to_jsonb(s)->'parts' as parts from shifts s
    where store_id = ${storeId} and work_date between ${from} and ${to} and (${staffIds ?? null}::int[] is null or staff_id = any(${staffIds ?? null}::int[]))`;
  return rows.map((r) => ({ staffId: r.staff_id, date: r.work_date, start: r.start_min, end: r.end_min, parts: readParts(r.parts) }));
}

export type ImportResult = ImportCounts & { created: string[] };

/**
 * 取り込んだシフトを下書きに入れる。replace＝その人たちのその月の下書きをファイルの内容にする／fill＝空いている日だけ。
 * newStaff：アプリにいない人をスタッフとして登録する（tmp はマイナスの仮の番号。entries・staffIds の staffId で使う）。
 */
export async function applyImport(actorId: number, storeId: number, ym: string, rawEntries: unknown, rawStaffIds: unknown, mode: 'replace' | 'fill', rawNew: unknown = []): Promise<ImportResult | string> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return '月が正しくありません';
  if (!(await partsReady())) return NEED_SQL;
  const [y, m] = ym.split('-').map(Number);
  const from = ymd(y, m, 1), to = ymd(y, m, daysInMonth(y, m));
  const staffList = await listStaff({ storeId });
  const valid = new Set(staffList.map((s) => s.id));

  // 新しく登録する人
  const mws = await minWages();
  const minW = Math.max(minWageAt(mws, from), minWageAt(mws, to));
  const newStaff: { tmp: number; name: string; hourly: number }[] = [];
  if (!Array.isArray(rawNew) || rawNew.length > 50) return '新しく登録する人の内容が正しくありません';
  for (const x of rawNew as Record<string, unknown>[]) {
    const tmp = Number(x?.tmp), name = String(x?.name ?? '').replace(/[\s　]+/g, ' ').trim(), hourly = Number(x?.hourly);
    if (!Number.isInteger(tmp) || tmp >= 0 || !name || name.length > 40) return '新しく登録する人の内容が正しくありません';
    if (!Number.isInteger(hourly) || hourly < minW || hourly > 100000) return `${name}さんの時給は、最低賃金（${minW.toLocaleString('ja-JP')}円）以上の金額にしてください`;
    if (newStaff.some((n) => n.tmp === tmp || nameKey(n.name) === nameKey(name))) return `${name}さんが2回含まれています`;
    newStaff.push({ tmp, name, hourly });
  }
  const tmpIds = new Set(newStaff.map((n) => n.tmp));

  const staffIds = Array.isArray(rawStaffIds) ? [...new Set(rawStaffIds.map(Number))] : [];
  if (!staffIds.length && !newStaff.length) return '取り込む人がいません';
  if (staffIds.some((id) => (id > 0 ? !valid.has(id) : !tmpIds.has(id)))) return 'この店舗にいないスタッフが含まれています。画面を開き直してください';
  if (!Array.isArray(rawEntries) || rawEntries.length > 31 * Math.max(1, staffIds.length)) return '取り込む内容が正しくありません';
  const entries: ImportEntry[] = [];
  const seen = new Set<string>();
  for (const x of rawEntries as Record<string, unknown>[]) {
    const staffId = Number(x?.staffId), date = String(x?.date ?? ''), start = Number(x?.start), end = Number(x?.end);
    const parts = cleanParts(x?.parts ?? null);
    if (!staffIds.includes(staffId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) return '取り込む内容が正しくありません（日付・スタッフ）';
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > 2880 || parts === 'bad') return '取り込む内容が正しくありません（時間）';
    if (parts && (parts[0][0] !== start || parts[parts.length - 1][1] !== end)) return '取り込む内容が正しくありません（時間帯）';
    if (seen.has(`${staffId}|${date}`)) return '同じ人・同じ日のシフトが2つあります';
    seen.add(`${staffId}|${date}`);
    entries.push({ staffId, date, start, end, parts });
  }

  const realIds = staffIds.filter((id) => id > 0);
  const before = await monthDrafts(storeId, from, to, realIds);
  const counts = importDiff(before, entries, staffIds, mode);
  const period = await ensurePeriod(storeId, y, m);
  const pin = newStaff.length ? await hashPin(INITIAL_PIN) : '';
  // 新しく登録する人の時給は、今日（取り込む月が先なら今日から、過ぎた月ならその月の1日から）
  const today = jstParts().date;
  const wageFrom = from < today ? from : today;
  const created: { id: number; name: string }[] = [];
  await sql.begin(async (tx) => {
    // アプリにいない人を登録（同じ名前の人が在籍していれば、その人を使う）
    const idOf = new Map<number, number>();
    for (const n of newStaff) {
      const same = staffList.find((s) => nameKey(s.name) === nameKey(n.name));
      if (same) { idOf.set(n.tmp, same.id); continue; }
      const [s] = await tx<{ id: number }[]>`insert into staff (name, role, employment, store_id, transport_per_day, pin_hash, sort)
        values (${n.name}, 'staff', 'ﾊﾟｰﾄ', ${storeId}, 0, ${pin}, (select coalesce(max(sort), 0) + 1 from staff)) returning id`;
      await tx`insert into wage_rates (staff_id, effective_from, hourly, created_by) values (${s.id}, ${wageFrom}, ${n.hourly}, ${actorId})`;
      idOf.set(n.tmp, s.id); created.push({ id: s.id, name: n.name });
    }
    const real = (id: number) => (id > 0 ? id : idOf.get(id)!);
    const E = entries.map((e) => ({ ...e, staffId: real(e.staffId) }));
    const ids = staffIds.map(real);
    if (mode === 'replace') await tx`delete from shifts where store_id = ${storeId} and work_date between ${from} and ${to} and staff_id = any(${ids}::int[])`;
    if (period.status === 'published' && (counts.added || counts.changed || counts.removed)) await tx`update shift_periods set status = 'changed' where id = ${period.id}`;
    if (!E.length) return;
    const ps = E.map((e) => (e.parts ? JSON.stringify(e.parts) : ''));
    if (mode === 'replace') await tx`insert into shifts (staff_id, work_date, store_id, start_min, end_min, parts)
      select u.staff_id, u.work_date, ${storeId}, u.start_min, u.end_min, nullif(u.parts, '')::jsonb
      from unnest(${E.map((e) => e.staffId)}::int[], ${E.map((e) => e.date)}::date[], ${E.map((e) => e.start)}::int[], ${E.map((e) => e.end)}::int[], ${ps}::text[]) as u(staff_id, work_date, start_min, end_min, parts)
      on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min, parts = excluded.parts, updated_at = now()`;
    else await tx`insert into shifts (staff_id, work_date, store_id, start_min, end_min, parts)
      select u.staff_id, u.work_date, ${storeId}, u.start_min, u.end_min, nullif(u.parts, '')::jsonb
      from unnest(${E.map((e) => e.staffId)}::int[], ${E.map((e) => e.date)}::date[], ${E.map((e) => e.start)}::int[], ${E.map((e) => e.end)}::int[], ${ps}::text[]) as u(staff_id, work_date, start_min, end_min, parts)
      on conflict (staff_id, work_date) do nothing`;
  });
  for (const c of created) await audit(actorId, 'staff_create', { id: c.id, name: c.name, via: 'shift_import' });
  await audit(actorId, 'shift_import', { storeId, ym, mode, staff: staffIds.length, created: created.length, ...counts });
  return { ...counts, created: created.map((c) => c.name) };
}
