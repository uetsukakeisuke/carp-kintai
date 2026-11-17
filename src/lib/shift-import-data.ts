import 'server-only';
import { sql, audit } from './db';
import { listStaff, ensurePeriod, partsReady, readParts } from './data';
import { daysInMonth, ymd } from './time';
import { readFirstSheet } from './xlsx-read';
import { decodeText, importDiff, matchStaff, parseCsv, parseShiftTable, type ExistingShift, type ImportCounts, type ImportDay, type ImportEntry } from './shift-import';
import { cleanParts } from './shift-parts';

export const MAX_FILE = 3 * 1024 * 1024;

export type PreviewRow = { name: string; staffId: number | null; days: ImportDay[] };
export type ImportPreview = {
  ym: string; format: 'grid' | 'list'; rows: PreviewRow[]; warnings: string[];
  staff: { id: number; name: string }[]; existing: ExistingShift[]; partsReady: boolean;
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
  const staff = (await listStaff({ storeId })).map((s) => ({ id: s.id, name: s.name, kana: s.kana }));
  const rows = parsed.rows.map((r) => ({ name: r.name, staffId: matchStaff(r.name, staff), days: r.days }));
  const [existing, ready] = await Promise.all([monthDrafts(storeId, ymd(y, m, 1), ymd(y, m, daysInMonth(y, m))), partsReady()]);
  return { ym: parsed.ym, format: parsed.format, rows, warnings: parsed.warnings, staff: staff.map(({ id, name }) => ({ id, name })), existing, partsReady: ready };
}

async function monthDrafts(storeId: number, from: string, to: string, staffIds?: number[]): Promise<ExistingShift[]> {
  const rows = await sql<{ staff_id: number; work_date: string; start_min: number; end_min: number; parts: unknown }[]>`
    select staff_id, work_date, start_min, end_min, to_jsonb(s)->'parts' as parts from shifts s
    where store_id = ${storeId} and work_date between ${from} and ${to} and (${staffIds ?? null}::int[] is null or staff_id = any(${staffIds ?? null}::int[]))`;
  return rows.map((r) => ({ staffId: r.staff_id, date: r.work_date, start: r.start_min, end: r.end_min, parts: readParts(r.parts) }));
}

/** 取り込んだシフトを下書きに入れる。replace＝その人たちのその月の下書きをファイルの内容にする／fill＝空いている日だけ */
export async function applyImport(actorId: number, storeId: number, ym: string, rawEntries: unknown, rawStaffIds: unknown, mode: 'replace' | 'fill'): Promise<ImportCounts | string> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return '月が正しくありません';
  const [y, m] = ym.split('-').map(Number);
  const from = ymd(y, m, 1), to = ymd(y, m, daysInMonth(y, m));
  const valid = new Set((await listStaff({ storeId })).map((s) => s.id));
  const staffIds = Array.isArray(rawStaffIds) ? [...new Set(rawStaffIds.map(Number))] : [];
  if (!staffIds.length) return '取り込む人がいません';
  if (staffIds.some((id) => !valid.has(id))) return 'この店舗にいないスタッフが含まれています。画面を開き直してください';
  if (!Array.isArray(rawEntries) || rawEntries.length > 31 * staffIds.length) return '取り込む内容が正しくありません';
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
  const ready = await partsReady();
  if (!ready && entries.some((e) => e.parts)) return 'データベースの準備がまだです。Supabase の SQL Editor で db/update-2026-11-17-shifts.sql を実行してから、もう一度取り込んでください';

  const before = await monthDrafts(storeId, from, to, staffIds);
  const counts = importDiff(before, entries, staffIds, mode);
  const period = await ensurePeriod(storeId, y, m);
  const E = entries;
  await sql.begin(async (tx) => {
    if (mode === 'replace') await tx`delete from shifts where store_id = ${storeId} and work_date between ${from} and ${to} and staff_id = any(${staffIds}::int[])`;
    if (period.status === 'published' && (counts.added || counts.changed || counts.removed)) await tx`update shift_periods set status = 'changed' where id = ${period.id}`;
    if (!E.length) return;
    const cols = [E.map((e) => e.staffId), E.map((e) => e.date), E.map((e) => e.start), E.map((e) => e.end)] as const;
    if (ready) {
      const ps = E.map((e) => (e.parts ? JSON.stringify(e.parts) : ''));
      if (mode === 'replace') await tx`insert into shifts (staff_id, work_date, store_id, start_min, end_min, parts)
        select u.staff_id, u.work_date, ${storeId}, u.start_min, u.end_min, nullif(u.parts, '')::jsonb
        from unnest(${cols[0]}::int[], ${cols[1]}::date[], ${cols[2]}::int[], ${cols[3]}::int[], ${ps}::text[]) as u(staff_id, work_date, start_min, end_min, parts)
        on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min, parts = excluded.parts, updated_at = now()`;
      else await tx`insert into shifts (staff_id, work_date, store_id, start_min, end_min, parts)
        select u.staff_id, u.work_date, ${storeId}, u.start_min, u.end_min, nullif(u.parts, '')::jsonb
        from unnest(${cols[0]}::int[], ${cols[1]}::date[], ${cols[2]}::int[], ${cols[3]}::int[], ${ps}::text[]) as u(staff_id, work_date, start_min, end_min, parts)
        on conflict (staff_id, work_date) do nothing`;
    } else {
      if (mode === 'replace') await tx`insert into shifts (staff_id, work_date, store_id, start_min, end_min)
        select u.staff_id, u.work_date, ${storeId}, u.start_min, u.end_min
        from unnest(${cols[0]}::int[], ${cols[1]}::date[], ${cols[2]}::int[], ${cols[3]}::int[]) as u(staff_id, work_date, start_min, end_min)
        on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min, updated_at = now()`;
      else await tx`insert into shifts (staff_id, work_date, store_id, start_min, end_min)
        select u.staff_id, u.work_date, ${storeId}, u.start_min, u.end_min
        from unnest(${cols[0]}::int[], ${cols[1]}::date[], ${cols[2]}::int[], ${cols[3]}::int[]) as u(staff_id, work_date, start_min, end_min)
        on conflict (staff_id, work_date) do nothing`;
    }
  });
  await audit(actorId, 'shift_import', { storeId, ym, mode, staff: staffIds.length, ...counts });
  return counts;
}
