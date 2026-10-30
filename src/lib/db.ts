import 'server-only';
import postgres from 'postgres';
import { after } from 'next/server';

// Supabase などの Postgres に接続する。接続文字列は環境変数 DATABASE_URL。
//
// Vercel ではリクエストが終わると関数が一時停止し、その間にデータベースとの接続が
// 切れることがある。切れた接続を次のリクエストで使うと応答が返らず固まるため、
//   1) Vercel 上ではリクエストごとに接続を作り、終わったら閉じる
//   2) 万一 10 秒以上応答がなければ、その接続を捨ててエラーにする（次のアクセスはつなぎ直す）
declare global {
  // eslint-disable-next-line no-var
  var __sql: postgres.Sql | undefined;
}

const QUERY_TIMEOUT_MS = 10_000;
const TX_TIMEOUT_MS = 20_000;
const onVercel = !!process.env.VERCEL;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が設定されていません');
  const local = /localhost|127\.0\.0\.1/.test(url);
  return postgres(url, {
    max: local ? 1 : 5,
    idle_timeout: 20,
    connect_timeout: 10, // つながらないときは待ち続けずにエラーにする
    max_lifetime: 60 * 5,
    prepare: false, // Supabase の接続プーラー（Transaction mode）対応
    ssl: local ? false : 'require',
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
  });
}

/** 接続を捨てる（実行中の問い合わせはエラーになる） */
function discard(s: postgres.Sql, why: string) {
  if (globalThis.__sql === s) globalThis.__sql = undefined;
  console.error(`[db] ${why}。接続を作り直します`);
  s.end({ timeout: 0 }).catch(() => {});
}

// 実行中の問い合わせの数（同時に来た別のリクエストが使用中なら、閉じるのを待つ）
const busy = new WeakMap<postgres.Sql, { n: number; closing: boolean }>();

function close(s: postgres.Sql) {
  const b = busy.get(s);
  if (b && b.n > 0) { b.closing = true; return; }
  s.end({ timeout: 5 }).catch(() => {});
}

function get(): postgres.Sql {
  if (globalThis.__sql) return globalThis.__sql;
  const s = create();
  globalThis.__sql = s;
  busy.set(s, { n: 0, closing: false });
  if (onVercel) {
    // リクエストが終わったら接続を閉じる
    try {
      after(() => {
        if (globalThis.__sql === s) globalThis.__sql = undefined;
        close(s);
      });
    } catch {
      /* リクエストの外（ビルド時など）では何もしない */
    }
  }
  return s;
}

/** 一定時間で終わらなければ接続を捨てる見張り */
function watch<T extends PromiseLike<unknown>>(s: postgres.Sql, p: T, ms: number): T {
  const b = busy.get(s);
  if (b) b.n++;
  const timer = setTimeout(() => discard(s, `データベースが${ms / 1000}秒応答しません`), ms);
  const done = () => {
    clearTimeout(timer);
    if (b && --b.n === 0 && b.closing) s.end({ timeout: 5 }).catch(() => {});
  };
  p.then(done, done);
  return p;
}

// 初回の利用時に接続する（ビルド時に環境変数がなくても読み込めるように）
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_t, _this, args) => {
    const s = get();
    return watch(s, (s as unknown as (...a: unknown[]) => PromiseLike<unknown>)(...args), QUERY_TIMEOUT_MS);
  },
  get: (_t, prop) => {
    const s = get();
    if (prop === 'begin') {
      return (...a: unknown[]) => watch(s, (s.begin as unknown as (...x: unknown[]) => PromiseLike<unknown>)(...a), TX_TIMEOUT_MS);
    }
    const v = (s as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
}) as postgres.Sql;

export async function audit(actorId: number | null, action: string, detail: unknown) {
  await sql`insert into audit_log (actor_id, action, detail) values (${actorId}, ${action}, ${sql.json(detail as never)})`;
}
