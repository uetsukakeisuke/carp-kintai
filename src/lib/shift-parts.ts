// シフトの時間帯（parts）。スマレジから取り込んだシフトは、書いてある時間帯どおりに持つ
// （「08:45〜10:15・10:30〜12:00」のような分割も、「10:00〜18:00」の1つでも）。
//   parts あり … 時間帯の長さの合計がそのまま勤務時間（休憩を自動で引かない。間の時間は入れない）
//   parts なし … アプリで入れたシフト。開始〜終了から、6時間超で45分・8時間超で60分の休憩を引く
// シフトの開始・終了は最初の時間帯の開始と最後の時間帯の終了。画面（クライアント）からも使うので、データベースには触れない。

export type Part = [number, number]; // [開始分, 終了分]（24時以降は 1440 を足した値）

export const MAX_PARTS = 8;
const MAX_MIN = 48 * 60;

/** 時間帯の並びを確かめて整える（重なり・つながりはまとめる）。空なら null */
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
  return merged.length ? merged : null;
}

/** 時間帯が2つ以上に分かれているか（中抜け・間の時間がある） */
export const isSplit = (p?: Part[] | null): p is Part[] => !!p && p.length > 1;

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

/** シフトの時間帯（parts がなければ開始〜終了の1つ） */
export function partsOf(sh: { start: number; end: number; parts?: Part[] | null }): Part[] {
  return sh.parts && sh.parts.length ? sh.parts : [[sh.start, sh.end]];
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
  return JSON.stringify(a && a.length ? a : null) === JSON.stringify(b && b.length ? b : null);
}
