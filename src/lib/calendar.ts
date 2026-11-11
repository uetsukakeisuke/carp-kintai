import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql, audit } from './db';
import { addDays, jstParts } from './time';
import { tasksForStaff } from './tasks';
import { buildIcs } from './ics';

// 自分のカレンダーに入れるURL（/cal/○○.ics）。シフト（公開済み）と予定表（全体＋自分の作業）を返す。
const PAST = 31, AHEAD_SHIFT = 120, AHEAD_TASK = 60;

export async function calToken(staffId: number): Promise<string | null> {
  const [s] = await sql<{ cal_token: string | null }[]>`select cal_token from staff where id = ${staffId}`;
  return s?.cal_token ?? null;
}
export async function newCalToken(staffId: number): Promise<string> {
  const t = randomBytes(24).toString('base64url');
  await sql`update staff set cal_token = ${t} where id = ${staffId}`;
  await audit(staffId, 'cal_token_new', {});
  return t;
}
export async function dropCalToken(staffId: number) {
  await sql`update staff set cal_token = null where id = ${staffId}`;
  await audit(staffId, 'cal_token_drop', {});
}

export async function icsFor(token: string, host: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [s] = await sql<{ id: number; name: string }[]>`select id, name from staff where cal_token = ${token} and active`;
  if (!s) return null;
  const today = jstParts().date;
  const [shifts, tasks] = await Promise.all([
    sql<{ work_date: string; start_min: number; end_min: number; store: string }[]>`
      select p.work_date, p.start_min, p.end_min, st.name as store from published_shifts p join stores st on st.id = p.store_id
      where p.staff_id = ${s.id} and p.work_date between ${addDays(today, -PAST)} and ${addDays(today, AHEAD_SHIFT)} order by p.work_date, p.start_min`,
    tasksForStaff(s.id, addDays(today, -14), addDays(today, AHEAD_TASK)),
  ]);
  return buildIcs({
    staffId: s.id, name: s.name, now: new Date(), host,
    shifts: shifts.map((x) => ({ date: x.work_date, start: x.start_min, end: x.end_min, store: x.store })),
    tasks: tasks.map((t) => ({ id: t.id, date: t.work_date, kind: t.kind, title: t.title, note: t.note, atMin: t.at_min, done: !!t.done_at, mine: t.staff_id !== null })),
  });
}
