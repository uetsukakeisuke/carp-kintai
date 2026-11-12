import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { sql, audit } from './db';

// 外部のシステム（公式LINEなど）向けのAPIキー
export const SCOPES = {
  staff: 'スタッフの名前',
  shifts: '公開済みのシフト',
  tasks: '予定表（全体・人ごとの作業）',
} as const;
export type Scope = keyof typeof SCOPES;
export const isScope = (s: unknown): s is Scope => typeof s === 'string' && s in SCOPES;
export type ApiKeyRow = { id: number; name: string; prefix: string; scopes: Scope[]; created_at: Date; last_used_at: Date | null; revoked_at: Date | null; created_by_name: string | null };

const hash = (k: string) => createHash('sha256').update(k).digest('hex');

export async function createApiKey(actorId: number, name: string, scopes: Scope[]) {
  const key = 'ck_' + randomBytes(24).toString('base64url');
  const prefix = key.slice(0, 10);
  await sql`insert into api_keys (name, prefix, key_hash, scopes, created_by) values (${name}, ${prefix}, ${hash(key)}, ${scopes}, ${actorId})`;
  await audit(actorId, 'api_key_create', { name, prefix, scopes });
  return key;
}
export async function listApiKeys() {
  return sql<ApiKeyRow[]>`select k.id, k.name, k.prefix, k.scopes, k.created_at, k.last_used_at, k.revoked_at, s.name as created_by_name
    from api_keys k left join staff s on s.id = k.created_by order by k.revoked_at nulls first, k.id desc`;
}
export async function revokeApiKey(actorId: number, id: number) {
  const [r] = await sql<{ name: string }[]>`update api_keys set revoked_at = now() where id = ${id} and revoked_at is null returning name`;
  if (r) await audit(actorId, 'api_key_revoke', { id, name: r.name });
  return !!r;
}

/** リクエストのキーを確かめる。だめなら返すべきレスポンス */
export async function authApi(req: Request, scope: Scope): Promise<{ ok: true; keyId: number } | { ok: false; res: Response }> {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(ck_[A-Za-z0-9_-]{20,64})$/.exec(h.trim());
  const json = (status: number, error: string) => ({ ok: false as const, res: Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } }) });
  if (!m) return json(401, 'Authorization: Bearer <APIキー> を付けてください');
  const [k] = await sql<{ id: number; scopes: string[]; revoked_at: Date | null; last_used_at: Date | null }[]>`
    select id, scopes, revoked_at, last_used_at from api_keys where key_hash = ${hash(m[1])}`;
  if (!k || k.revoked_at) return json(401, 'APIキーが違うか、取り消されています');
  if (!k.scopes.includes(scope)) return json(403, `このAPIキーでは「${SCOPES[scope]}」は読めません`);
  // 最後に使った時刻（書き込みを減らすため5分に1回だけ）
  if (!k.last_used_at || Date.now() - new Date(k.last_used_at).getTime() > 5 * 60000) {
    await sql`update api_keys set last_used_at = now() where id = ${k.id}`.catch(() => {});
  }
  return { ok: true, keyId: k.id };
}
