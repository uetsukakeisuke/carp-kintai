import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql, audit } from './db';

export const INITIAL_PIN = '1111';
const USER_COOKIE = 'kt_session';
const TERMINAL_COOKIE = 'kt_terminal';
const USER_DAYS = 60;
const TERMINAL_DAYS = 365;
const MAX_FAILS = 5;
const LOCK_MIN = 15;

export type Role = 'staff' | 'manager' | 'admin';
export interface User { id: number; name: string; role: Role; store_id: number | null; pin_must_change: boolean }

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
export const isManager = (u: Pick<User, 'role'>) => u.role === 'manager' || u.role === 'admin';
export const validPin = (pin: string) => /^\d{4}$/.test(pin);

export async function hashPin(pin: string) {
  return bcrypt.hash(pin, 10);
}

async function setCookie(name: string, token: string, days: number) {
  const jar = await cookies();
  jar.set(name, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: days * 86400,
  });
}

/** PIN を確認する。成功・失敗とロック状態を返す（ログインと店舗端末の打刻で共通） */
export async function verifyPin(staffId: number, pin: string): Promise<{ ok: true; mustChange: boolean } | { ok: false; error: string }> {
  const [s] = await sql<{ id: number; pin_hash: string; failed_attempts: number; locked_until: Date | null; active: boolean; pin_must_change: boolean }[]>`
    select id, pin_hash, failed_attempts, locked_until, active, pin_must_change from staff where id = ${staffId}`;
  if (!s || !s.active) return { ok: false, error: 'このスタッフは利用できません。店長に確認してください。' };
  if (s.locked_until && s.locked_until > new Date()) {
    const m = Math.ceil((s.locked_until.getTime() - Date.now()) / 60000);
    return { ok: false, error: `パスワードを${MAX_FAILS}回間違えたため、あと${m}分ほど使えません。急ぐ場合は店長にパスワードを戻してもらってください。` };
  }
  const ok = validPin(pin) && (await bcrypt.compare(pin, s.pin_hash));
  if (!ok) {
    const fails = s.failed_attempts + 1;
    const lock = fails >= MAX_FAILS;
    await sql`update staff set failed_attempts = ${lock ? 0 : fails},
      locked_until = ${lock ? new Date(Date.now() + LOCK_MIN * 60000) : null} where id = ${staffId}`;
    if (lock) await audit(staffId, 'pin_locked', {});
    return {
      ok: false,
      error: lock ? `パスワードを${MAX_FAILS}回間違えたため、${LOCK_MIN}分間ロックしました。` : `パスワードが違います（あと${MAX_FAILS - fails}回間違えると${LOCK_MIN}分ロック）`,
    };
  }
  if (s.failed_attempts || s.locked_until) await sql`update staff set failed_attempts = 0, locked_until = null where id = ${staffId}`;
  return { ok: true, mustChange: s.pin_must_change };
}

export async function login(staffId: number, pin: string) {
  const r = await verifyPin(staffId, pin);
  if (!r.ok) return r;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (token_hash, kind, staff_id, expires_at)
    values (${hash(token)}, 'user', ${staffId}, ${new Date(Date.now() + USER_DAYS * 86400000)})`;
  await setCookie(USER_COOKIE, token, USER_DAYS);
  return r;
}

export async function logout() {
  const jar = await cookies();
  const t = jar.get(USER_COOKIE)?.value;
  if (t) await sql`delete from sessions where token_hash = ${hash(t)}`;
  jar.delete(USER_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const t = (await cookies()).get(USER_COOKIE)?.value;
  if (!t) return null;
  const [u] = await sql<User[]>`
    select s.id, s.name, s.role, s.store_id, s.pin_must_change
    from sessions x join staff s on s.id = x.staff_id
    where x.token_hash = ${hash(t)} and x.kind = 'user' and x.expires_at > now() and s.active`;
  return u ?? null;
}

/** ログイン必須。初回パスワード変更が済んでいなければ変更画面へ */
export async function requireUser(opts: { allowMustChange?: boolean } = {}): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (u.pin_must_change && !opts.allowMustChange) redirect('/pin');
  return u;
}

export async function requireManager(): Promise<User> {
  const u = await requireUser();
  if (!isManager(u)) redirect('/');
  return u;
}

export async function changePin(staffId: number, current: string, next: string): Promise<{ ok: boolean; error?: string }> {
  if (!validPin(next)) return { ok: false, error: '新しいパスワードは数字4桁にしてください。' };
  if (next === INITIAL_PIN) return { ok: false, error: '1111 以外の数字にしてください。' };
  if (/^(\d)\1{3}$/.test(next) || ['1234', '4321', '0123', '9876'].includes(next)) return { ok: false, error: '推測されやすい数字（同じ数字の繰り返しや連番）は使えません。' };
  const r = await verifyPin(staffId, current);
  if (!r.ok) return { ok: false, error: r.error };
  await sql`update staff set pin_hash = ${await hashPin(next)}, pin_must_change = false where id = ${staffId}`;
  await audit(staffId, 'pin_changed', {});
  return { ok: true };
}

/** 店長がパスワードを 1111 に戻す（次回ログイン時に変更を求める） */
export async function resetPin(actorId: number, staffId: number) {
  await sql`update staff set pin_hash = ${await hashPin(INITIAL_PIN)}, pin_must_change = true, failed_attempts = 0, locked_until = null where id = ${staffId}`;
  await sql`delete from sessions where staff_id = ${staffId}`;
  await audit(actorId, 'pin_reset', { staffId });
}

// ---- 店舗端末（休憩室などの共用タブレット） ----
export async function enableTerminal(actorId: number, storeId: number) {
  const token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (token_hash, kind, store_id, expires_at)
    values (${hash(token)}, 'terminal', ${storeId}, ${new Date(Date.now() + TERMINAL_DAYS * 86400000)})`;
  await setCookie(TERMINAL_COOKIE, token, TERMINAL_DAYS);
  await audit(actorId, 'terminal_enabled', { storeId });
}
export async function currentTerminal(): Promise<{ store_id: number; store_name: string } | null> {
  const t = (await cookies()).get(TERMINAL_COOKIE)?.value;
  if (!t) return null;
  const [r] = await sql<{ store_id: number; store_name: string }[]>`
    select x.store_id, s.name as store_name from sessions x join stores s on s.id = x.store_id
    where x.token_hash = ${hash(t)} and x.kind = 'terminal' and x.expires_at > now()`;
  return r ?? null;
}
export async function disableTerminal() {
  const jar = await cookies();
  const t = jar.get(TERMINAL_COOKIE)?.value;
  if (t) await sql`delete from sessions where token_hash = ${hash(t)}`;
  jar.delete(TERMINAL_COOKIE);
}
