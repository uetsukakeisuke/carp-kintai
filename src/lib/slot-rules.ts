// シフトの枠（会社が作る「日・時間帯・人数」）と、スタッフが自分で入る・変える・やめるときの決まり。
// 画面とサーバーの両方で使う（データベースには触らない）
import type { Part } from './shift-parts';

export type SlotRange = { start: number; end: number; parts?: Part[] | null };
export type Slot = { id: number; work_date: string; start_min: number; end_min: number; capacity: number; label: string };

const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
export const slotName = (s: Pick<Slot, 'start_min' | 'end_min' | 'label'>) => `${s.label ? s.label + ' ' : ''}${hm(s.start_min)}〜${hm(s.end_min)}`;
/** 午前・午後（枠の始まりで決める） */
export const halfOf = (s: Pick<Slot, 'start_min'>) => (s.start_min < 12 * 60 ? '午前' : '午後');

export function segmentsOf(r: SlotRange | null | undefined): Part[] {
  if (!r) return [];
  return r.parts && r.parts.length ? r.parts.map(([a, b]) => [a, b] as Part) : [[r.start, r.end]];
}
function overlapMin(segs: Part[], a: number, b: number): number {
  return segs.reduce((t, [s, e]) => t + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);
}
/** そのシフトが枠の人数に入るか（枠と1時間以上重なる。1時間より短い枠は全部重なる） */
export function inSlot(r: SlotRange | null | undefined, slot: Pick<Slot, 'start_min' | 'end_min'>): boolean {
  if (!r) return false;
  const need = Math.min(60, slot.end_min - slot.start_min);
  return overlapMin(segmentsOf(r), slot.start_min, slot.end_min) >= need;
}
export function filled(slot: Slot, shifts: SlotRange[]): number {
  return shifts.filter((s) => inSlot(s, slot)).length;
}
/** a から b を引いた時間帯 */
export function subtract(a: Part[], b: Part[]): Part[] {
  let out = a.map(([s, e]) => [s, e] as Part);
  for (const [bs, be] of b) {
    out = out.flatMap(([s, e]): Part[] => {
      if (be <= s || bs >= e) return [[s, e]];
      const r: Part[] = [];
      if (bs > s) r.push([s, bs]);
      if (be < e) r.push([be, e]);
      return r;
    });
  }
  return out.filter(([s, e]) => e > s);
}

export type MoveCheck = { ok: true; freed: { slot: Slot; open: number }[] } | { ok: false; error: string };

/**
 * old（今のシフト。なければ null）を next（変えたあと。やめるなら null）にしてよいか。
 * - 新しく入る時間は、その日の枠の中だけ
 * - 新しく人数に入る枠は、ほかの人だけで満員ならだめ
 * - 抜ける枠で空きができたものを freed で返す（「空きが出ました」のお知らせ用）
 * others：同じ日の、本人以外のシフト
 */
export function checkMove(old: SlotRange | null, next: SlotRange | null, slots: Slot[], others: SlotRange[]): MoveCheck {
  if (next) {
    const added = subtract(segmentsOf(next), segmentsOf(old));
    if (added.length) {
      if (!slots.length) return { ok: false, error: 'この日はシフトの枠がないため、入る・延ばすことはできません' };
      const cover = slots.map((s) => [s.start_min, s.end_min] as Part);
      if (subtract(added, cover).length) return { ok: false, error: `枠の外の時間は入れられません（この日の枠：${slots.map(slotName).join('、')}）` };
    }
    for (const s of slots) {
      if (!inSlot(next, s) || inSlot(old, s)) continue;
      if (filled(s, others) >= s.capacity) return { ok: false, error: `${slotName(s)} は空きがありません` };
    }
  }
  const freed = slots
    .filter((s) => inSlot(old, s) && !inSlot(next, s))
    .map((s) => ({ slot: s, open: s.capacity - filled(s, others) }))
    .filter((x) => x.open > 0);
  return { ok: true, freed };
}

/** 時間の変更は「後ろへ」だけ（午前 → 午後）。始まりも終わりも、今より早くはできない */
export function laterOnly(old: SlotRange, next: SlotRange): string | null {
  if (next.start < old.start) return '始まりを今より早くすることはできません（変更は午前 → 午後の向きだけです）';
  if (next.end < old.end) return '終わりを今より早くすることはできません（早く帰りたいときは店長に相談してください）';
  if (next.start === old.start && next.end === old.end && !(old.parts && old.parts.length > 1)) return '時間が今と同じです';
  return null;
}
