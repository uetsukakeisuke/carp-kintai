import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql, audit } from './db';
import { parsePayslipPdf, normName, slipTotals, type ParsedSlip, type SlipValue } from './payslip-parse';

export interface Payslip {
  id: number; staff_id: number | null; staff_name: string | null; slip_name: string; slip_code: string | null;
  work_year: number; work_month: number; pay_date: string | null; period: string | null;
  data: Record<'attendance' | 'pay' | 'deduction' | 'unit', [string, SlipValue][]>;
  gross: number; deduction: number; net: number; updated_at: Date;
}

// ---------- 取り込み ----------
export interface ImportResult { ok: boolean; duplicate?: boolean; slips: number; unmatched: string[]; months: string[]; error?: string }

export async function importPayslipFiles(
  files: { name: string; bytes: Uint8Array }[],
  meta: { source: 'gmail' | 'upload'; messageId?: string | null; subject?: string | null; receivedAt?: string | null; actorId?: number | null },
): Promise<ImportResult> {
  if (meta.messageId) {
    const [done] = await sql<{ id: number }[]>`select id from payslip_imports where message_id = ${meta.messageId} and error is null`;
    if (done) return { ok: true, duplicate: true, slips: 0, unmatched: [], months: [] };
  }
  const slips: ParsedSlip[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try { slips.push(...(await parsePayslipPdf(f.bytes))); }
    catch (e) { errors.push(`${f.name}：読み取れませんでした（${(e as Error).message.slice(0, 80)}）`); }
  }
  const valid = slips.filter((s) => s.workYear && s.workMonth);
  const error = valid.length ? null : errors[0] ?? '給与支給明細書が見つかりませんでした（支給控除一覧表など明細以外のPDFは取り込みません）';

  const staff = await sql<{ id: number; name: string; payroll_code: string | null }[]>`select id, name, payroll_code from staff`;
  const unmatched: string[] = [];
  const months = new Set<string>();
  await sql.begin(async (tx) => {
    const msgId = error ? null : meta.messageId ?? null; // 失敗したメールは次回もう一度試せるように記録しない
    const [imp] = await tx<{ id: number }[]>`
      insert into payslip_imports (source, message_id, subject, file_names, received_at, slips, error, created_by)
      values (${meta.source}, ${msgId}, ${meta.subject ?? null}, ${files.map((f) => f.name)}, ${meta.receivedAt ?? null}, ${valid.length}, ${error}, ${meta.actorId ?? null})
      on conflict (message_id) do update set slips = excluded.slips, error = excluded.error
      returning id`;
    for (const s of valid) {
      const byCode = s.code ? staff.find((x) => x.payroll_code === s.code) : undefined;
      const byName = staff.filter((x) => normName(x.name) === normName(s.name));
      const st = byCode ?? (byName.length === 1 ? byName[0] : undefined);
      const [ign] = st ? [] : await tx`select 1 from payslips where slip_name = ${normName(s.name)} and ignored limit 1`;
      if (!st) { if (!ign) unmatched.push(s.name); }
      else if (s.code && st.payroll_code !== s.code) await tx`update staff set payroll_code = ${s.code} where id = ${st.id}`;
      const t = slipTotals(s);
      months.add(`${s.workYear}-${String(s.workMonth).padStart(2, '0')}`);
      // jsonb はキーの順番を保たないので、明細書の並び順のまま [項目, 値] の配列で保存する
      const data = { attendance: Object.entries(s.attendance), pay: Object.entries(s.pay), deduction: Object.entries(s.deduction), unit: Object.entries(s.unit) };
      await tx`
        insert into payslips (staff_id, ignored, slip_name, slip_code, work_year, work_month, pay_date, period, data, gross, deduction, net, import_id)
        values (${st?.id ?? null}, ${!st && !!ign}, ${normName(s.name)}, ${s.code}, ${s.workYear}, ${s.workMonth}, ${s.payDate}, ${s.period}, ${tx.json(data as never)}, ${t.gross}, ${t.deduction}, ${t.net}, ${imp.id})
        on conflict (slip_name, work_year, work_month) do update set
          staff_id = coalesce(excluded.staff_id, payslips.staff_id), slip_code = excluded.slip_code, pay_date = excluded.pay_date, period = excluded.period,
          ignored = payslips.ignored, data = excluded.data, gross = excluded.gross, deduction = excluded.deduction, net = excluded.net, import_id = excluded.import_id, updated_at = now()`;
    }
    await tx`update payslip_imports set unmatched = ${unmatched.length} where id = ${imp.id}`;
  });
  await audit(meta.actorId ?? null, 'payslip_import', { source: meta.source, slips: valid.length, unmatched, error });
  return { ok: !error, slips: valid.length, unmatched, months: [...months].sort(), error: error ?? undefined };
}

/** 結びついていない明細をスタッフに割り当てる（以後は従業員コードで自動照合） */
export async function assignPayslips(actorId: number, slipName: string, staffId: number) {
  if (staffId === -1) { // アプリに登録していない人（退職済みなど）は対象外にする
    await sql`update payslips set ignored = true where slip_name = ${slipName} and staff_id is null`;
    await audit(actorId, 'payslip_ignore', { slipName });
    return;
  }
  const [one] = await sql<{ slip_code: string | null }[]>`select slip_code from payslips where slip_name = ${slipName} order by work_year desc, work_month desc limit 1`;
  await sql`update payslips set staff_id = ${staffId}, ignored = false where slip_name = ${slipName}`;
  if (one?.slip_code) await sql`update staff set payroll_code = ${one.slip_code} where id = ${staffId}`;
  await audit(actorId, 'payslip_assign', { slipName, staffId });
}

// ---------- 合言葉（Gmail の自動取り込み用） ----------
export async function getImportSecret(create = false): Promise<string | null> {
  const [s] = await sql<{ import_secret: string | null }[]>`select import_secret from settings where id = 1`;
  if (s?.import_secret || !create) return s?.import_secret ?? null;
  return rotateImportSecret();
}
export async function rotateImportSecret() {
  const v = randomBytes(24).toString('base64url');
  await sql`update settings set import_secret = ${v} where id = 1`;
  return v;
}
export async function checkImportSecret(given: string | null) {
  const s = await getImportSecret();
  if (!s || !given) return false;
  const a = Buffer.from(s), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- 読み出し ----------
export async function payslipsOf(staffId: number) {
  return sql<Payslip[]>`select p.*, s.name as staff_name from payslips p left join staff s on s.id = p.staff_id
    where p.staff_id = ${staffId} order by work_year desc, work_month desc`;
}
export async function payslipsForMonth(year: number, month: number) {
  return sql<Payslip[]>`select p.*, s.name as staff_name from payslips p left join staff s on s.id = p.staff_id
    where work_year = ${year} and work_month = ${month} and not p.ignored order by s.sort nulls last, s.id, p.slip_code`;
}
export async function payslipById(id: number) {
  const [p] = await sql<Payslip[]>`select p.*, s.name as staff_name from payslips p left join staff s on s.id = p.staff_id where p.id = ${id}`;
  return p ?? null;
}
export async function payslipMonths() {
  return sql<{ work_year: number; work_month: number; n: number; unmatched: number; pay_date: string | null }[]>`
    select work_year, work_month, count(*)::int as n, count(*) filter (where staff_id is null and not ignored)::int as unmatched, max(pay_date)::text as pay_date
    from payslips group by 1, 2 order by 1 desc, 2 desc`;
}
export async function recentImports() {
  return sql<{ id: number; source: string; subject: string | null; file_names: string[]; slips: number; unmatched: number; error: string | null; created_at: Date }[]>`
    select id, source, subject, file_names, slips, unmatched, error, created_at from payslip_imports order by id desc limit 10`;
}

// ---------- 本人の暗証番号（明細を開くとき） ----------
const SLIP_COOKIE = 'kt_slip';
const UNLOCK_MIN = 10, MAX_FAILS = 5, LOCK_MIN = 15;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function slipPinState(staffId: number) {
  const [s] = await sql<{ slip_pin_hash: string | null; slip_locked_until: Date | null }[]>`select slip_pin_hash, slip_locked_until from staff where id = ${staffId}`;
  return { hasPin: !!s?.slip_pin_hash, lockedUntil: s?.slip_locked_until && s.slip_locked_until > new Date() ? s.slip_locked_until : null };
}
async function grant(staffId: number) {
  const token = randomBytes(32).toString('base64url');
  await sql`delete from slip_unlocks where expires_at < now()`;
  await sql`insert into slip_unlocks (token_hash, staff_id, expires_at) values (${hash(token)}, ${staffId}, ${new Date(Date.now() + UNLOCK_MIN * 60000)})`;
  (await cookies()).set(SLIP_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: UNLOCK_MIN * 60 });
}
export async function slipUnlocked(staffId: number) {
  const t = (await cookies()).get(SLIP_COOKIE)?.value;
  if (!t) return false;
  const [r] = await sql`select 1 from slip_unlocks where token_hash = ${hash(t)} and staff_id = ${staffId} and expires_at > now()`;
  return !!r;
}
export async function lockSlips() {
  const jar = await cookies();
  const t = jar.get(SLIP_COOKIE)?.value;
  if (t) await sql`delete from slip_unlocks where token_hash = ${hash(t)}`;
  jar.delete(SLIP_COOKIE);
}
const weak = (p: string) => /^(\d)\1{3}$/.test(p) || ['1234', '4321', '0123', '9876', '1111'].includes(p);
export async function setSlipPin(staffId: number, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: '数字4桁にしてください' };
  if (weak(pin)) return { ok: false, error: '1111 や 1234 のような分かりやすい数字は使えません' };
  const st = await slipPinState(staffId);
  if (st.hasPin) return { ok: false, error: 'すでに暗証番号が決まっています' };
  await sql`update staff set slip_pin_hash = ${await bcrypt.hash(pin, 10)}, slip_failed = 0, slip_locked_until = null where id = ${staffId}`;
  await audit(staffId, 'slip_pin_set', {});
  await grant(staffId);
  return { ok: true };
}
export async function unlockSlips(staffId: number, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [s] = await sql<{ slip_pin_hash: string | null; slip_failed: number; slip_locked_until: Date | null }[]>`select slip_pin_hash, slip_failed, slip_locked_until from staff where id = ${staffId}`;
  if (!s?.slip_pin_hash) return { ok: false, error: '暗証番号がまだ決まっていません' };
  if (s.slip_locked_until && s.slip_locked_until > new Date()) return { ok: false, error: `${MAX_FAILS}回間違えたため、しばらく開けません。急ぐ場合は店長に暗証番号を消してもらってください。` };
  if (/^\d{4}$/.test(pin) && (await bcrypt.compare(pin, s.slip_pin_hash))) {
    await sql`update staff set slip_failed = 0, slip_locked_until = null where id = ${staffId}`;
    await grant(staffId);
    return { ok: true };
  }
  const fails = s.slip_failed + 1, lock = fails >= MAX_FAILS;
  await sql`update staff set slip_failed = ${lock ? 0 : fails}, slip_locked_until = ${lock ? new Date(Date.now() + LOCK_MIN * 60000) : null} where id = ${staffId}`;
  return { ok: false, error: lock ? `${MAX_FAILS}回間違えたため、${LOCK_MIN}分間開けません。` : `暗証番号が違います（あと${MAX_FAILS - fails}回で${LOCK_MIN}分ロック）` };
}
export async function resetSlipPin(actorId: number, staffId: number) {
  await sql`update staff set slip_pin_hash = null, slip_failed = 0, slip_locked_until = null where id = ${staffId}`;
  await sql`delete from slip_unlocks where staff_id = ${staffId}`;
  await audit(actorId, 'slip_pin_reset', { staffId });
}
