import 'server-only';
import { sql, audit } from './db';
import { addDays, jstParts } from './time';
import { isManager, type User } from './auth';
import type { TaskItem } from '@/components/TaskList';

// 予定表（その日の業務内容・作業）。上塚さん・店長が書き、スタッフは見て「済」にする。
export type TaskKind = 'task' | 'note';
export interface DayTask {
  id: number; store_id: number; work_date: string; staff_id: number | null; kind: TaskKind;
  title: string; note: string | null; at_min: number | null; first_date: string;
  done_at: Date | null; done_by: number | null; done_by_name: string | null; staff_name: string | null;
}
export type TaskInput = { storeId: number; date: string; staffId: number | null; kind: TaskKind; title: string; note: string | null; atMin: number | null };

// （SQLの部品を組み合わせると db.ts の見張りが部品だけで実行してしまうので、問い合わせは毎回全部書く）

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/** 入力を確かめて整える。おかしければエラーの文 */
export function cleanTask(x: Partial<TaskInput>): TaskInput | string {
  const title = String(x.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title) return '内容を入れてください';
  if (title.length > 200) return '内容は200文字までにしてください（くわしくはメモへ）';
  const note = String(x.note ?? '').trim();
  if (note.length > 1000) return 'メモは1000文字までにしてください';
  if (!isDate(x.date)) return '日付が正しくありません';
  const at = x.atMin === null || x.atMin === undefined || (x.atMin as unknown) === '' ? null : Number(x.atMin);
  if (at !== null && !(Number.isInteger(at) && at >= 0 && at <= 1800)) return '時刻が正しくありません';
  const kind = x.kind === 'note' ? 'note' : 'task';
  const staffId = x.staffId ? Number(x.staffId) : null;
  return { storeId: Number(x.storeId), date: x.date, staffId, kind, title, note: note || null, atMin: at };
}

/** スタッフの店舗（未設定なら最初の店舗） */
export async function storeOf(staffId: number): Promise<number | null> {
  const [r] = await sql<{ id: number | null }[]>`select coalesce((select store_id from staff where id = ${staffId}),
    (select id from stores where active order by sort, id limit 1)) as id`;
  return r?.id ?? null;
}

export async function tasksForDay(storeId: number, date: string) {
  return sql<DayTask[]>`select t.id, t.store_id, t.work_date, t.staff_id, t.kind, t.title, t.note, t.at_min, t.first_date, t.done_at, t.done_by, d.name as done_by_name, s.name as staff_name
    from day_tasks t left join staff d on d.id = t.done_by left join staff s on s.id = t.staff_id
    where t.store_id = ${storeId} and t.work_date = ${date} order by t.staff_id nulls first, t.at_min nulls last, t.id`;
}
/** スタッフに見せる分：全体＋その人の作業 */
export async function tasksForStaff(staffId: number, from: string, to = from) {
  const store = await storeOf(staffId);
  if (!store) return [];
  return sql<DayTask[]>`select t.id, t.store_id, t.work_date, t.staff_id, t.kind, t.title, t.note, t.at_min, t.first_date, t.done_at, t.done_by, d.name as done_by_name, s.name as staff_name
    from day_tasks t left join staff d on d.id = t.done_by left join staff s on s.id = t.staff_id
    where t.store_id = ${store} and t.work_date between ${from} and ${to}
    and (t.staff_id is null or t.staff_id = ${staffId}) order by t.work_date, t.staff_id nulls first, t.at_min nulls last, t.id`;
}
/** 日ごとの件数（週の帯に出す） */
export async function taskCounts(storeId: number, from: string, to: string) {
  return sql<{ work_date: string; n: number; open: number }[]>`select work_date, count(*)::int as n,
    count(*) filter (where kind = 'task' and done_at is null)::int as open
    from day_tasks where store_id = ${storeId} and work_date between ${from} and ${to} group by work_date`;
}
/** 終わっていない作業（前の日まで・14日分） */
export async function leftovers(storeId: number, before: string) {
  return sql<DayTask[]>`select t.id, t.store_id, t.work_date, t.staff_id, t.kind, t.title, t.note, t.at_min, t.first_date, t.done_at, t.done_by, d.name as done_by_name, s.name as staff_name
    from day_tasks t left join staff d on d.id = t.done_by left join staff s on s.id = t.staff_id
    where t.store_id = ${storeId} and t.kind = 'task' and t.done_at is null
    and t.work_date < ${before} and t.work_date >= ${addDays(before, -14)} order by t.work_date, t.staff_id nulls first, t.id`;
}

async function validStaff(staffId: number | null) {
  if (staffId === null) return true;
  const [s] = await sql<{ id: number }[]>`select id from staff where id = ${staffId} and active`;
  return !!s;
}
async function validStore(storeId: number) {
  const [s] = await sql<{ id: number }[]>`select id from stores where id = ${storeId}`;
  return !!s;
}

export async function addTask(actorId: number, t: TaskInput): Promise<string | null> {
  if (!(await validStore(t.storeId))) return '店舗が見つかりません';
  if (!(await validStaff(t.staffId))) return '担当のスタッフが見つかりません';
  await sql`insert into day_tasks (store_id, work_date, staff_id, kind, title, note, at_min, first_date, created_by)
    values (${t.storeId}, ${t.date}, ${t.staffId}, ${t.kind}, ${t.title}, ${t.note}, ${t.atMin}, ${t.date}, ${actorId})`;
  await audit(actorId, 'task_add', { date: t.date, staffId: t.staffId, title: t.title });
  return null;
}
export async function updateTask(actorId: number, id: number, t: TaskInput): Promise<string | null> {
  if (!(await validStaff(t.staffId))) return '担当のスタッフが見つかりません';
  const [r] = await sql<{ id: number }[]>`update day_tasks set work_date = ${t.date}, staff_id = ${t.staffId}, kind = ${t.kind}, title = ${t.title},
    note = ${t.note}, at_min = ${t.atMin}, done_at = case when ${t.kind} = 'note' then null else done_at end,
    done_by = case when ${t.kind} = 'note' then null else done_by end, updated_at = now() where id = ${id} returning id`;
  if (!r) return '予定が見つかりません（ほかの人が消した可能性があります）';
  await audit(actorId, 'task_update', { id, date: t.date, staffId: t.staffId, title: t.title });
  return null;
}
export async function deleteTask(actorId: number, id: number) {
  const [r] = await sql<{ title: string; work_date: string }[]>`delete from day_tasks where id = ${id} returning title, work_date`;
  if (r) await audit(actorId, 'task_delete', { id, date: r.work_date, title: r.title });
  return !!r;
}
/** 終わっていない作業を別の日へ回す（最初に入れた日は残す） */
export async function moveTasks(actorId: number, ids: number[], to: string) {
  if (!ids.length) return 0;
  const r = await sql`update day_tasks set work_date = ${to}, updated_at = now() where id = any(${ids}) and done_at is null`;
  await audit(actorId, 'task_move', { ids, to });
  return r.count;
}

/**
 * 済／未に切り替える。店長・管理者はどれでも。スタッフは自分の店の「全体」と自分の作業だけ、今日と前日の分だけ
 */
export async function setTaskDone(u: User, id: number, done: boolean): Promise<string | null> {
  const [t] = await sql<{ store_id: number; work_date: string; staff_id: number | null; kind: TaskKind }[]>`
    select store_id, work_date, staff_id, kind from day_tasks where id = ${id}`;
  if (!t) return '予定が見つかりません（消された可能性があります）';
  if (t.kind !== 'task') return 'この予定は済にするものではありません';
  if (!isManager(u)) {
    const today = jstParts().date;
    if (t.staff_id !== null && t.staff_id !== u.id) return 'ほかの人の作業は済にできません';
    if (t.store_id !== (await storeOf(u.id))) return 'ほかの店舗の作業は済にできません';
    if (t.work_date > today || t.work_date < addDays(today, -1)) return 'その日の作業は、今日は済にできません';
  }
  if (done) await sql`update day_tasks set done_at = now(), done_by = ${u.id}, updated_at = now() where id = ${id}`;
  else await sql`update day_tasks set done_at = null, done_by = null, updated_at = now() where id = ${id}`;
  return null;
}

/** 画面に渡す形 */
export const toItem = (t: DayTask): TaskItem => ({
  id: t.id, staffId: t.staff_id, kind: t.kind, title: t.title, note: t.note, atMin: t.at_min, firstDate: t.first_date, date: t.work_date,
  doneAt: t.done_at ? new Date(t.done_at).toISOString() : null, doneBy: t.done_by_name, staffName: t.staff_name,
});
