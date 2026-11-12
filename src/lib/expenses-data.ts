import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sql, audit } from './db';
import { MAX_ITEMS, type Category, type DiemLine, type ExpenseItem, type ExpenseMonth, type Travel, type TripLine, type TripStop } from './expenses';

// 経費精算・旅費精算のデータ。

type ItemRow = { id: number; ym: string; day: string | null; doc: string | null; payee: string; category: string; subject: string | null; amount: number };
type MonthRow = { ym: string; settle_date: string | null; settle_method: 'bank' | 'cash' | null; person: string | null };
type TravelRow = {
  ym: string; applied_on: string | null; dept: string | null; person: string | null; destination: string | null;
  schedule: TripStop[]; diem: DiemLine[]; lodge: DiemLine[]; lines: TripLine[]; advance: number;
};

const toItem = (r: ItemRow): ExpenseItem => ({ id: r.id, ym: r.ym, day: r.day, doc: r.doc, payee: r.payee, category: r.category as Category, subject: r.subject, amount: r.amount });
const toMonth = (r: MonthRow): ExpenseMonth => ({ ym: r.ym, settleDate: r.settle_date, settleMethod: r.settle_method, person: r.person });
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const toTravel = (r: TravelRow): Travel => ({
  ym: r.ym, appliedOn: r.applied_on, dept: r.dept ?? '', person: r.person ?? '', destination: r.destination ?? '',
  schedule: arr(r.schedule), diem: arr<DiemLine>(r.diem).map((d) => ({ ...d, count: Number(d.count) })), lodge: arr<DiemLine>(r.lodge).map((d) => ({ ...d, count: Number(d.count) })),
  lines: arr(r.lines), advance: r.advance,
});

/** 1か月分（経費の並びは日付順、日付なしは最後） */
export async function monthData(ym: string) {
  const [items, months, travels] = await Promise.all([
    sql<ItemRow[]>`select id, ym, day, doc, payee, category, subject, amount from expense_items where ym = ${ym} order by day nulls last, id`,
    sql<MonthRow[]>`select ym, settle_date, settle_method, person from expense_months where ym = ${ym}`,
    sql<TravelRow[]>`select ym, applied_on, dept, person, destination, schedule, diem, lodge, lines, advance from travel_reports where ym = ${ym}`,
  ]);
  return { items: items.map(toItem), month: months[0] ? toMonth(months[0]) : null, travel: travels[0] ? toTravel(travels[0]) : null };
}

/** 入力がある月の一覧（新しい順） */
export async function monthList() {
  return sql<{ ym: string; items: number; total: number; travel: boolean }[]>`
    select m.ym,
      (select count(*)::int from expense_items i where i.ym = m.ym) as items,
      (select coalesce(sum(amount), 0)::int from expense_items i where i.ym = m.ym) as total,
      exists (select 1 from travel_reports t where t.ym = m.ym) as travel
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

/** 旅費精算書（月1枚）を保存 */
export async function saveTravel(actorId: number, t: Travel) {
  await sql`insert into travel_reports (ym, applied_on, dept, person, destination, schedule, diem, lodge, lines, advance, created_by)
    values (${t.ym}, ${t.appliedOn}, ${t.dept || null}, ${t.person || null}, ${t.destination || null}, ${sql.json(t.schedule as never)},
      ${sql.json(t.diem as never)}, ${sql.json(t.lodge as never)}, ${sql.json(t.lines as never)}, ${t.advance}, ${actorId})
    on conflict (ym) do update set applied_on = excluded.applied_on, dept = excluded.dept, person = excluded.person, destination = excluded.destination,
      schedule = excluded.schedule, diem = excluded.diem, lodge = excluded.lodge, lines = excluded.lines, advance = excluded.advance, updated_at = now()`;
  await touch(t.ym);
  await audit(actorId, 'travel_save', { ym: t.ym });
}
export async function deleteTravel(actorId: number, ym: string) {
  const [r] = await sql<{ ym: string }[]>`delete from travel_reports where ym = ${ym} returning ym`;
  if (r) { await touch(ym); await audit(actorId, 'travel_delete', { ym }); }
  return !!r;
}

/** 前に入れた所属・氏名・日当の行（新しい旅費精算書の初期値） */
export async function lastTravelDefaults() {
  const [r] = await sql<{ dept: string | null; person: string | null; diem: DiemLine[]; lodge: DiemLine[] }[]>`
    select dept, person, diem, lodge from travel_reports order by ym desc limit 1`;
  const zero = (l: unknown) => arr<DiemLine>(l).map((d) => ({ label: d.label, unit: d.unit, count: 0 }));
  return { dept: r?.dept ?? '', person: r?.person ?? '', diem: r ? zero(r.diem) : [], lodge: r ? zero(r.lodge) : [] };
}

// ---------- 合言葉（ドライブに保存する Apps Script 用） ----------
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

// ---------- ドライブへの自動保存の結果 ----------
export type FormResult = { ym: string; file: string; folder?: string; status: 'created' | 'saved' | 'unchanged' | 'edited' | 'exists' | 'error'; url?: string; error?: string };
export type FormSync = { at: string; results: FormResult[] };
const STATUSES = ['created', 'saved', 'unchanged', 'edited', 'exists', 'error'];
export async function saveFormSync(raw: unknown) {
  const list = Array.isArray(raw) ? raw.slice(0, 6) : [];
  const results: FormResult[] = [];
  for (const x of list as Record<string, unknown>[]) {
    if (!x || typeof x !== 'object' || typeof x.ym !== 'string' || !STATUSES.includes(String(x.status))) continue;
    const url = typeof x.url === 'string' && /^https:\/\/(docs|drive)\.google\.com\//.test(x.url) ? x.url.slice(0, 300) : undefined;
    results.push({
      ym: x.ym.slice(0, 7), file: String(x.file ?? '').slice(0, 80), folder: x.folder ? String(x.folder).slice(0, 80) : undefined,
      status: x.status as FormResult['status'], url, error: x.error ? String(x.error).slice(0, 200) : undefined,
    });
  }
  const v: FormSync = { at: new Date().toISOString(), results };
  await sql`update settings set form_sync = ${sql.json(v as never)}, expense_pulled_at = now() where id = 1`;
}
export async function formSync(): Promise<FormSync | null> {
  const [s] = await sql<{ form_sync: FormSync | null }[]>`select form_sync from settings where id = 1`;
  return s?.form_sync ?? null;
}
