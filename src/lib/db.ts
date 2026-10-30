import 'server-only';
import postgres from 'postgres';

// Supabase などの Postgres に接続する。接続文字列は環境変数 DATABASE_URL。
declare global {
  // eslint-disable-next-line no-var
  var __sql: postgres.Sql | undefined;
}

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が設定されていません');
  const local = /localhost|127\.0\.0\.1/.test(url);
  return postgres(url, {
    max: local ? 1 : 5,
    idle_timeout: 20,
    connect_timeout: 10, // つながらないときは待ち続けずにエラーにする
    max_lifetime: 60 * 5, // 切れた接続を使い続けないよう、5分ごとにつなぎ直す
    prepare: false, // Supabase の接続プーラー（Transaction mode）対応
    ssl: local ? false : 'require',
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
  });
}

function get(): postgres.Sql {
  return globalThis.__sql ?? (globalThis.__sql = create());
}

// 初回の利用時に接続する（ビルド時に環境変数がなくても読み込めるように）
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_t, _this, args) => (get() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => {
    const s = get() as unknown as Record<string | symbol, unknown>;
    const v = s[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
}) as postgres.Sql;

export async function audit(actorId: number | null, action: string, detail: unknown) {
  await sql`insert into audit_log (actor_id, action, detail) values (${actorId}, ${action}, ${sql.json(detail as never)})`;
}
