import 'server-only';
import { sql } from './db';
import { addDays, jstParts } from './time';

// 外部向けAPI（v1）で返すデータ。時給・暗証番号・顔・明細・下書きのシフトは含めない
export const MAX_RANGE = 62;
const pad = (n: number) => String(n).padStart(2, '0');
export const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** 日付＋分（1440以上は翌日）→ 2026-11-12T10:00:00+09:00 */
export function at(date: string, min: number) {
  const [y, mo, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, 0, min));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00+09:00`;
}
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/** ?date= か ?from=&to= から期間。既定は今日 */
export function range(url: URL): { from: string; to: string } | { error: string } {
  const today = jstParts().date;
  const d = url.searchParams.get('date'), f = url.searchParams.get('from'), t = url.searchParams.get('to');
  if (d !== null) return isDate(d) ? { from: d, to: d } : { error: 'date は YYYY-MM-DD で指定してください' };
  const from = f ?? today, to = t ?? from;
  if (!isDate(from) || !isDate(to)) return { error: 'from・to は YYYY-MM-DD で指定してください' };
  if (to < from) return { error: 'to は from 以降にしてください' };
  if (to > addDays(from, MAX_RANGE - 1)) return { error: `期間は${MAX_RANGE}日までにしてください` };
  return { from, to };
}

export async function v1Staff() {
  const rows = await sql<{ id: number; name: string; kana: string | null; store_id: number | null; store: string | null }[]>`
    select s.id, s.name, s.kana, s.store_id, st.name as store from staff s left join stores st on st.id = s.store_id
    where s.active order by s.sort, s.kana nulls last, s.id`;
  return rows.map((r) => ({ staff_id: r.id, name: r.name, kana: r.kana, store: r.store }));
}

export async function v1Shifts(from: string, to: string) {
  const rows = await sql<{ work_date: string; staff_id: number; name: string; store: string; start_min: number; end_min: number }[]>`
    select p.work_date, p.staff_id, s.name, st.name as store, p.start_min, p.end_min
    from published_shifts p join staff s on s.id = p.staff_id join stores st on st.id = p.store_id
    where p.work_date between ${from} and ${to} and s.active order by p.work_date, p.start_min, p.staff_id`;
  return rows.map((r) => ({
    date: r.work_date, staff_id: r.staff_id, name: r.name, store: r.store,
    start: hhmm(r.start_min), end: hhmm(r.end_min), start_at: at(r.work_date, r.start_min), end_at: at(r.work_date, r.end_min),
  }));
}

type TaskOut = { task_id: number; date: string; staff_id: number | null; name: string | null; for: 'everyone' | 'person'; kind: 'task' | 'note'; title: string; note: string | null; time: string | null; done: boolean; done_at: string | null; carried_from: string | null };
export async function v1Tasks(from: string, to: string): Promise<TaskOut[]> {
  const rows = await sql<{ id: number; work_date: string; staff_id: number | null; name: string | null; kind: 'task' | 'note'; title: string; note: string | null; at_min: number | null; done_at: Date | null; first_date: string }[]>`
    select t.id, t.work_date, t.staff_id, s.name, t.kind, t.title, t.note, t.at_min, t.done_at, t.first_date
    from day_tasks t left join staff s on s.id = t.staff_id
    where t.work_date between ${from} and ${to} order by t.work_date, t.staff_id nulls first, t.at_min nulls last, t.id`;
  return rows.map((r) => ({
    task_id: r.id, date: r.work_date, staff_id: r.staff_id, name: r.name, for: r.staff_id === null ? 'everyone' : 'person',
    kind: r.kind, title: r.title, note: r.note, time: r.at_min === null ? null : hhmm(r.at_min),
    done: !!r.done_at, done_at: r.done_at ? new Date(r.done_at).toISOString() : null, carried_from: r.first_date < r.work_date ? r.first_date : null,
  }));
}

/** その日に送る内容をまとめたもの：出勤する人ごとに、シフトと「全体＋その人」の予定 */
export async function v1Day(date: string) {
  const [shifts, tasks] = await Promise.all([v1Shifts(date, date), v1Tasks(date, date)]);
  const everyone = tasks.filter((t) => t.staff_id === null);
  const ids = [...new Set([...shifts.map((s) => s.staff_id), ...tasks.filter((t) => t.staff_id !== null).map((t) => t.staff_id!)])];
  const people = ids.map((id) => {
    const sh = shifts.find((s) => s.staff_id === id);
    const mine = tasks.filter((t) => t.staff_id === id);
    return {
      staff_id: id, name: sh?.name ?? mine[0]?.name ?? null,
      shift: sh ? { store: sh.store, start: sh.start, end: sh.end, start_at: sh.start_at, end_at: sh.end_at } : null,
      tasks: [...everyone, ...mine].sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.task_id - b.task_id),
    };
  }).sort((a, b) => (a.shift?.start_at ?? '9').localeCompare(b.shift?.start_at ?? '9') || a.staff_id - b.staff_id);
  return { date, everyone, people };
}
