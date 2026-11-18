import { describe, expect, it } from 'vitest';
import { checkMove, inSlot, laterOnly, subtract, type Slot } from './slot-rules';

const D = '2026-12-10';
const AM: Slot = { id: 1, work_date: D, start_min: 540, end_min: 720, capacity: 2, label: '出荷' }; // 9:00〜12:00
const PM: Slot = { id: 2, work_date: D, start_min: 780, end_min: 1080, capacity: 3, label: '出荷' }; // 13:00〜18:00
const r = (start: number, end: number) => ({ start, end });

describe('枠の人数に入るか', () => {
  it('1時間以上重なれば入る', () => {
    expect(inSlot(r(540, 1080), AM)).toBe(true);
    expect(inSlot(r(540, 1080), PM)).toBe(true);
    expect(inSlot(r(540, 810), PM)).toBe(false); // 30分だけ
    expect(inSlot(r(540, 840), PM)).toBe(true);
    expect(inSlot({ start: 540, end: 1080, parts: [[540, 720], [960, 1080]] }, PM)).toBe(true);
    expect(inSlot({ start: 540, end: 1020, parts: [[540, 720], [990, 1020]] }, PM)).toBe(false);
  });
  it('引き算', () => {
    expect(subtract([[540, 1080]], [[600, 720]])).toEqual([[540, 600], [720, 1080]]);
    expect(subtract([[780, 1080]], [[540, 1080]])).toEqual([]);
  });
});

describe('入る・変える・やめる', () => {
  it('空きがあれば入れる。満員なら入れない', () => {
    expect(checkMove(null, r(780, 1080), [AM, PM], [r(780, 1080), r(780, 1080)]).ok).toBe(true);
    const full = checkMove(null, r(780, 1080), [AM, PM], [r(780, 1080), r(780, 1080), r(600, 1080)]);
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error).toContain('空きがありません');
  });
  it('枠の外・枠のない日は入れない', () => {
    const out = checkMove(null, r(720, 1080), [AM, PM], []);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain('枠の外');
    expect(checkMove(null, r(780, 1080), [], []).ok).toBe(false);
  });
  it('午前 → 午後に移す：午後に空きがあればよく、午前に空きが出る', () => {
    const m = checkMove(r(540, 720), r(780, 1080), [AM, PM], [r(540, 720), r(780, 1080)]);
    expect(m).toEqual({ ok: true, freed: [{ slot: AM, open: 1 }] });
  });
  it('すでに入っている枠は、満員でもそのまま（終わりを延ばすだけ）', () => {
    const others = [r(780, 1080), r(780, 1080)];
    expect(checkMove(r(780, 1020), r(780, 1080), [PM], others).ok).toBe(true);
  });
  it('やめると、抜けた枠すべてに空きが出る', () => {
    const m = checkMove(r(540, 1080), null, [AM, PM], [r(540, 720)]);
    expect(m.ok && m.freed.map((x) => [x.slot.id, x.open])).toEqual([[1, 1], [2, 3]]);
  });
  it('枠のない日でも、やめる・短くするのはよい', () => {
    expect(checkMove(r(540, 1080), null, [], []).ok).toBe(true);
    expect(checkMove(r(540, 1080), r(780, 1080), [], []).ok).toBe(true);
  });
});

describe('時間の変更は後ろへだけ', () => {
  it('始まり・終わりを早くできない', () => {
    expect(laterOnly(r(540, 900), r(780, 1080))).toBeNull();
    expect(laterOnly(r(540, 1080), r(780, 1080))).toBeNull();
    expect(laterOnly(r(780, 1080), r(540, 900))).toContain('始まり');
    expect(laterOnly(r(540, 1080), r(540, 900))).toContain('終わり');
    expect(laterOnly(r(540, 900), r(540, 900))).toContain('同じ');
  });
});
