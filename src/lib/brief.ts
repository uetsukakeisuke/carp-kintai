// シフト前のまとめ（スタッフ向け）に出す、その日の入荷・出荷。
// 受発注台帳の行から作るが、金額（売上・仕入単価・粗利）は持たない。品名・取引先・個数・重さ・日付だけ。
import { shortName } from './kobo';
import type { LoadItem } from './forecast';

export type BriefItem = {
  kind: 'in' | 'out';
  part: string;
  party: string;   // 入荷は仕入先、出荷は客先（短い名前）
  qty: number;
  kg: number;
  due: string;     // 入荷は仕入納期、出荷は客先納入日
  late: boolean;   // 予定の日を過ぎている（今日に寄せたもの）
  lines: number;   // まとめた台帳の行の数
};
export type DayBrief = { ins: BriefItem[]; outs: BriefItem[]; inKg: number; outKg: number };

/** その日の入荷・出荷の行を、同じ取引先・品名・日付ごとにまとめる。遅れ → 日付 → 取引先 の順 */
export function briefOf(items: LoadItem[]): DayBrief {
  const groups = new Map<string, BriefItem>();
  for (const i of items) {
    const party = shortName(i.kind === 'in' ? i.supplier : i.customer) || '（取引先なし）';
    const key = `${i.kind}|${party}|${i.part}|${i.due}`;
    const g = groups.get(key);
    if (g) { g.qty += i.qty; g.kg += i.kg; g.lines++; g.late ||= i.late; }
    else groups.set(key, { kind: i.kind, part: i.part, party, qty: i.qty, kg: i.kg, due: i.due, late: i.late, lines: 1 });
  }
  const all = [...groups.values()].sort((a, b) => Number(b.late) - Number(a.late) || a.due.localeCompare(b.due) || a.party.localeCompare(b.party, 'ja') || a.part.localeCompare(b.part, 'ja'));
  const ins = all.filter((x) => x.kind === 'in'), outs = all.filter((x) => x.kind === 'out');
  const kg = (xs: BriefItem[]) => Math.round(xs.reduce((a, x) => a + x.kg, 0) * 10) / 10;
  return { ins, outs, inKg: kg(ins), outKg: kg(outs) };
}

export const hasBrief = (b: DayBrief | null | undefined): b is DayBrief => !!b && (b.ins.length > 0 || b.outs.length > 0);
