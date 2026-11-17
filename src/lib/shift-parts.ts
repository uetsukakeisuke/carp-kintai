// 1日のシフトを時間帯に分けて持つ（スマレジの「08:45〜10:15・10:30〜12:00」のような分割シフト）。
// シフトの開始・終了は最初の時間帯の開始と最後の時間帯の終了。parts が null なら、開始〜終了の続いたシフト。
// 画面（クライアント）からも使うので、データベースには触れない。

export type Part = [number, number]; // [開始分, 終了分]（24時以降は 1440 を足した値）

export const MAX_PARTS = 8;
const MAX_MIN = 48 * 60;

/** 時間帯の並びを確かめて整える（重なり・つながりはまとめる）。1つにまとまれば null（＝続いたシフト） */
export function cleanParts(v: unknown): Part[] | null | 'bad' {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length > MAX_PARTS * 2) return 'bad';
  const xs: Part[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return 'bad';
    const [s, e] = p.map(Number);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > MAX_MIN || e <= s) return 'bad';
    xs.push([s, e]);
  }
  const merged = mergeParts(xs);
  if (merged.length > MAX_PARTS) return 'bad';
  return merged.length > 1 ? merged : null;
}

/** 重なり・つながっている時間帯をまとめて、早い順に */
export function mergeParts(xs: Part[]): Part[] {
  const out: Part[] = [];
  for (const [s, e] of [...xs].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** シフトの時間帯（分割でなければ開始〜終了の1つ） */
export function partsOf(sh: { start: number; end: number; parts?: Part[] | null }): Part[] {
  return sh.parts && sh.parts.length > 1 ? sh.parts : [[sh.start, sh.end]];
}

/** 時間帯と時間帯の間（中抜け・休憩） */
export function gapsOf(parts: Part[]): Part[] {
  const g: Part[] = [];
  for (let i = 1; i < parts.length; i++) g.push([parts[i - 1][1], parts[i][0]]);
  return g;
}

const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
/** 「8:45〜10:15・10:30〜12:00」 */
export function partsText(parts: Part[], sep = '・') {
  return parts.map(([s, e]) => `${hm(s)}〜${hm(e)}`).join(sep);
}

/** 同じ時間帯か（下書きと公開済みの比べ合わせ用） */
export function sameParts(a?: Part[] | null, b?: Part[] | null) {
  return JSON.stringify(a && a.length > 1 ? a : null) === JSON.stringify(b && b.length > 1 ? b : null);
}
