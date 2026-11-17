// 学校の授業の時間（コマ）。シフト希望を「授業の空いているコマ」で選べるようにする。
// 間（10:15〜10:30 など）は勤務に入らない（スマレジの分かれたシフトと同じ数え方）。
import type { Part } from './shift-parts';

export const PERIODS = [
  { n: 1, s: 8 * 60 + 45, e: 10 * 60 + 15 },
  { n: 2, s: 10 * 60 + 30, e: 12 * 60 },
  { n: 3, s: 13 * 60 + 15, e: 14 * 60 + 45 },
  { n: 4, s: 15 * 60, e: 16 * 60 + 30 },
  { n: 5, s: 16 * 60 + 45, e: 18 * 60 + 15 },
] as const;

/** 選んだコマ（1〜5）の時間帯 */
export const periodParts = (ns: number[]): Part[] => PERIODS.filter((p) => ns.includes(p.n)).map((p) => [p.s, p.e] as Part);

/** 時間帯がすべてコマどおりなら、そのコマの番号。違えば null */
export function periodsOf(parts?: Part[] | null): number[] | null {
  if (!parts || !parts.length) return null;
  const ns: number[] = [];
  for (const [s, e] of parts) {
    const p = PERIODS.find((x) => x.s === s && x.e === e);
    if (!p) return null;
    ns.push(p.n);
  }
  return ns;
}

/** 「1・2・3限」 */
export const periodsLabel = (ns: number[]) => `${[...ns].sort((a, b) => a - b).join('・')}限`;
