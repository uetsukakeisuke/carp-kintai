import { describe, expect, it } from 'vitest';
import { cleanItem, cleanTrip, expenseCells, expenseTotals, monthSheets, reiwaFiscal, travelCells, tripTotals, type ExpenseItem, type Trip } from './expenses';

const item = (o: Partial<ExpenseItem>): ExpenseItem => ({ id: 1, ym: '2026-11', day: '2026-11-05', doc: null, payee: 'コピー用紙', category: '消耗品費', subject: null, amount: 3300, ...o });
const trip = (o: Partial<Trip> = {}): Trip => ({
  id: 1, ym: '2026-11', appliedOn: '2026-11-20', dept: '本社', person: '見本 太郎', destination: '東京',
  schedule: [{ from: '2026-11-17', to: '2026-11-18', place: '展示会場', detail: '展示会の視察' }],
  diemUnit: 5000, diemDays: 2, lodgeUnit: 10000, lodgeNights: 1,
  lines: [{ date: '2026-11-17', kind: '新幹線', memo: '京都→東京 往復', amount: 28340 }], advance: 30000, ...o,
});
const cellMap = (c: [string, unknown][]) => new Map(c);

describe('入力の確かめ', () => {
  it('金額はカンマや円があっても読める', () => {
    const r = cleanItem({ ym: '2026-11', day: '2026-11-05', payee: ' 文具 ', category: '事務消耗品', amount: '1,980円' });
    expect(r.ok && r.value).toMatchObject({ payee: '文具', amount: 1980, category: '事務消耗品', subject: null });
  });
  it('科目・金額・支払先がないとだめ', () => {
    expect(cleanItem({ ym: '2026-11', payee: 'a', category: '雑費', amount: 1 }).ok).toBe(false);
    expect(cleanItem({ ym: '2026-11', payee: 'a', category: '会議費', amount: 0 }).ok).toBe(false);
    expect(cleanItem({ ym: '2026-11', payee: ' ', category: '会議費', amount: 10 }).ok).toBe(false);
    expect(cleanItem({ ym: '2026-13', payee: 'a', category: '会議費', amount: 10 }).ok).toBe(false);
  });
  it('その他のときだけ科目名を残す', () => {
    const a = cleanItem({ ym: '2026-11', payee: 'たばこ購入', category: 'その他', subject: '立替', amount: 42741 });
    const b = cleanItem({ ym: '2026-11', payee: 'x', category: '会議費', subject: '立替', amount: 1 });
    expect(a.ok && a.value.subject).toBe('立替');
    expect(b.ok && b.value.subject).toBe(null);
  });
  it('旅費精算：空の行は捨て、行数の上限を守る', () => {
    const r = cleanTrip({ ym: '2026-11', schedule: [{ from: '', to: '', place: '', detail: '' }, { place: '大阪' }], lines: [{ amount: '' }, { memo: 'バス', amount: '230' }], diemUnit: '5000', diemDays: '1.5', lodgeUnit: 10000, lodgeNights: 0, advance: '' });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.schedule).toHaveLength(1); expect(r.value.lines).toEqual([{ date: '', kind: '', memo: 'バス', amount: 230 }]); expect(r.value.diemDays).toBe(1.5); expect(r.value.advance).toBe(0); }
    const many = cleanTrip({ ym: '2026-11', lines: Array.from({ length: 17 }, () => ({ memo: 'x', amount: 1 })), diemUnit: 0, lodgeUnit: 0, diemDays: 0, lodgeNights: 0 });
    expect(many.ok).toBe(false);
    const noAmount = cleanTrip({ ym: '2026-11', lines: [{ memo: '電車' }], diemUnit: 0, lodgeUnit: 0, diemDays: 0, lodgeNights: 0 });
    expect(noAmount.ok).toBe(false);
  });
});

describe('合計', () => {
  it('科目ごと・全体', () => {
    const t = expenseTotals([item({}), item({ amount: 700 }), item({ category: 'その他', amount: 42741 })]);
    expect(t.byCat['消耗品費']).toBe(4000);
    expect(t.byCat['その他']).toBe(42741);
    expect(t.total).toBe(46741);
  });
  it('旅費：日当＋宿泊日当＋交通費−仮払金', () => {
    expect(tripTotals(trip())).toEqual({ diem: 10000, lodge: 10000, allowance: 20000, lines: 28340, advance: 30000, net: 18340 });
  });
});

describe('用紙のセル', () => {
  it('現金経費精算：科目の列に金額、合計式は6行目から', () => {
    const s = expenseCells({ ym: '2026-11', settleDate: '2026-11-30', settleMethod: 'bank', person: '上塚' },
      [item({ doc: '領収書' }), item({ id: 2, day: null, payee: 'たばこ購入', category: 'その他', subject: '立替', amount: 42741 })], '2026-11');
    const c = cellMap(s.cells);
    expect(c.get('A1')).toBe('令和8年度');
    expect(c.get('D1')).toBe(11);
    expect([c.get('A6'), c.get('B6'), c.get('C6'), c.get('J6')]).toEqual(['11/5', '領収書', 'コピー用紙', 3300]);
    expect([c.get('A7'), c.get('M7'), c.get('N7'), c.get('J7')]).toEqual([null, '立替', 42741, null]);
    expect(c.get('C27')).toBe(null); // 空の行は消す
    expect(c.get('J28')).toEqual({ f: 'SUM(J6:J27)', v: 3300 });
    expect(c.get('K30')).toEqual({ f: 'SUM(D28:L28,N28)', v: 46041 });
    expect(c.get('B31')).toContain('■銀行振込');
    expect(c.get('B31')).toContain('□現金');
    expect(String(c.get('B31')).endsWith('氏名　上塚')).toBe(true);
    expect(c.get('B30')).toContain('11月');
  });
  it('1月〜3月は前の年度', () => {
    expect(reiwaFiscal('2027-03')).toBe(8);
    expect(reiwaFiscal('2027-04')).toBe(9);
  });
  it('22行を超えるとエラー', () => {
    expect(() => expenseCells(null, Array.from({ length: 23 }, (_, i) => item({ id: i })), '2026-11')).toThrow();
  });
  it('旅費精算書：申請日・スケジュール・明細・差引', () => {
    const s = travelCells(trip(), 1);
    expect(s.name).toBe('旅費精算 (2)');
    const c = cellMap(s.cells);
    expect([c.get('AB2'), c.get('AE2'), c.get('AH2')]).toEqual([8, 11, 20]);
    expect([c.get('B15'), c.get('F15'), c.get('I15'), c.get('Q15')]).toEqual(['11/17', '11/18', '展示会場', '展示会の視察']);
    expect(c.get('B16')).toBe(null);
    expect([c.get('I26'), c.get('M26'), c.get('Z26'), c.get('AD26')]).toEqual([5000, 2, 10000, 1]);
    expect([c.get('B33'), c.get('F33'), c.get('L33'), c.get('AF33')]).toEqual(['11/17', '新幹線', '京都→東京 往復', 28340]);
    expect(c.get('AE52')).toBe(30000);
    expect(c.get('AE53')).toEqual({ f: 'AE50+AE51-AE52', v: 18340 });
  });
  it('何もない月はシートを出さない。旅費精算は枚数分', () => {
    expect(monthSheets('2026-11', null, [], [])).toEqual([]);
    const s = monthSheets('2026-11', null, [], [trip(), trip({ id: 2 })]);
    expect(s.map((x) => x.name)).toEqual(['旅費精算', '旅費精算 (2)']);
    expect(monthSheets('2026-11', { ym: '2026-11', settleDate: null, settleMethod: 'cash', person: null }, [], [])[0].kind).toBe('expense');
  });
});
