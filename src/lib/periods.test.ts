import { describe, expect, it } from 'vitest';
import { PERIODS, periodParts, periodsOf, periodsLabel } from './periods';
import { planCost } from './calc';
import { cleanParts } from './shift-parts';

describe('授業のコマ', () => {
  it('コマの時間', () => {
    expect(PERIODS.map((p) => [p.s, p.e])).toEqual([[525, 615], [630, 720], [795, 885], [900, 990], [1005, 1095]]);
  });
  it('選んだコマの時間帯（続いたコマも間で分かれる）', () => {
    expect(periodParts([2, 1])).toEqual([[525, 615], [630, 720]]);
    expect(cleanParts(periodParts([1, 2, 3]))).toEqual([[525, 615], [630, 720], [795, 885]]); // 間があるのでまとまらない
    expect(periodParts([])).toEqual([]);
  });
  it('時間帯からコマに戻す', () => {
    expect(periodsOf([[525, 615], [795, 885]])).toEqual([1, 3]);
    expect(periodsOf([[525, 620]])).toBeNull();
    expect(periodsOf(null)).toBeNull();
    expect(periodsLabel([3, 1, 2])).toBe('1・2・3限');
  });
  it('コマで入れた日の勤務時間は、コマの合計（間は入らない・休憩も引かない）', () => {
    const ps = periodParts([1, 2, 3, 4, 5]);
    expect(planCost({ start: ps[0][0], end: ps[4][1], parts: ps }, 1200).workMin).toBe(450);
  });
});
