import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from './db';
import type { Cell } from './kobo';

// 受発注台帳の取り込み。Apps Script が送ってきたセルをそのまま保存し、報告は表示のたびに組み立てる。
const KEEP = 30; // 取っておく回数（1時間ごとなら1日少し）
const MAX_ROWS = 5000, MAX_COLS = 60, MAX_CELL = 1000;

export type Snapshot = { id: number; orders: Cell[][]; terms: Cell[][]; row_count: number; meta: { gid?: number }; received_at: Date };

/** 受け取ったセルを、決まった大きさ・型に整える（それ以外は捨てる） */
export function cleanGrid(v: unknown, cols = MAX_COLS): Cell[][] | null {
  if (!Array.isArray(v)) return null;
  const out: Cell[][] = [];
  for (const r of v.slice(0, MAX_ROWS)) {
    if (!Array.isArray(r)) return null;
    out.push(r.slice(0, cols).map((c) => (typeof c === 'number' ? (Number.isFinite(c) ? c : null)
      : typeof c === 'boolean' ? c
      : typeof c === 'string' ? c.slice(0, MAX_CELL) : null)));
  }
  // 末尾の空行を落とす
  while (out.length && out[out.length - 1].every((c) => c === '' || c === null)) out.pop();
  return out;
}

export async function saveSnapshot(orders: Cell[][], terms: Cell[][], meta: { gid?: number }) {
  const rows = orders.filter((r) => r.some((c) => c !== '' && c !== null)).length;
  const [s] = await sql<{ id: number }[]>`insert into ledger_snapshots (orders, terms, row_count, meta)
    values (${sql.json(orders as never)}, ${sql.json(terms as never)}, ${rows}, ${sql.json(meta as never)}) returning id`;
  await sql`delete from ledger_snapshots where id <= ${s.id - KEEP}`;
  return { id: s.id, rows };
}
export async function latestSnapshot(): Promise<Snapshot | null> {
  const [s] = await sql<Snapshot[]>`select id, orders, terms, row_count, meta, received_at from ledger_snapshots order by id desc limit 1`;
  return s ?? null;
}

// ---------- 設定（合言葉・スプレッドシート） ----------
export async function ledgerSettings(): Promise<{ secret: string; sheetId: string | null }> {
  const [s] = await sql<{ ledger_secret: string | null; ledger_sheet_id: string | null }[]>`select ledger_secret, ledger_sheet_id from settings where id = 1`;
  return { secret: s?.ledger_secret ?? (await rotateLedgerSecret()), sheetId: s?.ledger_sheet_id ?? null };
}
export async function rotateLedgerSecret() {
  const v = randomBytes(24).toString('base64url');
  await sql`update settings set ledger_secret = ${v} where id = 1`;
  return v;
}
export async function checkLedgerSecret(given: string | null) {
  const [s] = await sql<{ ledger_secret: string | null }[]>`select ledger_secret from settings where id = 1`;
  if (!s?.ledger_secret || !given) return false;
  const a = Buffer.from(s.ledger_secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** スプレッドシートのURL（またはID）からIDを取り出す */
export function sheetIdOf(input: string): string | null {
  const s = input.trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(s) ?? /^([A-Za-z0-9_-]{20,})$/.exec(s);
  return m ? m[1] : null;
}
export async function setLedgerSheet(id: string | null) {
  await sql`update settings set ledger_sheet_id = ${id} where id = 1`;
}
