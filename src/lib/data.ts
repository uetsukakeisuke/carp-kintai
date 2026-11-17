import 'server-only';
import type postgres from 'postgres';
import { sql, audit } from './db';
import { canPunch, decideWorkDay, type Punch, type PunchKind, type WageRate } from './calc';
import { addDays, DAY_BOUNDARY_MIN, jstParts, ymd, daysInMonth } from './time';
import { cleanParts, type Part } from './shift-parts';

export interface Store { id: number; name: string; sort: number; active: boolean; budget_weekday: number; budget_friday: number; budget_weekend: number }
export interface StaffRow {
  id: number; name: string; kana: string | null; role: 'staff' | 'manager' | 'admin'; employment: string; pay_type: 'hourly' | 'monthly';
  store_id: number | null; transport_per_day: number; commute_means: string | null; active: boolean; sort: number;
  pin_must_change: boolean; locked_until: Date | null;
}

export async function listStores(includeInactive = false): Promise<Store[]> {
  return sql<Store[]>`select id, name, sort, active, budget_weekday, budget_friday, budget_weekend from stores
    where ${includeInactive} or active order by sort, id`;
}

export async function listStaff(opts: { storeId?: number; includeInactive?: boolean } = {}): Promise<StaffRow[]> {
  return sql<StaffRow[]>`select id, name, kana, role, employment, pay_type, store_id, transport_per_day, commute_means, active, sort, pin_must_change, locked_until
    from staff where (${opts.includeInactive ?? false} or active) and (${opts.storeId ?? null}::int is null or store_id = ${opts.storeId ?? null})
    order by sort, kana nulls last, id`;
}

export async function ratesFor(staffIds: number[]): Promise<Map<number, WageRate[]>> {
  const m = new Map<number, WageRate[]>();
  if (!staffIds.length) return m;
  const rows = await sql<{ staff_id: number; effective_from: string; hourly: number }[]>`
    select staff_id, effective_from, hourly from wage_rates where staff_id = any(${staffIds}) order by effective_from`;
  for (const r of rows) {
    const l = m.get(r.staff_id) ?? [];
    l.push({ effective_from: r.effective_from, hourly: r.hourly });
    m.set(r.staff_id, l);
  }
  return m;
}

export async function minWages() {
  return sql<{ effective_from: string; hourly: number }[]>`
    select m.effective_from, m.hourly from min_wages m join settings s on s.min_wage_region = m.region order by m.effective_from`;
}

// ---------------- 打刻 ----------------
export interface PunchRow { id: number; staff_id: number; store_id: number | null; work_date: string; kind: PunchKind; minute: number; via: string; original_minute: number | null; correction_reason: string | null; face: 'ok' | 'mismatch' | 'skipped' | 'registered' | 'reregistered' | null }

/** q：トランザクションの中から読むときは tx を渡す（同じ接続で読む） */
export async function punchesBetween(from: string, to: string, staffId?: number, q: postgres.Sql = sql): Promise<PunchRow[]> {
  return q<PunchRow[]>`select id, staff_id, store_id, work_date, kind, minute, via, original_minute, correction_reason, face
    from punches where not voided and work_date between ${from} and ${to}
    and (${staffId ?? null}::int is null or staff_id = ${staffId ?? null})
    order by work_date, minute, id`;
}

/**
 * 打刻する勤務日と時刻（分）を決める。
 * 深夜 5:00 より前で、前日の勤務が退勤していなければ「前日の続き」（例：翌1:30 → 前日の 25:30）。
 */
export async function resolveWorkDay(staffId: number, now = new Date(), q: postgres.Sql = sql): Promise<{ date: string; minute: number; punches: Punch[] }> {
  const t = jstParts(now);
  if (t.minute < DAY_BOUNDARY_MIN) {
    const prev = addDays(t.date, -1);
    const pp = await punchesBetween(prev, prev, staffId, q);
    const d = decideWorkDay(t, prev, pp.length ? pp[pp.length - 1].kind : 'none');
    if (d.date === prev) return { ...d, punches: pp };
  }
  const tp = await punchesBetween(t.date, t.date, staffId, q);
  return { date: t.date, minute: t.minute, punches: tp };
}

// 同時に動くと困る処理の順番待ち（トランザクションの間だけ。pg_advisory_xact_lock の1つ目の番号）
export const LOCK = { punch: 7101, hopes: 7102, month: 7103 } as const;
/** 店舗と月を1つの番号に（月ごとの公開・取り込みの順番待ち用） */
export const monthKey = (storeId: number, year: number, month: number) => storeId * 10000 + (year - 2000) * 12 + month;

export async function recordPunch(staffId: number, kind: PunchKind, via: 'mobile' | 'terminal', face: { face: string; distance: number | null } | null = null): Promise<{ ok: true; date: string; minute: number } | { ok: false; error: string }> {
  // 同じ人の打刻は1つずつ順番に（スマホと店舗端末から同時に押されても、同じ打刻を二重に入れない）
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK.punch}, ${staffId})`;
    const day = await resolveWorkDay(staffId, new Date(), tx as unknown as postgres.Sql); // 順番が来てから、同じ接続で今の打刻を読む
    if (!canPunch(day.punches, kind)) return { ok: false as const, error: 'いまはこの打刻はできません。画面を更新して状態を確認してください。' };
    const last = day.punches[day.punches.length - 1];
    if (last && day.minute - last.minute < 1 && last.kind === kind) return { ok: false as const, error: '同じ打刻が続けて押されました。' };
    const [st] = await tx<{ store_id: number | null }[]>`select store_id from staff where id = ${staffId}`;
    await tx`insert into punches (staff_id, store_id, work_date, kind, minute, via, face, face_distance) values (${staffId}, ${st?.store_id ?? null}, ${day.date}, ${kind}, ${day.minute}, ${via}, ${face?.face ?? null}, ${face?.distance ?? null})`;
    return { ok: true as const, date: day.date, minute: day.minute };
  });
}

// ---------------- 打刻修正の申請 ----------------
export interface CorrectionRow { id: number; staff_id: number; staff_name: string; work_date: string; kind: PunchKind; minute: number; reason: string; status: 'pending' | 'approved' | 'rejected'; created_at: Date }

export async function listCorrections(opts: { status?: string; staffId?: number } = {}): Promise<CorrectionRow[]> {
  return sql<CorrectionRow[]>`select c.id, c.staff_id, s.name as staff_name, c.work_date, c.kind, c.minute, c.reason, c.status, c.created_at
    from correction_requests c join staff s on s.id = c.staff_id
    where (${opts.status ?? null}::text is null or c.status = ${opts.status ?? null})
      and (${opts.staffId ?? null}::int is null or c.staff_id = ${opts.staffId ?? null})
    order by c.created_at desc limit 200`;
}

/** 申請を承認・却下する。ほかの人が先に処理していたときは false（何もしない） */
export async function decideCorrection(actorId: number, id: number, approve: boolean): Promise<boolean> {
  const done = await sql.begin(async (tx) => {
    const [c] = await tx<CorrectionRow[]>`select * from correction_requests where id = ${id} and status = 'pending' for update`;
    if (!c) return false;
    await tx`select pg_advisory_xact_lock(${LOCK.punch}, ${c.staff_id})`;
    if (approve) {
      // 同じ種類の打刻がその日にあれば最初の1件を直す（修正前の時刻は残す）。なければ追加する。
      const [p] = await tx<{ id: number; minute: number; original_minute: number | null }[]>`
        select id, minute, original_minute from punches where staff_id = ${c.staff_id} and work_date = ${c.work_date} and kind = ${c.kind} and not voided
        order by minute limit 1`;
      if (p) {
        await tx`update punches set minute = ${c.minute}, original_minute = coalesce(original_minute, ${p.minute}), correction_reason = ${c.reason} where id = ${p.id}`;
      } else {
        const [st] = await tx<{ store_id: number | null }[]>`select store_id from staff where id = ${c.staff_id}`;
        await tx`insert into punches (staff_id, store_id, work_date, kind, minute, via, correction_reason)
          values (${c.staff_id}, ${st?.store_id ?? null}, ${c.work_date}, ${c.kind}, ${c.minute}, 'correction', ${c.reason})`;
      }
    }
    await tx`update correction_requests set status = ${approve ? 'approved' : 'rejected'}, decided_by = ${actorId}, decided_at = now() where id = ${id}`;
    return true;
  });
  if (!done) return false;
  await audit(actorId, approve ? 'correction_approved' : 'correction_rejected', { id });
  return true;
}

// ---------------- シフト ----------------
export interface ShiftCell { staff_id: number; work_date: string; start_min: number; end_min: number; parts?: Part[] | null }

// 分割シフトの列（parts）は db/update-2026-11-17-shifts.sql で足す。足す前でも画面が壊れないよう、
// 読むときは to_jsonb(行)->'parts'（列がなければ null）、書くときは列があるときだけ書く。
const partsCol = new Map<string, { ok: boolean; at: number }>();
async function colsReady(key: string, tables: string[]): Promise<boolean> {
  const c = partsCol.get(key);
  if (c && (c.ok || Date.now() - c.at < 60_000)) return c.ok;
  let ok = false;
  try {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns
      where table_schema = current_schema() and table_name = any(${tables}::text[]) and column_name = 'parts'`;
    ok = r.n === tables.length;
  } catch { ok = false; }
  partsCol.set(key, { ok, at: Date.now() });
  return ok;
}
/** シフトの時間帯の列（db/update-2026-11-17-shifts.sql） */
export const partsReady = () => colsReady('shifts', ['shifts', 'published_shifts']);
/** シフト希望の時間帯の列（db/update-2026-11-17-hopes.sql） */
export const hopePartsReady = () => colsReady('hopes', ['shift_hopes']);
/** データベースから読んだ parts を整える（壊れた値は続いたシフトとして扱う） */
export const readParts = (v: unknown): Part[] | null => {
  // 文字列で入ってしまった値（'[[525,615]]'）も読めるようにする
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  const c = cleanParts(v); return c === 'bad' ? null : c;
};
const withParts = <T extends { parts?: unknown }>(rows: T[]) => rows.map((r) => ({ ...r, parts: readParts(r.parts) }));

export async function monthBundle(storeId: number, year: number, month: number) {
  const from = ymd(year, month, 1), to = ymd(year, month, daysInMonth(year, month));
  const [[period], staff] = await Promise.all([
    sql<{ id: number; status: 'draft' | 'published' | 'changed'; hope_open: string | null; hope_deadline: string | null; published_at: Date | null }[]>`
      select id, status, hope_open, hope_deadline, published_at from shift_periods where store_id = ${storeId} and year = ${year} and month = ${month}`,
    listStaff({ storeId }),
  ]);
  const ids = staff.map((s) => s.id);
  const [drafts, published, hopes, subs, budgets, rates, mw] = await Promise.all([
    sql<ShiftCell[]>`select staff_id, work_date, start_min, end_min, to_jsonb(s)->'parts' as parts from shifts s where store_id = ${storeId} and work_date between ${from} and ${to}`.then(withParts),
    sql<ShiftCell[]>`select staff_id, work_date, start_min, end_min, to_jsonb(p)->'parts' as parts from published_shifts p where store_id = ${storeId} and work_date between ${from} and ${to}`.then(withParts),
    ids.length ? sql<ShiftCell[]>`select staff_id, work_date, start_min, end_min, to_jsonb(h)->'parts' as parts from shift_hopes h where staff_id = any(${ids}) and work_date between ${from} and ${to}`.then(withParts) : Promise.resolve([] as ShiftCell[]),
    ids.length ? sql<{ staff_id: number; submitted_at: Date }[]>`select staff_id, submitted_at from hope_submissions where staff_id = any(${ids}) and year = ${year} and month = ${month}` : Promise.resolve([]),
    sql<{ work_date: string; amount: number }[]>`select work_date, amount from daily_budgets where store_id = ${storeId} and work_date between ${from} and ${to}`,
    ratesFor(ids),
    minWages(),
  ]);
  return { from, to, period: period ?? null, staff, drafts, published, hopes, subs, budgets, rates: Object.fromEntries(rates), minWages: mw };
}

export async function ensurePeriod(storeId: number, year: number, month: number) {
  const [p] = await sql<{ id: number; status: string }[]>`
    insert into shift_periods (store_id, year, month) values (${storeId}, ${year}, ${month})
    on conflict (store_id, year, month) do update set store_id = excluded.store_id returning id, status`;
  return p;
}

export async function upsertShift(actorId: number, c: { storeId: number; staffId: number; date: string; start: number; end: number; parts?: Part[] | null } | { storeId: number; staffId: number; date: string; delete: true }) {
  const [y, m] = c.date.split('-').map(Number);
  const p = await ensurePeriod(c.storeId, y, m);
  if ('delete' in c) await sql`delete from shifts where staff_id = ${c.staffId} and work_date = ${c.date}`;
  else if (await partsReady()) {
    // 時間帯（スマレジの時間どおり）を残すのは、時間帯をそのまま渡されたときだけ。時間を変えたらアプリの決まり（休憩を自動で引く）
    const parts = c.parts && c.parts.length ? c.parts : null;
    await sql`insert into shifts (staff_id, work_date, store_id, start_min, end_min, parts) values (${c.staffId}, ${c.date}, ${c.storeId}, ${c.start}, ${c.end}, (${parts ? JSON.stringify(parts) : null}::text)::jsonb)
      on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min, parts = excluded.parts, updated_at = now()`;
  } else await sql`insert into shifts (staff_id, work_date, store_id, start_min, end_min) values (${c.staffId}, ${c.date}, ${c.storeId}, ${c.start}, ${c.end})
      on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min, updated_at = now()`;
  if (p.status === 'published') await sql`update shift_periods set status = 'changed' where id = ${p.id}`;
  await audit(actorId, 'shift_edit', c);
}

export async function publishMonth(actorId: number, storeId: number, year: number, month: number) {
  const from = ymd(year, month, 1), to = ymd(year, month, daysInMonth(year, month));
  await ensurePeriod(storeId, year, month);
  const withP = await partsReady();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK.month}, ${monthKey(storeId, year, month)})`; // 2人が同時に公開しても順番に
    await tx`delete from published_shifts where store_id = ${storeId} and work_date between ${from} and ${to}`;
    if (withP) await tx`insert into published_shifts (staff_id, work_date, store_id, start_min, end_min, parts)
      select staff_id, work_date, store_id, start_min, end_min, parts from shifts where store_id = ${storeId} and work_date between ${from} and ${to}`;
    else await tx`insert into published_shifts (staff_id, work_date, store_id, start_min, end_min)
      select staff_id, work_date, store_id, start_min, end_min from shifts where store_id = ${storeId} and work_date between ${from} and ${to}`;
    await tx`update shift_periods set status = 'published', published_at = now() where store_id = ${storeId} and year = ${year} and month = ${month}`;
  });
  await audit(actorId, 'shift_publish', { storeId, year, month });
}

/** 公開済みシフト（スタッフ向け）。店舗をまたいで本人分を取りたいときは storeId を省略 */
export async function publishedShifts(from: string, to: string, opts: { storeId?: number; staffId?: number } = {}) {
  return sql<(ShiftCell & { store_id: number })[]>`select staff_id, work_date, store_id, start_min, end_min, to_jsonb(p)->'parts' as parts from published_shifts p
    where work_date between ${from} and ${to}
      and (${opts.storeId ?? null}::int is null or store_id = ${opts.storeId ?? null})
      and (${opts.staffId ?? null}::int is null or staff_id = ${opts.staffId ?? null})
    order by work_date, start_min`.then(withParts);
}

// ---------------- 管理者による勤怠の直接修正 ----------------
/** その日の打刻を、指定した内容にそろえる（変えた打刻は修正前の時刻を残し、消した打刻は無効にする。記録は消さない） */
export async function replaceDayPunches(actorId: number, staffId: number, date: string, items: { id?: number | null; kind: PunchKind; minute: number }[], reason: string) {
  let before: { id: number; kind: PunchKind; minute: number }[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK.punch}, ${staffId})`;
    // 順番が来てから、今の打刻を読む（直している間にスタッフが打刻しても食い違わないように）
    before = (await tx<{ id: string | number; kind: PunchKind; minute: number }[]>`
      select id, kind, minute from punches where staff_id = ${staffId} and work_date = ${date} and not voided order by minute, id`).map((p) => ({ ...p, id: Number(p.id) }));
    const [st] = await tx<{ store_id: number | null }[]>`select store_id from staff where id = ${staffId}`;
    const keep = new Set(items.filter((i) => i.id).map((i) => Number(i.id)));
    for (const p of before) {
      if (!keep.has(p.id)) await tx`update punches set voided = true, correction_reason = ${reason} where id = ${p.id}`;
    }
    for (const it of items) {
      const old = it.id ? before.find((p) => p.id === Number(it.id)) : undefined;
      if (old) {
        if (old.kind !== it.kind || old.minute !== it.minute) {
          await tx`update punches set kind = ${it.kind}, minute = ${it.minute}, original_minute = coalesce(original_minute, ${old.minute}), correction_reason = ${reason} where id = ${old.id}`;
        }
      } else {
        await tx`insert into punches (staff_id, store_id, work_date, kind, minute, via, correction_reason)
          values (${staffId}, ${st?.store_id ?? null}, ${date}, ${it.kind}, ${it.minute}, 'admin', ${reason})`;
      }
    }
  });
  // 同じ日の本人からの修正申請のうち、直した結果に同じ種類・同じ時刻の打刻があるものは「承認」にする（二重に対応しないように）
  const resolved = await sql<{ id: number }[]>`update correction_requests c set status = 'approved', decided_by = ${actorId}, decided_at = now()
    where c.staff_id = ${staffId} and c.work_date = ${date} and c.status = 'pending'
      and exists (select 1 from punches p where p.staff_id = c.staff_id and p.work_date = c.work_date and not p.voided and p.kind = c.kind and p.minute = c.minute)
    returning c.id`;
  await audit(actorId, 'punches_edited', { staffId, date, reason, before: before.map((p) => [p.kind, p.minute]), after: items.map((i) => [i.kind, i.minute]), resolvedRequests: resolved.map((r) => Number(r.id)) });
  return { resolved: resolved.length };
}

// ---------------- いま出勤している人（全員が見られる） ----------------
export interface NowBoard {
  asOf: string; // HH:MM
  working: { id: number; name: string; state: 'working' | 'break'; since: number; planEnd: number | null }[];
  upcoming: { id: number; name: string; start: number; end: number }[];
  notYet: { id: number; name: string; start: number; end: number }[]; // 予定の時間を過ぎたが打刻がない
  done: number; // 今日すでに退勤した人数
}
export async function whoIsWorking(storeId?: number | null): Promise<NowBoard> {
  const t = jstParts();
  const prev = addDays(t.date, -1);
  const [staff, punches, plans] = await Promise.all([
    sql<{ id: number; name: string; store_id: number | null; sort: number }[]>`select id, name, store_id, sort from staff where active order by sort, id`,
    punchesBetween(prev, t.date),
    publishedShifts(prev, t.date),
  ]);
  const working: NowBoard['working'] = [];
  const upcoming: NowBoard['upcoming'] = [];
  const notYet: NowBoard['notYet'] = [];
  let done = 0;
  for (const s of staff) {
    if (storeId && s.store_id && s.store_id !== storeId) continue;
    const mine = punches.filter((p) => p.staff_id === s.id);
    const pp = mine.filter((p) => p.work_date === prev), tp = mine.filter((p) => p.work_date === t.date);
    // 5時より前で、前日の勤務が終わっていなければ前日の続き（日付をまたぐ勤務）
    const d = decideWorkDay(t, prev, pp.length ? pp[pp.length - 1].kind : 'none');
    const day = d.date === prev ? pp : tp;
    const plan = plans.find((x) => x.staff_id === s.id && x.work_date === d.date) ?? null;
    const last = day[day.length - 1];
    if (last && last.kind !== 'out') {
      const lastIn = [...day].reverse().find((p) => p.kind === 'in');
      working.push({ id: s.id, name: s.name, state: last.kind === 'break_start' ? 'break' : 'working', since: lastIn?.minute ?? day[0].minute, planEnd: plan?.end_min ?? null });
    } else if (last) {
      if (d.date === t.date) done++;
    } else {
      const p = plans.find((x) => x.staff_id === s.id && x.work_date === t.date);
      if (p && p.start_min > t.minute) upcoming.push({ id: s.id, name: s.name, start: p.start_min, end: p.end_min });
      else if (p && p.end_min > t.minute) notYet.push({ id: s.id, name: s.name, start: p.start_min, end: p.end_min });
    }
  }
  working.sort((a, b) => a.since - b.since);
  upcoming.sort((a, b) => a.start - b.start);
  notYet.sort((a, b) => a.start - b.start);
  return { asOf: `${Math.floor(t.minute / 60)}:${String(t.minute % 60).padStart(2, '0')}`, working, upcoming, notYet, done };
}
