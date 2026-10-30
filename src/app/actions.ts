'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  login, logout, changePin, requireUser, requireManager, resetPin, verifyPin, currentTerminal, enableTerminal, disableTerminal,
  hashPin, INITIAL_PIN, isManager, punchCodeOk,
} from '@/lib/auth';
import { sql, audit } from '@/lib/db';
import { recordPunch, resolveWorkDay, decideCorrection, upsertShift, publishMonth, minWages, replaceDayPunches } from '@/lib/data';
import { minWageAt, canPunch, type PunchKind } from '@/lib/calc';
import { daysInMonth, ymd, jstParts } from '@/lib/time';
import { importPayslipFiles, assignPayslips, rotateImportSecret, setSlipPin, unlockSlips, lockSlips, resetSlipPin } from '@/lib/payslips';

type Result = { ok: true; message?: string } | { ok: false; error: string };
const KINDS: PunchKind[] = ['in', 'break_start', 'break_end', 'out'];
const PUNCH_LABEL: Record<PunchKind, string> = { in: '出勤', break_start: '休憩開始', break_end: '休憩終了', out: '退勤' };
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMin = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 1800;

// ---------- ログイン ----------
export async function loginAction(staffId: number, pin: string | null): Promise<Result & { needPin?: boolean }> {
  const r = await login(Number(staffId), pin === null ? null : String(pin));
  if (!r.ok) return r;
  redirect('/');
}
export async function logoutAction() {
  await logout();
  redirect('/login');
}
export async function changePinAction(current: string, next: string): Promise<Result> {
  const u = await requireUser({ allowMustChange: true });
  const r = await changePin(u.id, String(current), String(next));
  if (!r.ok) return { ok: false, error: r.error! };
  redirect('/');
}

// ---------- 打刻 ----------
function punchMessage(kind: PunchKind, minute: number) {
  const h = Math.floor(minute / 60), m = String(minute % 60).padStart(2, '0');
  return `${PUNCH_LABEL[kind]} ${h}:${m} を記録しました`;
}
const CODE_ERR = '打刻コードが違います。もう一度入力してください。';
export async function punchAction(kind: PunchKind, code: string): Promise<Result> {
  const u = await requireUser();
  if (!KINDS.includes(kind)) return { ok: false, error: '打刻の種類が正しくありません' };
  if (!punchCodeOk(code)) return { ok: false, error: CODE_ERR };
  const r = await recordPunch(u.id, kind, 'mobile');
  revalidatePath('/me');
  return r.ok ? { ok: true, message: punchMessage(kind, r.minute) } : r;
}

/** 店舗端末：打刻コードを確かめてから、その人の今日の状態を返す */
export async function terminalStateAction(staffId: number, code: string) {
  const t = await currentTerminal();
  if (!t) return { ok: false as const, error: 'この端末は店舗端末として設定されていません' };
  if (!punchCodeOk(code)) return { ok: false as const, error: CODE_ERR };
  const day = await resolveWorkDay(Number(staffId));
  return { ok: true as const, punches: day.punches.map((p) => ({ kind: p.kind, minute: p.minute })) };
}
export async function terminalPunchAction(staffId: number, code: string, kind: PunchKind): Promise<Result> {
  const t = await currentTerminal();
  if (!t) return { ok: false, error: 'この端末は店舗端末として設定されていません' };
  if (!KINDS.includes(kind)) return { ok: false, error: '打刻の種類が正しくありません' };
  if (!punchCodeOk(code)) return { ok: false, error: CODE_ERR };
  const [s] = await sql<{ id: number }[]>`select id from staff where id = ${Number(staffId)} and active`;
  if (!s) return { ok: false, error: 'このスタッフは利用できません' };
  const r = await recordPunch(Number(staffId), kind, 'terminal');
  return r.ok ? { ok: true, message: punchMessage(kind, r.minute) } : r;
}

export async function requestCorrectionAction(date: string, kind: PunchKind, minute: number, reason: string): Promise<Result> {
  const u = await requireUser();
  if (!isDate(date) || !KINDS.includes(kind) || !isMin(minute)) return { ok: false, error: '入力内容を確認してください' };
  if (!String(reason).trim()) return { ok: false, error: '理由を入力してください' };
  if (date > jstParts().date) return { ok: false, error: '未来の日付は申請できません' };
  await sql`insert into correction_requests (staff_id, work_date, kind, minute, reason) values (${u.id}, ${date}, ${kind}, ${minute}, ${String(reason).slice(0, 200)})`;
  revalidatePath('/me');
  return { ok: true, message: '修正を申請しました。店長の承認待ちです' };
}

// ---------- シフト希望 ----------
export async function saveHopesAction(year: number, month: number, days: { date: string; start: number; end: number }[], submit: boolean): Promise<Result> {
  const u = await requireUser();
  const from = ymd(year, month, 1), to = ymd(year, month, daysInMonth(year, month));
  const [p] = await sql<{ hope_open: string | null; hope_deadline: string | null }[]>`
    select hope_open, hope_deadline from shift_periods where store_id = ${u.store_id ?? 0} and year = ${year} and month = ${month}`;
  const today = jstParts().date;
  if (p?.hope_open && today < p.hope_open) return { ok: false, error: `${month}月分の受付は${Number(p.hope_open.slice(5, 7))}月${Number(p.hope_open.slice(8))}日からです` };
  if (p?.hope_deadline && today > p.hope_deadline) return { ok: false, error: '締切を過ぎています。変更は店長に相談してください' };
  for (const d of days) {
    if (!isDate(d.date) || d.date < from || d.date > to || !isMin(d.start) || !isMin(d.end)) return { ok: false, error: '入力内容を確認してください' };
    if (d.end <= d.start) return { ok: false, error: `${Number(d.date.slice(8))}日：終了時刻を開始時刻より後にしてください` };
  }
  await sql.begin(async (tx) => {
    await tx`delete from shift_hopes where staff_id = ${u.id} and work_date between ${from} and ${to}`;
    for (const d of days) await tx`insert into shift_hopes (staff_id, work_date, start_min, end_min) values (${u.id}, ${d.date}, ${d.start}, ${d.end})`;
    if (submit) await tx`insert into hope_submissions (staff_id, year, month) values (${u.id}, ${year}, ${month})
      on conflict (staff_id, year, month) do update set submitted_at = now()`;
  });
  revalidatePath('/me/hopes');
  return { ok: true, message: submit ? '希望を提出しました' : '保存しました' };
}

// ---------- シフト作成（店長） ----------
export async function saveShiftAction(storeId: number, staffId: number, date: string, start: number, end: number): Promise<Result> {
  const u = await requireManager();
  if (!isDate(date) || !isMin(start) || !isMin(end) || end <= start) return { ok: false, error: '時間を確認してください' };
  await upsertShift(u.id, { storeId, staffId, date, start, end });
  return { ok: true };
}
export async function deleteShiftAction(storeId: number, staffId: number, date: string): Promise<Result> {
  const u = await requireManager();
  if (!isDate(date)) return { ok: false, error: '日付が正しくありません' };
  await upsertShift(u.id, { storeId, staffId, date, delete: true });
  return { ok: true };
}
export async function publishAction(storeId: number, year: number, month: number): Promise<Result> {
  const u = await requireManager();
  await publishMonth(u.id, storeId, year, month);
  revalidatePath('/manage/shifts');
  return { ok: true, message: `${month}月のシフトを公開しました。スタッフ全員が見られます` };
}
export async function setHopePeriodAction(storeId: number, year: number, month: number, open: string, deadline: string): Promise<Result> {
  const u = await requireManager();
  const o = open || null, d = deadline || null;
  if ((o && !isDate(o)) || (d && !isDate(d))) return { ok: false, error: '日付が正しくありません' };
  if (o && d && o > d) return { ok: false, error: '受付開始日は締切日より前にしてください' };
  await sql`insert into shift_periods (store_id, year, month, hope_open, hope_deadline) values (${storeId}, ${year}, ${month}, ${o}, ${d})
    on conflict (store_id, year, month) do update set hope_open = excluded.hope_open, hope_deadline = excluded.hope_deadline`;
  await audit(u.id, 'hope_period', { storeId, year, month, open: o, deadline: d });
  revalidatePath('/manage/hopes'); revalidatePath('/me/hopes');
  return { ok: true, message: '受付期間を保存しました' };
}

// ---------- 勤怠（店長） ----------
export async function decideCorrectionAction(id: number, approve: boolean): Promise<Result> {
  const u = await requireManager();
  await decideCorrection(u.id, Number(id), Boolean(approve));
  revalidatePath('/manage/attendance');
  return { ok: true, message: approve ? '承認して勤務記録を直しました' : '申請を却下しました' };
}

// ---------- スタッフ・時給（店長） ----------
export interface StaffInput {
  name: string; kana: string; storeId: number | null; employment: string; transport: number; commuteMeans: string;
  role?: 'staff' | 'manager' | 'admin'; active?: boolean; hourly?: number; wageFrom?: string;
}
export async function saveStaffAction(id: number | null, input: StaffInput): Promise<Result> {
  const u = await requireManager();
  const name = String(input.name ?? '').trim();
  if (!name) return { ok: false, error: '氏名を入力してください' };
  const transport = Math.max(0, Math.round(Number(input.transport) || 0));
  // 権限の変更は管理者だけ
  const role = u.role === 'admin' && input.role ? input.role : undefined;
  if (id === null) {
    if (!input.hourly || !isDate(input.wageFrom)) return { ok: false, error: '時給と適用開始日を入力してください' };
    const mw = minWageAt(await minWages(), input.wageFrom);
    if (input.hourly < mw) return { ok: false, error: `最低賃金（${mw}円）を下回っています` };
    const [s] = await sql<{ id: number }[]>`insert into staff (name, kana, role, employment, store_id, transport_per_day, commute_means, pin_hash)
      values (${name}, ${input.kana || null}, ${role ?? 'staff'}, ${input.employment || 'ﾊﾟｰﾄ'}, ${input.storeId}, ${transport}, ${input.commuteMeans || null}, ${await hashPin(INITIAL_PIN)}) returning id`;
    await sql`insert into wage_rates (staff_id, effective_from, hourly, created_by) values (${s.id}, ${input.wageFrom}, ${input.hourly}, ${u.id})`;
    await audit(u.id, 'staff_create', { id: s.id, name });
    revalidatePath('/manage/staff');
    return { ok: true, message: `${name}さんを登録しました` };
  }
  await sql`update staff set name = ${name}, kana = ${input.kana || null}, employment = ${input.employment || 'ﾊﾟｰﾄ'}, store_id = ${input.storeId},
    transport_per_day = ${transport}, commute_means = ${input.commuteMeans || null},
    role = coalesce(${role ?? null}, role), active = coalesce(${input.active ?? null}, active),
    retired_at = case when ${input.active === false} then coalesce(retired_at, current_date) when ${input.active === true} then null else retired_at end
    where id = ${id}`;
  if (input.active === false) await sql`delete from sessions where staff_id = ${id}`;
  await audit(u.id, 'staff_update', { id, input });
  revalidatePath('/manage/staff');
  return { ok: true, message: '保存しました' };
}

export async function addWageAction(staffId: number, from: string, hourly: number): Promise<Result> {
  const u = await requireManager();
  if (!isDate(from) || !Number.isInteger(hourly) || hourly <= 0) return { ok: false, error: '時給と適用開始日を確認してください' };
  const mw = minWageAt(await minWages(), from);
  if (hourly < mw) return { ok: false, error: `${from} 時点の最低賃金（${mw}円）を下回っています` };
  await sql`insert into wage_rates (staff_id, effective_from, hourly, created_by) values (${staffId}, ${from}, ${hourly}, ${u.id})
    on conflict (staff_id, effective_from) do update set hourly = excluded.hourly, created_by = excluded.created_by, created_at = now()`;
  await audit(u.id, 'wage_set', { staffId, from, hourly });
  revalidatePath('/manage');
  return { ok: true, message: `${from} から時給 ${hourly.toLocaleString()}円 にしました` };
}

/** 最低賃金を下回る人をまとめて引き上げる */
export async function raiseToMinWageAction(from: string, hourly: number, staffIds: number[]): Promise<Result> {
  const u = await requireManager();
  if (!isDate(from)) return { ok: false, error: '日付が正しくありません' };
  for (const id of staffIds) {
    await sql`insert into wage_rates (staff_id, effective_from, hourly, created_by) values (${id}, ${from}, ${hourly}, ${u.id})
      on conflict (staff_id, effective_from) do update set hourly = greatest(wage_rates.hourly, excluded.hourly)`;
  }
  await audit(u.id, 'wage_raise_min', { from, hourly, staffIds });
  revalidatePath('/manage');
  return { ok: true, message: `${staffIds.length}名の時給を ${from} から ${hourly.toLocaleString()}円 に引き上げました` };
}

export async function resetPinAction(staffId: number): Promise<Result> {
  const u = await requireManager();
  const [t] = await sql<{ role: string }[]>`select role from staff where id = ${staffId}`;
  if (t?.role === 'admin' && u.role !== 'admin') return { ok: false, error: '管理者のパスワードは管理者だけが戻せます' };
  await resetPin(u.id, staffId);
  revalidatePath('/manage/staff');
  return { ok: true, message: `パスワードを ${INITIAL_PIN} に戻しました。次回ログイン時に変更してもらいます` };
}

// ---------- 店舗・端末（店長） ----------
export async function saveStoreAction(id: number | null, name: string, weekday: number, friday: number, weekend: number, active = true): Promise<Result> {
  const u = await requireManager();
  const n = String(name).trim();
  if (!n) return { ok: false, error: '店舗名を入力してください' };
  const b = [weekday, friday, weekend].map((x) => Math.max(0, Math.round(Number(x) || 0)));
  if (id === null) await sql`insert into stores (name, budget_weekday, budget_friday, budget_weekend, sort) values (${n}, ${b[0]}, ${b[1]}, ${b[2]}, (select coalesce(max(sort),0)+1 from stores))`;
  else await sql`update stores set name = ${n}, budget_weekday = ${b[0]}, budget_friday = ${b[1]}, budget_weekend = ${b[2]}, active = ${active} where id = ${id}`;
  await audit(u.id, 'store_save', { id, n, b, active });
  revalidatePath('/manage');
  return { ok: true, message: '保存しました' };
}
export async function setDailyBudgetAction(storeId: number, date: string, amount: number | null): Promise<Result> {
  await requireManager();
  if (!isDate(date)) return { ok: false, error: '日付が正しくありません' };
  if (amount === null) await sql`delete from daily_budgets where store_id = ${storeId} and work_date = ${date}`;
  else await sql`insert into daily_budgets (store_id, work_date, amount) values (${storeId}, ${date}, ${Math.max(0, Math.round(amount))})
    on conflict (store_id, work_date) do update set amount = excluded.amount`;
  return { ok: true };
}
export async function enableTerminalAction(storeId: number) {
  const u = await requireManager();
  await enableTerminal(u.id, storeId);
  await logout(); // 店長のログインは残さない
  redirect('/terminal');
}
export async function disableTerminalAction(managerId: number, pin: string): Promise<Result> {
  // 店舗端末の解除は店長・管理者のパスワードが必要
  const t = await currentTerminal();
  if (!t) redirect('/login');
  const [m] = await sql<{ id: number }[]>`select id from staff where id = ${Number(managerId)} and active and role in ('manager','admin')`;
  if (!m) return { ok: false, error: '店長・管理者を選んでください' };
  const r = await verifyPin(m.id, String(pin));
  if (!r.ok) return r;
  await disableTerminal();
  await audit(m.id, 'terminal_disabled', { storeId: t.store_id });
  redirect('/login');
}

export async function whoami() {
  const u = await requireUser();
  return { id: u.id, name: u.name, manager: isManager(u) };
}

// ---------- 給与明細 ----------
export async function uploadPayslipsAction(form: FormData): Promise<Result> {
  const u = await requireManager();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: 'PDFを選んでください' };
  if (files.some((f) => f.size > 4_000_000)) return { ok: false, error: 'ファイルが大きすぎます（4MBまで）' };
  const r = await importPayslipFiles(
    await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
    { source: 'upload', actorId: u.id },
  );
  revalidatePath('/manage/payslips');
  if (!r.ok) return { ok: false, error: r.error ?? '取り込めませんでした' };
  return { ok: true, message: `${r.slips - r.unmatched.length}人分の明細を取り込みました` };
}
export async function assignPayslipAction(slipName: string, staffId: number): Promise<Result> {
  const u = await requireManager();
  if (!staffId) return { ok: false, error: 'スタッフを選んでください' };
  await assignPayslips(u.id, String(slipName), Number(staffId));
  revalidatePath('/manage/payslips');
  return { ok: true, message: Number(staffId) === -1 ? '対象外にしました' : '結びつけました。次回からは自動で結びつきます' };
}
export async function rotateImportSecretAction(): Promise<Result> {
  const u = await requireManager();
  await rotateImportSecret();
  await audit(u.id, 'import_secret_rotated', {});
  revalidatePath('/manage/payslips');
  return { ok: true, message: '合言葉を作り直しました。Gmail側のスクリプトも新しい合言葉に書き換えてください' };
}
export async function setSlipPinAction(pin: string): Promise<Result> {
  const u = await requireUser();
  const r = await setSlipPin(u.id, String(pin));
  if (!r.ok) return r;
  revalidatePath('/me/payslips');
  return { ok: true, message: '暗証番号を決めました' };
}
export async function unlockSlipsAction(pin: string): Promise<Result> {
  const u = await requireUser();
  const r = await unlockSlips(u.id, String(pin));
  if (!r.ok) return r;
  revalidatePath('/me/payslips');
  return { ok: true };
}
export async function lockSlipsAction(): Promise<Result> {
  await requireUser();
  await lockSlips();
  revalidatePath('/me/payslips');
  return { ok: true, message: '明細を閉じました' };
}
export async function resetSlipPinAction(staffId: number): Promise<Result> {
  const u = await requireManager();
  await resetSlipPin(u.id, Number(staffId));
  return { ok: true, message: '明細の暗証番号を消しました。本人が次に開くときに決め直します' };
}

// ---------- 管理者による勤怠の修正 ----------
export async function editPunchesAction(staffId: number, date: string, items: { id?: number | null; kind: PunchKind; minute: number }[], reason: string): Promise<Result> {
  const u = await requireManager();
  if (!isDate(date)) return { ok: false, error: '日付が正しくありません' };
  if (!Array.isArray(items) || items.length > 20) return { ok: false, error: '打刻の内容が正しくありません' };
  for (const it of items) if (!KINDS.includes(it.kind) || !isMin(it.minute)) return { ok: false, error: '打刻の内容が正しくありません' };
  const sorted = [...items].sort((a, b) => a.minute - b.minute);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].minute === sorted[i - 1].minute) return { ok: false, error: '同じ時刻の打刻が2つあります' };
  const seq: { kind: PunchKind; minute: number }[] = [];
  for (const it of sorted) {
    if (!canPunch(seq, it.kind)) return { ok: false, error: `打刻の順番が正しくありません（${PUNCH_LABEL[it.kind]} ${Math.floor(it.minute / 60)}:${String(it.minute % 60).padStart(2, '0')}）。出勤 →（休憩開始 → 休憩終了）→ 退勤 の順にしてください` };
    seq.push(it);
  }
  const why = String(reason ?? '').trim().slice(0, 200) || '管理者が修正';
  await replaceDayPunches(u.id, Number(staffId), date, sorted, why);
  revalidatePath('/manage/attendance');
  return { ok: true, message: '勤怠を直しました' };
}
