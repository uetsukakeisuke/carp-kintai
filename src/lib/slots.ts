import 'server-only';
import { sql, audit } from './db';
import { LOCK, monthKey, partsReady, readParts } from './data';
import { checkMove, laterOnly, slotName, filled, type Slot, type SlotRange } from './slot-rules';
import { jstParts, dateLabel, hm } from './time';

// 枠の表は db/update-2026-11-18-slots.sql で作る。作る前でも画面が壊れないよう、あるかどうかを確かめてから使う
let ready: { ok: boolean; at: number } | null = null;
export async function slotsReady(): Promise<boolean> {
  if (ready && (ready.ok || Date.now() - ready.at < 60_000)) return ready.ok;
  let ok = false;
  try {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.tables
      where table_schema = current_schema() and table_name in ('shift_slots', 'shift_changes', 'shift_notices')`;
    ok = r.n === 3;
  } catch { ok = false; }
  ready = { ok, at: Date.now() };
  return ok;
}
export const NEED_SLOTS_SQL = 'データベースの準備がまだです。Supabase の SQL Editor で db/update-2026-11-18-slots.sql を実行してください';

export async function listSlots(storeId: number, from: string, to: string): Promise<Slot[]> {
  if (!(await slotsReady())) return [];
  return sql<Slot[]>`select id, work_date, start_min, end_min, capacity, label from shift_slots
    where store_id = ${storeId} and work_date between ${from} and ${to} order by work_date, start_min, id`;
}

// ---------------- 店長：枠を作る・変える・消す ----------------
export async function createSlots(actorId: number, storeId: number, dates: string[], start: number, end: number, capacity: number, label: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`insert into shift_slots (store_id, work_date, start_min, end_min, capacity, label, created_by)
    select ${storeId}, d, ${start}, ${end}, ${capacity}, ${label}, ${actorId} from unnest(${dates}::date[]) as d returning id`;
  await audit(actorId, 'slot_create', { storeId, dates: dates.length, start, end, capacity, label });
  return rows.length;
}
export async function updateSlot(actorId: number, id: number, v: { capacity: number; start: number; end: number; label: string }): Promise<boolean> {
  const r = await sql`update shift_slots set capacity = ${v.capacity}, start_min = ${v.start}, end_min = ${v.end}, label = ${v.label} where id = ${id}`;
  if (r.count) await audit(actorId, 'slot_update', { id, ...v });
  return r.count > 0;
}
export async function deleteSlots(actorId: number, ids: number[]): Promise<number> {
  const r = await sql`delete from shift_slots where id = any(${ids}::int[])`;
  if (r.count) await audit(actorId, 'slot_delete', { ids });
  return r.count;
}

// ---------------- スタッフ：自分のシフトに入る・時間を変える・やめる ----------------
type Cell = { start: number; end: number; parts: SlotRange['parts'] };
const cellOf = (r: { start_min: number; end_min: number; parts: unknown }): Cell => ({ start: r.start_min, end: r.end_min, parts: readParts(r.parts) });

export type MoveResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * next：入る・変えたあとの時間（null ならやめる）。
 * 公開済みのシフトと下書きの両方を同じ内容にする（店長があとで公開し直しても消えないように）。
 */
export async function moveMyShift(staffId: number, storeId: number, date: string, next: { start: number; end: number } | null, mode: 'add' | 'change' | 'delete'): Promise<MoveResult> {
  if (!(await slotsReady())) return { ok: false, error: NEED_SLOTS_SQL };
  const today = jstParts().date;
  if (date <= today) return { ok: false, error: '当日・過ぎた日のシフトは変えられません。店長に連絡してください' };
  const [y, m] = date.split('-').map(Number);
  const withP = await partsReady();
  let log: unknown = null;
  const res = await sql.begin(async (tx): Promise<MoveResult> => {
    await tx`select pg_advisory_xact_lock(${LOCK.month}, ${monthKey(storeId, y, m)})`; // 同じ月の変更・公開は順番に
    const [period] = await tx<{ status: string }[]>`select status from shift_periods where store_id = ${storeId} and year = ${y} and month = ${m}`;
    if (!period || period.status === 'draft') return { ok: false, error: `${m}月のシフトはまだ公開されていません` };
    const day = await tx<{ staff_id: number; start_min: number; end_min: number; parts: unknown }[]>`
      select staff_id, start_min, end_min, to_jsonb(p)->'parts' as parts from published_shifts p where store_id = ${storeId} and work_date = ${date}`;
    const mine = day.find((r) => r.staff_id === staffId);
    const old = mine ? cellOf(mine) : null;
    const others = day.filter((r) => r.staff_id !== staffId).map(cellOf);
    const slots = await tx<Slot[]>`select id, work_date, start_min, end_min, capacity, label from shift_slots where store_id = ${storeId} and work_date = ${date} order by start_min, id`;

    if (mode === 'add' && old) return { ok: false, error: 'この日はもう出勤予定があります。時間を変えるときは「変更」から' };
    if (mode !== 'add' && !old) return { ok: false, error: 'この日のシフトが見つかりません。画面を開き直してください' };
    if (mode === 'change' && old && next) { const e = laterOnly(old, next); if (e) return { ok: false, error: e }; }
    const nxt: Cell | null = next ? { start: next.start, end: next.end, parts: null } : null;
    const c = checkMove(old, nxt, slots, others);
    if (!c.ok) return c;

    if (!nxt) {
      await tx`delete from published_shifts where staff_id = ${staffId} and work_date = ${date}`;
      await tx`delete from shifts where staff_id = ${staffId} and work_date = ${date}`;
    } else {
      for (const t of ['published_shifts', 'shifts'] as const) {
        if (withP) await tx`insert into ${tx(t)} (staff_id, work_date, store_id, start_min, end_min, parts) values (${staffId}, ${date}, ${storeId}, ${nxt.start}, ${nxt.end}, null)
          on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min, parts = null`;
        else await tx`insert into ${tx(t)} (staff_id, work_date, store_id, start_min, end_min) values (${staffId}, ${date}, ${storeId}, ${nxt.start}, ${nxt.end})
          on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min`;
      }
    }
    const js = (x: Cell | null) => (x ? JSON.stringify(x) : null);
    await tx`insert into shift_changes (store_id, staff_id, work_date, action, before, after)
      values (${storeId}, ${staffId}, ${date}, ${mode}, (${js(old)}::text)::jsonb, (${js(nxt)}::text)::jsonb)`;
    for (const f of c.freed) await tx`insert into shift_notices (store_id, work_date, slot_id, start_min, end_min, label, by_staff)
      values (${storeId}, ${date}, ${f.slot.id}, ${f.slot.start_min}, ${f.slot.end_min}, ${f.slot.label}, ${staffId})`;
    log = { storeId, date, before: old, after: nxt };
    const d = dateLabel(date);
    const msg = mode === 'delete' ? `${d} のシフトをやめました` : mode === 'add' ? `${d} ${hm(nxt!.start)}〜${hm(nxt!.end)} に入りました` : `${d} を ${hm(nxt!.start)}〜${hm(nxt!.end)} に変えました`;
    return { ok: true, message: msg + (c.freed.length ? `。${c.freed.map((f) => slotName(f.slot)).join('、')} に空きが出たことを全員にお知らせしました` : '') };
  });
  if (log) await audit(staffId, 'shift_self_' + mode, log); // 記録は順番待ちが終わってから（接続を2本同時に使わないため）
  return res;
}

// ---------------- お知らせ ----------------
export type Notice = { id: number; slot_id: number | null; work_date: string; start_min: number; end_min: number; label: string; created_at: Date; open: number | null; mine: boolean };

/** これからの日の「空きが出ました」（新しい順）。open はいまの空き（枠が消えていれば null） */
export async function listNotices(storeId: number, meId: number): Promise<Notice[]> {
  if (!(await slotsReady())) return [];
  const today = jstParts().date;
  const ns = await sql<{ id: string | number; work_date: string; slot_id: number | null; start_min: number; end_min: number; label: string; created_at: Date; by_staff: number | null }[]>`
    select id, work_date, slot_id, start_min, end_min, label, created_at, by_staff from shift_notices
    where store_id = ${storeId} and work_date > ${today} and created_at > now() - interval '30 days' order by created_at desc limit 30`;
  if (!ns.length) return [];
  const dates = [...new Set(ns.map((n) => n.work_date))];
  const [slots, shifts] = await Promise.all([
    sql<Slot[]>`select id, work_date, start_min, end_min, capacity, label from shift_slots where id = any(${ns.map((n) => n.slot_id ?? 0)}::int[])`,
    sql<{ work_date: string; start_min: number; end_min: number; parts: unknown }[]>`select work_date, start_min, end_min, to_jsonb(p)->'parts' as parts from published_shifts p where store_id = ${storeId} and work_date = any(${dates}::date[])`,
  ]);
  return ns.map((n) => {
    const s = slots.find((x) => x.id === n.slot_id);
    const open = s ? s.capacity - filled(s, shifts.filter((r) => r.work_date === n.work_date).map(cellOf)) : null;
    return { id: Number(n.id), slot_id: s ? s.id : null, work_date: n.work_date, start_min: n.start_min, end_min: n.end_min, label: n.label, created_at: n.created_at, open, mine: n.by_staff === meId };
  });
}
/** まだ見ていないお知らせの数（自分が出したものは数えない） */
export async function unseenNotices(staffId: number, storeId: number | null): Promise<number> {
  if (!storeId || !(await slotsReady())) return 0;
  try {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from shift_notices n
      where n.store_id = ${storeId} and n.work_date > ${jstParts().date} and n.created_at > now() - interval '30 days'
        and n.by_staff is distinct from ${staffId}
        and n.created_at > coalesce((select notice_seen_at from staff where id = ${staffId}), 'epoch')`;
    return r.n;
  } catch { return 0; }
}
export async function markNoticesSeen(staffId: number) {
  if (!(await slotsReady())) return;
  await sql`update staff set notice_seen_at = now() where id = ${staffId}`;
}

// ---------------- 店長：スタッフが変えた記録 ----------------
export type ChangeRow = { id: number; staff_name: string; work_date: string; action: 'add' | 'change' | 'delete'; before: Cell | null; after: Cell | null; created_at: Date };
export async function recentChanges(storeId: number, limit = 50): Promise<ChangeRow[]> {
  if (!(await slotsReady())) return [];
  const rows = await sql<(Omit<ChangeRow, 'id'> & { id: string | number })[]>`
    select c.id, s.name as staff_name, c.work_date, c.action, c.before, c.after, c.created_at from shift_changes c join staff s on s.id = c.staff_id
    where c.store_id = ${storeId} order by c.created_at desc limit ${limit}`;
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Cell | null;
  return rows.map((r) => ({ ...r, id: Number(r.id), before: parse(r.before), after: parse(r.after) }));
}
