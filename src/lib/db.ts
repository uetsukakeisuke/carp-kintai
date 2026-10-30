import 'server-only';
import postgres from 'postgres';
import { after } from 'next/server';

// Supabase などの Postgres に接続する。接続文字列は環境変数 DATABASE_URL。
//
// Vercel ではリクエストが終わると関数が一時停止し、その間にデータベースとの接続が
// 切れることがある。また Supabase の接続プーラーが、まれに数秒〜十数秒応答しないことがある。
//   1) Vercel 上ではリクエストごとに接続を作り、終わったら閉じる（切れた接続を使い回さない）
//   2) 読み出し（select）は、6秒応答がない・接続が切れた場合に、つなぎ直して1回だけやり直す
//   3) 書き込みは二重登録を防ぐためやり直さず、10秒応答がなければエラーにする
declare global {
  // eslint-disable-next-line no-var
  var __sql: postgres.Sql | undefined;
}

const READ_FIRST_MS = 6_000; // 読み出し1回目の待ち時間（超えたらつなぎ直してやり直す）
const READ_RETRY_MS = 10_000; // やり直しの待ち時間
const WRITE_MS = 10_000;
const TX_MS = 20_000;
const onVercel = !!process.env.VERCEL;
const RETRYABLE = new Set(['CONNECTION_DESTROYED', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECT_TIMEOUT', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED']);

type Stats = { n: number; closing: boolean; sent: number; born: number };
const stats = new WeakMap<postgres.Sql, Stats>();

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が設定されていません');
  const local = /localhost|127\.0\.0\.1/.test(url);
  const st: Stats = { n: 0, closing: false, sent: 0, born: Date.now() };
  const s = postgres(url, {
    max: local ? 1 : 3,
    idle_timeout: 20,
    connect_timeout: 8, // つながらないときは待ち続けずにエラーにする
    max_lifetime: 60 * 5,
    prepare: false, // Supabase の接続プーラー（Transaction mode）対応
    ssl: local ? false : 'require',
    types: { date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x } },
    debug: () => { st.sent++; }, // 問い合わせを送れた数（障害時の切り分け用）
  });
  stats.set(s, st);
  return s;
}

/** 接続を捨てる（実行中の問い合わせはエラーになる） */
function discard(s: postgres.Sql, why: string) {
  if (globalThis.__sql === s) globalThis.__sql = undefined;
  const st = stats.get(s);
  const phase = st && st.sent === 0 ? 'プーラーにつながっていない段階' : '問い合わせを送ったあと';
  console.error(`[db] ${why}（${phase}・接続を作ってから${st ? Math.round((Date.now() - st.born) / 1000) : '?'}秒）。接続を作り直します`);
  s.end({ timeout: 0 }).catch(() => {});
}

function close(s: postgres.Sql) {
  const b = stats.get(s);
  if (b && b.n > 0) { b.closing = true; return; }
  s.end({ timeout: 5 }).catch(() => {});
}

function get(): postgres.Sql {
  if (globalThis.__sql) return globalThis.__sql;
  const s = create();
  globalThis.__sql = s;
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

/** 実行中の数を数える（同時に来た別のリクエストが使用中なら、閉じるのを待つため） */
function track(s: postgres.Sql) {
  const b = stats.get(s);
  if (b) b.n++;
  let done = false;
  return () => {
    if (done) return; done = true;
    if (b && --b.n === 0 && b.closing) s.end({ timeout: 5 }).catch(() => {});
  };
}

/** 一定時間で終わらなければ接続を捨てる見張り（書き込み・トランザクション用） */
function watch<T extends PromiseLike<unknown>>(s: postgres.Sql, p: T, ms: number): T {
  const fin = track(s);
  const timer = setTimeout(() => discard(s, `データベースが${ms / 1000}秒応答しません（書き込み）`), ms);
  const done = () => { clearTimeout(timer); fin(); };
  p.then(done, done);
  return p;
}

type Run = (...a: unknown[]) => PromiseLike<unknown>;
/** 読み出し：応答がない・接続が切れたときは、つなぎ直して1回だけやり直す */
function read(args: unknown[], attempt = 1): Promise<unknown> {
  const s = get();
  const q = (s as unknown as Run)(...args);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fin = track(s);
    const retry = () => read(args, 2).then(resolve, reject);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; fin();
      discard(s, `データベースが${(attempt === 1 ? READ_FIRST_MS : READ_RETRY_MS) / 1000}秒応答しません（読み出し${attempt}回目）`);
      if (attempt === 1) retry(); else reject(new Error('データベースが応答しません'));
    }, attempt === 1 ? READ_FIRST_MS : READ_RETRY_MS);
    q.then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); fin(); resolve(v); },
      (e: { code?: string }) => {
        if (settled) return;
        settled = true; clearTimeout(timer); fin();
        if (attempt === 1 && RETRYABLE.has(String(e?.code))) {
          if (globalThis.__sql === s) globalThis.__sql = undefined;
          console.error(`[db] 接続が切れていたため、つなぎ直して読み出しをやり直します（${e?.code}）`);
          retry();
        } else reject(e);
      },
    );
  });
}
const isRead = (args: unknown[]) => {
  const strings = args[0] as readonly string[] | undefined;
  return Array.isArray(strings) && /^\s*(select|with)\b/i.test(strings[0] ?? '');
};

// 初回の利用時に接続する（ビルド時に環境変数がなくても読み込めるように）
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_t, _this, args) => {
    if (isRead(args)) return read(args);
    const s = get();
    return watch(s, (s as unknown as Run)(...args), WRITE_MS);
  },
  get: (_t, prop) => {
    const s = get();
    if (prop === 'begin') {
      return (...a: unknown[]) => watch(s, (s.begin as unknown as Run)(...a), TX_MS);
    }
    const v = (s as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
}) as postgres.Sql;

export async function audit(actorId: number | null, action: string, detail: unknown) {
  await sql`insert into audit_log (actor_id, action, detail) values (${actorId}, ${action}, ${sql.json(detail as never)})`;
}
