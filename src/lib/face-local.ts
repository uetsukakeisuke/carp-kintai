'use client';
// 顔の登録と照合を「その端末の中だけ」で行う。顔の特徴（数値）は端末に保存し、サーバーには送らない。
// サーバーには照合の結果（本人確認OK・不一致・登録など）だけを送る。
const KEY = 'kintai-face-v1';
export const FACE_THRESHOLD = 0.5; // これ未満なら本人（face-api の推奨 0.6 より厳しめ）
export type FaceOutcome = 'ok' | 'mismatch' | 'skipped' | 'registered' | 'reregistered';
type Store = Record<string, { d: number[]; at: string }>;

function read(): Store {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function write(s: Store) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export function getLocalFace(staffId: number) { return read()[String(staffId)] ?? null; }
export function saveLocalFace(staffId: number, d: number[]) { const s = read(); s[String(staffId)] = { d, at: new Date().toISOString() }; return write(s); }
export function clearLocalFace(staffId: number) { const s = read(); delete s[String(staffId)]; write(s); }
export function faceDistance(a: number[], b: number[]) { let s = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - b[i]; s += x * x; } return Math.round(Math.sqrt(s) * 1000) / 1000; }

/** この端末に登録された全員と比べ、一番近い人を返す（顔パス用） */
export function identify(d: number[]): { staffId: number; dist: number; second: number } | null {
  const all = Object.entries(read());
  if (!all.length) return null;
  const ds = all.map(([id, f]) => ({ staffId: Number(id), dist: faceDistance(d, f.d) })).sort((a, b) => a.dist - b.dist);
  return { staffId: ds[0].staffId, dist: ds[0].dist, second: ds[1]?.dist ?? 9 };
}
export function registeredIds(): number[] { return Object.keys(read()).map(Number); }
export const PASS_THRESHOLD = 0.45; // 顔パス（全員から見分ける）は1対1より厳しめ
