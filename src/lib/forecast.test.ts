import { describe, expect, it } from 'vitest';
import { dayLoads, predictMin, fit, planDraft, readParams, DEFAULT_PARAMS, type Coef, type Sample, type Window } from './forecast';
import type { OrderRow } from './kobo';

const row = (x: Partial<OrderRow>): OrderRow => ({
  line: 2, part: 'P', qty: '', qtyN: 100, kg: 10, supplier: '仕入A', customer: '甲', amount: 1000, custDue: null, supDue: null,
  received: false, delivered: false, inspected: false, invoiced: false, orderNo: '', fromStock: false, toStock: false, ...x,
});
const TODAY = '2026-11-11';

describe('作業量', () => {
  it('入荷は仕入納期、出荷は客先納入日の前日。過ぎたものは今日に寄せる', () => {
    const m = dayLoads([
      row({ part: 'A', supDue: '2026-11-20', custDue: '2026-11-25' }),
      row({ part: 'B', supDue: '2026-11-01', custDue: '2026-11-12' }), // 入荷遅れ → 今日
      row({ part: 'C', supDue: '2026-11-20', received: true, custDue: '2026-11-25' }), // 入荷済み → 出荷だけ
      row({ part: 'D', supplier: '在', fromStock: true, custDue: '2026-11-25' }), // 在庫から → 出荷だけ
      row({ part: 'E', customer: '在', toStock: true, supDue: '2026-11-20' }), // 在庫にする → 入荷だけ
      row({ part: 'F', supDue: '2026-11-20', custDue: '2026-11-25', received: true, delivered: true }), // 済 → なし
    ], TODAY, 1);
    expect(m.get('2026-11-20')!.items.map((i) => `${i.part}${i.kind}`).sort()).toEqual(['Ain', 'Ein']);
    expect(m.get('2026-11-24')!.items.map((i) => `${i.part}${i.kind}`).sort()).toEqual(['Aout', 'Cout', 'Dout']);
    expect(m.get(TODAY)!.items.map((i) => `${i.part}${i.kind}`)).toEqual(['Bin', 'Bout']);
    expect(m.get(TODAY)!.items[0].late).toBe(true);
  });
  it('予測：1件＋√個数＋重さ、営業日だけ決まった作業を足す', () => {
    const c: Coef = { base: 60, inLine: 10, inSqrt: 2, inKg: 0.5, outLine: 15, outSqrt: 2, outKg: 0.5 };
    const l = { inLines: 1, inSqrt: 10, inKg: 10, outLines: 0, outSqrt: 0, outKg: 0 };
    expect(predictMin(l, c, true)).toBe(60 + 10 + 20 + 5);
    expect(predictMin(l, c, false)).toBe(35);
    expect(predictMin(undefined, c, true)).toBe(60);
  });
  it('設定の読み込み：おかしな値は既定値', () => {
    const p = readParams({ coef: { inLine: -3, outKg: 2 }, workdays: [1, 1, 9, 6], minPeople: 2, shipLead: 'x' });
    expect(p.coef.inLine).toBe(DEFAULT_PARAMS.coef.inLine);
    expect(p.coef.outKg).toBe(2);
    expect(p.workdays).toEqual([1, 6]);
    expect(p.minPeople).toBe(2);
    expect(p.shipLead).toBe(1);
  });
});

describe('学習', () => {
  const truth: Coef = { base: 240, inLine: 20, inSqrt: 3, inKg: 1, outLine: 30, outSqrt: 1, outKg: 2 };
  // 決まった係数から作った実績（少しばらつきあり）
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sample = (i: number): Sample => {
    const load = { inLines: Math.floor(rnd() * 4), inSqrt: rnd() * 60, inKg: rnd() * 80, outLines: Math.floor(rnd() * 4), outSqrt: rnd() * 60, outKg: rnd() * 80 };
    const actual = predictMin(load, truth, true) + (rnd() - 0.5) * 20;
    return { date: `d${i}`, actualMin: actual, workday: true, load };
  };
  it('実績がなければ仮の値のまま', () => {
    expect(fit([], DEFAULT_PARAMS.coef).coef).toEqual(DEFAULT_PARAMS.coef);
  });
  it('実績がたまると本当の値に近づき、ずれが小さくなる', () => {
    const s = Array.from({ length: 120 }, (_, i) => sample(i));
    const r = fit(s, DEFAULT_PARAMS.coef);
    expect(r.n).toBe(120);
    expect(r.mae).toBeLessThan(r.maePrior / 5);
    expect(Math.abs(r.coef.base - truth.base)).toBeLessThan(40);
    expect(Math.abs(r.coef.outKg - truth.outKg)).toBeLessThan(0.6);
    for (const v of Object.values(r.coef)) expect(v).toBeGreaterThanOrEqual(0);
  });
  it('少ないうちは仮の値に近い', () => {
    const s = Array.from({ length: 3 }, (_, i) => sample(i));
    const r = fit(s, DEFAULT_PARAMS.coef);
    expect(Math.abs(r.coef.inLine - DEFAULT_PARAMS.coef.inLine)).toBeLessThan(Math.abs(truth.inLine - DEFAULT_PARAMS.coef.inLine));
  });
});

describe('下書き', () => {
  const dates = ['2026-12-01', '2026-12-02', '2026-12-03'];
  const W = (staffId: number, date: string, s = 600, e = 1080): Window => ({ staffId, date, s, e }); // 10-18時＝実働7時間（休憩1時間）
  const cost = (_id: number, _d: string, s: number, e: number) => { const dur = e - s; const work = dur > 360 ? dur - 60 : dur; return { workMin: work, total: work * 20 }; };
  const base = { dates, cost, budget: () => 0, eligible: new Set([1, 2, 3]), existing: [] as Window[] };
  it('予測の時間を満たすまで入れ、足りない日は「不足」', () => {
    const r = planDraft({ ...base, need: { '2026-12-01': { min: 600, people: 1 }, '2026-12-02': { min: 0, people: 1 }, '2026-12-03': { min: 900, people: 1 } },
      hopes: [W(1, '2026-12-01'), W(2, '2026-12-01'), W(3, '2026-12-01'), W(1, '2026-12-02'), W(2, '2026-12-03')] });
    const d = Object.fromEntries(r.days.map((x) => [x.date, x]));
    expect(d['2026-12-01'].people).toBe(2); // 420分×2で600分を超える
    expect(d['2026-12-02'].people).toBe(1);
    expect(d['2026-12-03'].short).toBe(true); // 希望が1人しかいない
    expect(r.add.length).toBe(4);
  });
  it('希望の時間どおりに入れ、希望のない人は入れない', () => {
    const r = planDraft({ ...base, need: { '2026-12-01': { min: 2000, people: 1 } }, hopes: [W(1, '2026-12-01', 540, 780)] });
    expect(r.add).toEqual([W(1, '2026-12-01', 540, 780)]);
  });
  it('偏らない：希望が同じなら日を分け合う', () => {
    const hopes = dates.flatMap((d) => [W(1, d), W(2, d)]);
    const r = planDraft({ ...base, need: Object.fromEntries(dates.map((d) => [d, { min: 300, people: 1 }])), hopes });
    const n1 = r.add.filter((w) => w.staffId === 1).length, n2 = r.add.filter((w) => w.staffId === 2).length;
    expect(Math.abs(n1 - n2)).toBeLessThanOrEqual(1);
    expect(n1 + n2).toBe(3);
  });
  it('日の予算を守る。最低人数に届かないときだけ超えてでも入れる', () => {
    const r = planDraft({ ...base, budget: () => 9000, need: { '2026-12-01': { min: 900, people: 1 } },
      hopes: [W(1, '2026-12-01'), W(2, '2026-12-01'), W(3, '2026-12-01')] });
    expect(r.add.length).toBe(1); // 1人 8400円。2人目は予算超え
    expect(r.days[0].short).toBe(true);
    const r2 = planDraft({ ...base, budget: () => 5000, need: { '2026-12-01': { min: 0, people: 1 } }, hopes: [W(1, '2026-12-01')] });
    expect(r2.add.length).toBe(1);
    expect(r2.days[0].over).toBe(true);
  });
  it('すでに入れたシフトは残し、その分も数える', () => {
    const r = planDraft({ ...base, existing: [W(2, '2026-12-01')], need: { '2026-12-01': { min: 400, people: 1 } }, hopes: [W(1, '2026-12-01'), W(2, '2026-12-01')] });
    expect(r.add).toEqual([]);
    expect(r.days[0].people).toBe(1);
  });
});
