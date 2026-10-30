import 'server-only';
import { sql, audit } from './db';
import { canPunch, decideWorkDay, type Punch, type PunchKind, type WageRate } from './calc';
import { addDays, DAY_BOUNDARY_MIN, jstParts, ymd, daysInMonth } from './time';

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
export interface PunchRow { id: number; staff_id: number; store_id: number | null; work_date: string; kind: PunchKind; minute: number; via: string; original_minute: number | null; correction_reason: string | null }

export async function punchesBetween(from: string, to: string, staffId?: number): Promise<PunchRow[]> {
  return sql<PunchRow[]>`select id, staff_id, store_id, work_date, kind, minute, via, original_minute, correction_reason
    from punches where not voided and work_date between ${from} and ${to}
    and (${staffId ?? null}::int is null or staff_id = ${staffId ?? null})
    order by work_date, minute, id`;
}

/**
 * 打刻する勤務日と時刻（分）を決める。
 * 深夜 5:00 より前で、前日の勤務が退勤していなければ「前日の続き」（例：翌1:30 → 前日の 25:30）。
 */
export async function resolveWorkDay(staffId: number, now = new Date()): Promise<{ date: string; minute: number; punches: Punch[] }> {
  const t = jstParts(now);
  if (t.minute < DAY_BOUNDARY_MIN) {
    const prev = addDays(t.date, -1);
    const pp = await punchesBetween(prev, prev, staffId);
    const d = decideWorkDay(t, prev, pp.length ? pp[pp.length - 1].kind : 'none');
    if (d.date === prev) return { ...d, punches: pp };
  }
  const tp = await punchesBetween(t.date, t.date, staffId);
  return { date: t.date, minute: t.minute, punches: tp };
}

export async function recordPunch(staffId: number, kind: PunchKind, via: 'mobile' | 'terminal'): Promise<{ ok: true; date: string; minute: number } | { ok: false; error: string }> {
  const day = await resolveWorkDay(staffId);
  if (!canPunch(day.punches, kind)) return { ok: false, error: 'いまはこの打刻はできません。画面を更新して状態を確認してください。' };
  const last = day.punches[day.punches.length - 1];
  if (last && day.minute - last.minute < 1 && last.kind === kind) return { ok: false, error: '同じ打刻が続けて押されました。' };
  const [st] = await sql<{ store_id: number | null }[]>`select store_id from staff where id = ${staffId}`;
  await sql`insert into punches (staff_id, store_id, work_date, kind, minute, via) values (${staffId}, ${st?.store_id ?? null}, ${day.date}, ${kind}, ${day.minute}, ${via})`;
  return { ok: true, date: day.date, minute: day.minute };
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

export async function decideCorrection(actorId: number, id: number, approve: boolean) {
  await sql.begin(async (tx) => {
    const [c] = await tx<CorrectionRow[]>`select * from correction_requests where id = ${id} and status = 'pending' for update`;
    if (!c) return;
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
  });
  await audit(actorId, approve ? 'correction_approved' : 'correction_rejected', { id });
}

// ---------------- シフト ----------------
export interface ShiftCell { staff_id: number; work_date: string; start_min: number; end_min: number }

export async function monthBundle(storeId: number, year: number, month: number) {
  const from = ymd(year, month, 1), to = ymd(year, month, daysInMonth(year, month));
  const [period] = await sql<{ id: number; status: 'draft' | 'published' | 'changed'; hope_open: string | null; hope_deadline: string | null; published_at: Date | null }[]>`
    select id, status, hope_open, hope_deadline, published_at from shift_periods where store_id = ${storeId} and year = ${year} and month = ${month}`;
  const staff = await listStaff({ storeId });
  const ids = staff.map((s) => s.id);
  const [drafts, published, hopes, subs, budgets, rates, mw] = await Promise.all([
    sql<ShiftCell[]>`select staff_id, work_date, start_min, end_min from shifts where store_id = ${storeId} and work_date between ${from} and ${to}`,
    sql<ShiftCell[]>`select staff_id, work_date, start_min, end_min from published_shifts where store_id = ${storeId} and work_date between ${from} and ${to}`,
    ids.length ? sql<ShiftCell[]>`select staff_id, work_date, start_min, end_min from shift_hopes where staff_id = any(${ids}) and work_date between ${from} and ${to}` : Promise.resolve([] as ShiftCell[]),
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

export async function upsertShift(actorId: number, c: { storeId: number; staffId: number; date: string; start: number; end: number } | { storeId: number; staffId: number; date: string; delete: true }) {
  const [y, m] = c.date.split('-').map(Number);
  const p = await ensurePeriod(c.storeId, y, m);
  if ('delete' in c) await sql`delete from shifts where staff_id = ${c.staffId} and work_date = ${c.date}`;
  else await sql`insert into shifts (staff_id, work_date, store_id, start_min, end_min) values (${c.staffId}, ${c.date}, ${c.storeId}, ${c.start}, ${c.end})
      on conflict (staff_id, work_date) do update set store_id = excluded.store_id, start_min = excluded.start_min, end_min = excluded.end_min, updated_at = now()`;
  if (p.status === 'published') await sql`update shift_periods set status = 'changed' where id = ${p.id}`;
  await audit(actorId, 'shift_edit', c);
}

export async function publishMonth(actorId: number, storeId: number, year: number, month: number) {
  const from = ymd(year, month, 1), to = ymd(year, month, daysInMonth(year, month));
  await ensurePeriod(storeId, year, month);
  await sql.begin(async (tx) => {
    await tx`delete from published_shifts where store_id = ${storeId} and work_date between ${from} and ${to}`;
    await tx`insert into published_shifts (staff_id, work_date, store_id, start_min, end_min)
      select staff_id, work_date, store_id, start_min, end_min from shifts where store_id = ${storeId} and work_date between ${from} and ${to}`;
    await tx`update shift_periods set status = 'published', published_at = now() where store_id = ${storeId} and year = ${year} and month = ${month}`;
  });
  await audit(actorId, 'shift_publish', { storeId, year, month });
}

/** 公開済みシフト（スタッフ向け）。店舗をまたいで本人分を取りたいときは storeId を省略 */
export async function publishedShifts(from: string, to: string, opts: { storeId?: number; staffId?: number } = {}) {
  return sql<(ShiftCell & { store_id: number })[]>`select staff_id, work_date, store_id, start_min, end_min from published_shifts
    where work_date between ${from} and ${to}
      and (${opts.storeId ?? null}::int is null or store_id = ${opts.storeId ?? null})
      and (${opts.staffId ?? null}::int is null or staff_id = ${opts.staffId ?? null})
    order by work_date, start_min`;
}

// ---------------- 管理者による勤怠の直接修正 ----------------
/** その日の打刻を、指定した内容にそろえる（変えた打刻は修正前の時刻を残し、消した打刻は無効にする。記録は消さない） */
export async function replaceDayPunches(actorId: number, staffId: number, date: string, items: { id?: number | null; kind: PunchKind; minute: number }[], reason: string) {
  const before = (await sql<{ id: string | number; kind: PunchKind; minute: number }[]>`
    select id, kind, minute from punches where staff_id = ${staffId} and work_date = ${date} and not voided order by minute, id`).map((p) => ({ ...p, id: Number(p.id) }));
  await sql.begin(async (tx) => {
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
  await audit(actorId, 'punches_edited', { staffId, date, reason, before: before.map((p) => [p.kind, p.minute]), after: items.map((i) => [i.kind, i.minute]) });
}
