import { describe, expect, it } from 'vitest';
import { briefOf, hasBrief } from './brief';
import type { LoadItem } from './forecast';

const it0 = (x: Partial<LoadItem>): LoadItem => ({ kind: 'in', part: '部品A', customer: '株式会社 甲', supplier: '仕入A株式会社', due: '2026-11-12', qty: 10, kg: 5, line: 2, late: false, ...x });

describe('シフト前のまとめ（入荷・出荷）', () => {
  it('入荷は仕入先、出荷は客先の名前で、同じ品名・日付はまとめる', () => {
    const b = briefOf([
      it0({ line: 2 }), it0({ line: 3, qty: 5, kg: 2.5 }),
      it0({ kind: 'out', part: '部品B', due: '2026-11-13', line: 4 }),
    ]);
    expect(b.ins).toHaveLength(1);
    expect(b.ins[0]).toMatchObject({ party: '仕入A', qty: 15, kg: 7.5, lines: 2 });
    expect(b.outs[0]).toMatchObject({ party: '甲', part: '部品B', due: '2026-11-13' });
    expect(b.inKg).toBe(7.5);
  });
  it('遅れているものを先に、そのあと日付順', () => {
    const b = briefOf([it0({ part: 'X', due: '2026-11-12' }), it0({ part: 'Y', due: '2026-11-08', late: true })]);
    expect(b.ins.map((x) => x.part)).toEqual(['Y', 'X']);
  });
  it('金額の項目は持たない', () => {
    const b = briefOf([it0({})]);
    expect(Object.keys(b.ins[0]).sort()).toEqual(['due', 'kg', 'kind', 'late', 'lines', 'part', 'party', 'qty']);
  });
  it('空のとき', () => {
    expect(hasBrief(briefOf([]))).toBe(false);
    expect(hasBrief(null)).toBe(false);
  });
});
