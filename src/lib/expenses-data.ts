import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sql, audit } from './db';
import { MAX_ITEMS, monthSheets, type Category, type ExpenseItem, type ExpenseMonth, type Trip, type TripLine, type TripStop, type SheetCells } from './expenses';

// 経費精算・旅費精算のデータ。どこかを変えたら expense_months.updated_at を進める（スプレッドシートへの反映の目印）。

type ItemRow = { id: number; ym: string; day: string | null; doc: string | null; payee: string; category: string; subject: string | null; amount: number };
type MonthRow = { ym: string; settle_date: string | null; settle_method: 'bank' | 'cash' | null; person: string | null; updated_at: Date };
type TripRow = {
  id: number; ym: string; applied_on: string | null; dept: string | null; person: string | null; destination: string | null;
  schedule: TripStop[]; diem_unit: number; diem_days: string | number; lodge_unit: number; lodge_nights: string | number; lines: TripLine[]; advance: number;
};

const toItem = (r: ItemRow): ExpenseItem => ({ id: r.id, ym: r.ym, day: r.day, doc: r.doc, payee: r.payee, category: r.category as Category, subject: r.subject, amount: r.amount });
const toMonth = (r: MonthRow): ExpenseMonth => ({ ym: r.ym, settleDate: r.settle_date, settleMethod: r.settle_method, person: r.person });
const toTrip = (r: TripRow): Trip => ({
  id: r.id, ym: r.ym, appliedOn: r.applied_on, dept: r.dept ?? '', person: r.person ?? '', destination: r.destination ?? '',
  schedule: Array.isArray(r.schedule) ? r.schedule : [], diemUnit: r.diem_unit, diemDays: Number(r.diem_days),
  lodgeUnit: r.lodge_unit, lodgeNights: Number(r.lodge_nights), lines: Array.isArray(r.lines) ? r.lines : [], advance: r.advance,
});

/** 1か月分（並びは日付順、日付なしは最後） */
export async function monthData(ym: string) {
  const [items, months, trips] = await Promise.all([
    sql<ItemRow[]>`select id, ym, day, doc, payee, category, subject, amount from expense_items where ym = ${ym} order by day nulls last, id`,
    sql<MonthRow[]>`select ym, settle_date, settle_method, person, updated_at from expense_months where ym = ${ym}`,
    sql<TripRow[]>`select id, ym, applied_on, dept, person, destination, schedule, diem_unit, diem_days, lodge_unit, lodge_nights, lines, advance
      from travel_reports where ym = ${ym} order by id`,
  ]);
  return { items: items.map(toItem), month: months[0] ? toMonth(months[0]) : null, trips: trips.map(toTrip), updatedAt: months[0]?.updated_at ?? null };
}

/** 入力がある月の一覧（新しい順） */
export async function monthList() {
  return sql<{ ym: string; items: number; total: number; trips: number }[]>`
    select m.ym,
      (select count(*)::int from expense_items i where i.ym = m.ym) as items,
      (select coalesce(sum(amount), 0)::int from expense_items i where i.ym = m.ym) as total,
      (select count(*)::int from travel_reports t where t.ym = m.ym) as trips
    from expense_months m order by m.ym desc limit 36`;
}

async function touch(ym: string) {
  await sql`insert into expense_months (ym) values (${ym}) on conflict (ym) do update set updated_at = now()`;
}

export async function addItem(actorId: number, v: Omit<ExpenseItem, 'id'>): Promise<string | null> {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from expense_items where ym = ${v.ym}`;
  if (n >= MAX_ITEMS) return `現金経費精算は1か月${MAX_ITEMS}行までです（用紙の行数）。まとめられる行をまとめてください`;
  await sql`insert into expense_items (ym, day, doc, payee, category, subject, amount, created_by)
    values (${v.ym}, ${v.day}, ${v.doc}, ${v.payee}, ${v.category}, ${v.subject}, ${v.amount}, ${actorId})`;
  await touch(v.ym);
  await audit(actorId, 'expense_add', { ym: v.ym, category: v.category, amount: v.amount });
  return null;
}
export async function updateItem(actorId: number, id: number, v: Omit<ExpenseItem, 'id'>): Promise<string | null> {
  const [old] = await sql<{ ym: string }[]>`select ym from expense_items where id = ${id}`;
  if (!old) return 'その行は見つかりませんでした（消された可能性があります）';
  if (old.ym !== v.ym) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from expense_items where ym = ${v.ym}`;
    if (n >= MAX_ITEMS) return `移す先の月が${MAX_ITEMS}行に達しています`;
  }
  await sql`update expense_items set ym = ${v.ym}, day = ${v.day}, doc = ${v.doc}, payee = ${v.payee}, category = ${v.category},
    subject = ${v.subject}, amount = ${v.amount}, updated_at = now() where id = ${id}`;
  await touch(v.ym);
  if (old.ym !== v.ym) await touch(old.ym);
  await audit(actorId, 'expense_update', { id, ym: v.ym, amount: v.amount });
  return null;
}
export async function deleteItem(actorId: number, id: number) {
  const [r] = await sql<{ ym: string }[]>`delete from expense_items where id = ${id} returning ym`;
  if (r) { await touch(r.ym); await audit(actorId, 'expense_delete', { id, ym: r.ym }); }
  return !!r;
}
export async function saveFooter(actorId: number, m: ExpenseMonth) {
  await sql`insert into expense_months (ym, settle_date, settle_method, person) values (${m.ym}, ${m.settleDate}, ${m.settleMethod}, ${m.person})
    on conflict (ym) do update set settle_date = excluded.settle_date, settle_method = excluded.settle_method, person = excluded.person, updated_at = now()`;
  await audit(actorId, 'expense_footer', { ym: m.ym });
}

export async function saveTrip(actorId: number, id: number | null, t: Omit<Trip, 'id'>): Promise<{ id: number } | { error: string }> {
  if (id) {
    const [old] = await sql<{ ym: string }[]>`select ym from travel_reports where id = ${id}`;
    if (!old) return { error: 'その旅費精算書は見つかりませんでした（消された可能性があります）' };
    await sql`update travel_reports set ym = ${t.ym}, applied_on = ${t.appliedOn}, dept = ${t.dept || null}, person = ${t.person || null},
      destination = ${t.destination || null}, schedule = ${sql.json(t.schedule as never)}, diem_unit = ${t.diemUnit}, diem_days = ${t.diemDays},
      lodge_unit = ${t.lodgeUnit}, lodge_nights = ${t.lodgeNights}, lines = ${sql.json(t.lines as never)}, advance = ${t.advance}, updated_at = now()
      where id = ${id}`;
    await touch(t.ym);
    if (old.ym !== t.ym) await touch(old.ym);
    await audit(actorId, 'travel_update', { id, ym: t.ym });
    return { id };
  }
  const [r] = await sql<{ id: number }[]>`insert into travel_reports
    (ym, applied_on, dept, person, destination, schedule, diem_unit, diem_days, lodge_unit, lodge_nights, lines, advance, created_by)
    values (${t.ym}, ${t.appliedOn}, ${t.dept || null}, ${t.person || null}, ${t.destination || null}, ${sql.json(t.schedule as never)},
      ${t.diemUnit}, ${t.diemDays}, ${t.lodgeUnit}, ${t.lodgeNights}, ${sql.json(t.lines as never)}, ${t.advance}, ${actorId}) returning id`;
  await touch(t.ym);
  await audit(actorId, 'travel_add', { id: r.id, ym: t.ym });
  return { id: r.id };
}
export async function deleteTrip(actorId: number, id: number) {
  const [r] = await sql<{ ym: string }[]>`delete from travel_reports where id = ${id} returning ym`;
  if (r) { await touch(r.ym); await audit(actorId, 'travel_delete', { id, ym: r.ym }); }
  return !!r;
}

/** 前に入れた所属・氏名（新しい旅費精算書の初期値） */
export async function lastTripDefaults() {
  const [r] = await sql<{ dept: string | null; person: string | null }[]>`select dept, person from travel_reports order by id desc limit 1`;
  return { dept: r?.dept ?? '', person: r?.person ?? '' };
}

/** 書き出すシート（Excel・スプレッドシート共通） */
export async function sheetsFor(ym: string): Promise<SheetCells[]> {
  const d = await monthData(ym);
  return monthSheets(ym, d.month, d.items, d.trips);
}

/** スプレッドシートへ：since より後に変わった月（since なしなら全部）。古い順 */
export async function changedMonths(since: Date | null) {
  const rows = since
    ? await sql<{ ym: string; updated_at: Date }[]>`select ym, updated_at from expense_months where updated_at > ${since} order by ym limit 60`
    : await sql<{ ym: string; updated_at: Date }[]>`select ym, updated_at from expense_months order by ym limit 60`;
  const out: { ym: string; sheets: SheetCells[] }[] = [];
  for (const r of rows) out.push({ ym: r.ym, sheets: await sheetsFor(r.ym) });
  return out;
}

// ---------- 合言葉（専用スプレッドシートの Apps Script 用） ----------
export async function expenseSecret(): Promise<string> {
  const [s] = await sql<{ expense_secret: string | null }[]>`select expense_secret from settings where id = 1`;
  return s?.expense_secret ?? (await rotateExpenseSecret());
}
export async function rotateExpenseSecret() {
  const v = randomBytes(24).toString('base64url');
  await sql`update settings set expense_secret = ${v} where id = 1`;
  return v;
}
export async function checkExpenseSecret(given: string | null) {
  const [s] = await sql<{ expense_secret: string | null }[]>`select expense_secret from settings where id = 1`;
  if (!s?.expense_secret || !given) return false;
  const a = Buffer.from(s.expense_secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** スプレッドシートが最後に取りに来た時刻（画面に出す） */
export async function notePull() {
  await sql`update settings set expense_pulled_at = now() where id = 1`;
}
export async function lastPull(): Promise<Date | null> {
  const [s] = await sql<{ expense_pulled_at: Date | null }[]>`select expense_pulled_at from settings where id = 1`;
  return s?.expense_pulled_at ?? null;
}
