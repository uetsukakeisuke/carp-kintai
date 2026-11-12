import 'server-only';
import { sql, audit } from './db';
import { addDays, daysInMonth, jstParts, ymd } from './time';
import { buildReport, type Cell } from './kobo';
import { latestSnapshot } from './ledger';
import { punchesBetween, listStaff, ratesFor, ensurePeriod } from './data';
import { planCost, summarizeDay, wageAt } from './calc';
import {
  readParams, dayLoads, predictMin, fit, planDraft, addTo, weekdayOf, MIN_LEARN_DAYS,
  type ForecastParams, type Coef, type Sample, type Load, type DayLoad, type Window, type DraftDay,
} from './forecast';

// ---------- 設定 ----------
/** 予測の設定。ready=false はデータベースの準備（SQL）がまだ */
export async function forecastParams(): Promise<{ params: ForecastParams; ready: boolean }> {
  try {
    const [s] = await sql<{ forecast: unknown }[]>`select forecast from settings where id = 1`;
    return { params: readParams(s?.forecast), ready: true };
  } catch {
    return { params: readParams(null), ready: false };
  }
}
export async function saveForecastParams(actorId: number, p: ForecastParams) {
  await sql`update settings set forecast = ${sql.json(p as never)} where id = 1`;
  await audit(actorId, 'forecast_params', p);
}

// ---------- 学習の記録（台帳が届くたび） ----------
const keyOf = (r: { part: string; customer: string; orderNo: string; qtyN: number }) => `${r.part}|${r.customer}|${r.orderNo}|${r.qtyN}`;
/** 前回の台帳と比べて、「仕入」「客先納品」が済になった行を、今日の作業として記録する */
export async function recordLedgerChanges(prev: Cell[][] | null, next: Cell[][]) {
  const today = jstParts().date;
  await sql`insert into ledger_days (day) values (${today}) on conflict do nothing`;
  if (!prev) return 0;
  const a = buildReport(prev, [], today).rows, b = buildReport(next, [], today).rows;
  const count = (rows: typeof a, f: (r: (typeof a)[number]) => boolean) => {
    const m = new Map<string, number>();
    for (const r of rows) if (f(r)) m.set(keyOf(r), (m.get(keyOf(r)) ?? 0) + 1);
    return m;
  };
  const ev: { kind: 'in' | 'out'; part: string; customer: string; qty: number; kg: number }[] = [];
  for (const [kind, f] of [['in', (r: (typeof a)[number]) => r.received && !r.fromStock], ['out', (r: (typeof a)[number]) => r.delivered && !r.toStock]] as const) {
    const before = count(a, f), after = count(b, f);
    for (const [k, n] of after) {
      const diff = n - (before.get(k) ?? 0);
      if (diff <= 0) continue;
      const r = b.find((x) => keyOf(x) === k)!;
      for (let i = 0; i < diff; i++) ev.push({ kind, part: r.part.slice(0, 200), customer: r.customer.slice(0, 200), qty: r.qtyN, kg: r.kg });
    }
  }
  for (const e of ev) {
    await sql`insert into ledger_events (event_date, kind, part, customer, qty, kg) values (${today}, ${e.kind}, ${e.part}, ${e.customer}, ${e.qty}, ${e.kg})`;
  }
  return ev.length;
}

// ---------- 学習 ----------
export type Learning = { samples: Sample[]; fitted: ReturnType<typeof fit>; using: 'learned' | 'prior'; coef: Coef };
export async function learning(storeId: number, params: ForecastParams): Promise<Learning> {
  const today = jstParts().date, from = addDays(today, -180), to = addDays(today, -1);
  const [days, events, punches] = await Promise.all([
    sql<{ day: string }[]>`select day from ledger_days where day between ${from} and ${to} order by day`,
    sql<{ event_date: string; kind: 'in' | 'out'; qty: string; kg: string }[]>`select event_date, kind, qty, kg from ledger_events where event_date between ${from} and ${to}`,
    punchesBetween(from, to),
  ]);
  const work = new Map<string, number>();
  const byStaffDay = new Map<string, typeof punches>();
  for (const p of punches) {
    if (p.store_id !== null && p.store_id !== storeId) continue;
    const k = `${p.staff_id}|${p.work_date}`;
    byStaffDay.set(k, [...(byStaffDay.get(k) ?? []), p]);
  }
  for (const [k, ps] of byStaffDay) {
    const d = k.split('|')[1];
    work.set(d, (work.get(d) ?? 0) + summarizeDay(ps, { isPast: true }).workMin);
  }
  const loads = new Map<string, Load>();
  for (const e of events) {
    const l = loads.get(e.event_date) ?? { inLines: 0, inSqrt: 0, inKg: 0, outLines: 0, outSqrt: 0, outKg: 0 };
    addTo(l, e.kind, Number(e.qty), Number(e.kg)); loads.set(e.event_date, l);
  }
  const samples: Sample[] = days.filter((d) => (work.get(d.day) ?? 0) > 0).map((d) => ({
    date: d.day, actualMin: work.get(d.day)!, workday: params.workdays.includes(weekdayOf(d.day)),
    load: loads.get(d.day) ?? { inLines: 0, inSqrt: 0, inKg: 0, outLines: 0, outSqrt: 0, outKg: 0 },
  }));
  const fitted = fit(samples, params.coef);
  const using = params.learn && fitted.n >= MIN_LEARN_DAYS ? 'learned' : 'prior';
  return { samples, fitted, using, coef: using === 'learned' ? fitted.coef : params.coef };
}

// ---------- これからの予測 ----------
export type Forecast = {
  params: ForecastParams; ready: boolean; learning: Learning | null; coef: Coef;
  ledgerAt: Date | null; loads: Map<string, DayLoad>;
  days: { date: string; workday: boolean; min: number; people: number; load: DayLoad | null }[];
};
export async function forecast(storeId: number, from: string, to: string): Promise<Forecast> {
  const today = jstParts().date;
  const { params, ready } = await forecastParams();
  const [snap, learn] = await Promise.all([latestSnapshot().catch(() => null), ready ? learning(storeId, params).catch(() => null) : Promise.resolve(null)]);
  const coef = learn?.coef ?? params.coef;
  const rows = snap ? buildReport(snap.orders, [], today).rows : [];
  const loads = dayLoads(rows, today, params.shipLead);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const workday = params.workdays.includes(weekdayOf(d)), l = loads.get(d) ?? null;
    days.push({ date: d, workday, min: predictMin(l ?? undefined, coef, workday), people: workday ? params.minPeople : 0, load: l });
  }
  return { params, ready, learning: learn, coef, ledgerAt: snap ? new Date(snap.received_at) : null, loads, days };
}

// ---------- 下書きの自動作成 ----------
export type AutoDraftResult = { batch: number; added: Window[]; days: DraftDay[]; ledger: boolean; using: 'learned' | 'prior' };
export async function autoDraft(actorId: number, storeId: number, year: number, month: number): Promise<AutoDraftResult> {
  const today = jstParts().date;
  const from = ymd(year, month, 1), to = ymd(year, month, daysInMonth(year, month));
  const start = from < today ? today : from;
  if (start > to) return { batch: 0, added: [], days: [], ledger: false, using: 'prior' };
  const staff = (await listStaff({ storeId })).filter((s) => s.pay_type === 'hourly');
  const ids = staff.map((s) => s.id);
  const [fc, hopes, drafts, rates, budgets, [store]] = await Promise.all([
    forecast(storeId, start, to),
    ids.length ? sql<{ staff_id: number; work_date: string; start_min: number; end_min: number }[]>`
      select staff_id, work_date, start_min, end_min from shift_hopes where staff_id = any(${ids}) and work_date between ${start} and ${to}` : Promise.resolve([]),
    sql<{ staff_id: number; work_date: string; start_min: number; end_min: number }[]>`
      select staff_id, work_date, start_min, end_min from shifts where store_id = ${storeId} and work_date between ${start} and ${to}`,
    ratesFor(ids),
    sql<{ work_date: string; amount: number }[]>`select work_date, amount from daily_budgets where store_id = ${storeId} and work_date between ${start} and ${to}`,
    sql<{ budget_weekday: number; budget_friday: number; budget_weekend: number }[]>`select budget_weekday, budget_friday, budget_weekend from stores where id = ${storeId}`,
  ]);
  const cost = (id: number, d: string, s: number, e: number) => {
    const c = planCost({ start: s, end: e }, wageAt(rates.get(id) ?? [], d) ?? 0);
    return { workMin: c.workMin, total: c.total };
  };
  const budget = (d: string) => {
    const o = budgets.find((b) => b.work_date === d); if (o) return o.amount;
    const w = weekdayOf(d); return w === 0 || w === 6 ? store?.budget_weekend ?? 0 : w === 5 ? store?.budget_friday ?? 0 : store?.budget_weekday ?? 0;
  };
  const W = (x: { staff_id: number; work_date: string; start_min: number; end_min: number }): Window => ({ staffId: x.staff_id, date: x.work_date, s: x.start_min, e: x.end_min });
  const plan = planDraft({
    dates: fc.days.map((d) => d.date), need: Object.fromEntries(fc.days.map((d) => [d.date, { min: d.min, people: d.people }])),
    hopes: hopes.map(W), existing: drafts.map(W), cost, budget, eligible: new Set(ids),
  });
  const batch = Math.floor(Date.now() / 1000) % 2_000_000_000;
  let added: Window[] = [];
  if (plan.add.length) {
    const period = await ensurePeriod(storeId, year, month);
    await sql.begin(async (tx) => {
      const A = plan.add;
      const ins = await tx<{ staff_id: number; work_date: string; start_min: number; end_min: number }[]>`
        insert into shifts (staff_id, work_date, store_id, start_min, end_min)
        select u.staff_id, u.work_date, ${storeId}, u.start_min, u.end_min
        from unnest(${A.map((w) => w.staffId)}::int[], ${A.map((w) => w.date)}::date[], ${A.map((w) => w.s)}::int[], ${A.map((w) => w.e)}::int[])
          as u(staff_id, work_date, start_min, end_min)
        on conflict (staff_id, work_date) do nothing
        returning staff_id, work_date::text as work_date, start_min, end_min`;
      added = ins.map(W);
      if (ins.length) {
        await tx`insert into auto_drafts (batch, store_id, staff_id, work_date, start_min, end_min, created_by)
          select ${batch}, ${storeId}, u.staff_id, u.work_date, u.start_min, u.end_min, ${actorId}
          from unnest(${ins.map((r) => r.staff_id)}::int[], ${ins.map((r) => r.work_date)}::date[], ${ins.map((r) => r.start_min)}::int[], ${ins.map((r) => r.end_min)}::int[])
            as u(staff_id, work_date, start_min, end_min)`;
        if (period.status === 'published') await tx`update shift_periods set status = 'changed' where id = ${period.id}`;
      }
    });
  }
  await audit(actorId, 'shift_auto_draft', { storeId, year, month, batch, added: added.length });
  return { batch, added, days: plan.days, ledger: !!fc.ledgerAt, using: fc.learning?.using ?? 'prior' };
}

/** 自動で入れた下書きを消す（そのあと手で時間を直したものは残す） */
export async function undoAutoDraft(actorId: number, storeId: number, batch: number): Promise<Window[]> {
  const removed = await sql.begin(async (tx) => {
    const del = await tx<{ staff_id: number; work_date: string; start_min: number; end_min: number }[]>`
      delete from shifts s using auto_drafts a
      where a.batch = ${batch} and a.store_id = ${storeId} and s.staff_id = a.staff_id and s.work_date = a.work_date
        and s.start_min = a.start_min and s.end_min = a.end_min
      returning s.staff_id, s.work_date::text as work_date, s.start_min, s.end_min`;
    await tx`delete from auto_drafts where batch = ${batch} and store_id = ${storeId}`;
    if (del.length) {
      const months = [...new Set(del.map((r) => r.work_date.slice(0, 7)))];
      for (const ym of months) await tx`update shift_periods set status = 'changed' where store_id = ${storeId} and year = ${Number(ym.slice(0, 4))} and month = ${Number(ym.slice(5, 7))} and status = 'published'`;
    }
    return del;
  });
  await audit(actorId, 'shift_auto_draft_undo', { storeId, batch, removed: removed.length });
  return removed.map((x) => ({ staffId: x.staff_id, date: x.work_date, s: x.start_min, e: x.end_min }));
}
