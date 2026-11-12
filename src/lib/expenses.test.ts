import { describe, expect, it } from 'vitest';
import {
  cleanItem, cleanTravel, expenseCells, expenseTotals, formNames, reiwaFiscal, reportSheets, serial, travelCells, travelTotals,
  type ExpenseItem, type Travel,
} from './expenses';

const item = (o: Partial<ExpenseItem>): ExpenseItem => ({ id: 1, ym: '2026-10', day: '2026-10-20', doc: '領収書', payee: '高速代 立て替え', category: '旅費交通費', subject: null, amount: 470, ...o });
const travel = (o: Partial<Travel> = {}): Travel => ({
  ym: '2026-10', appliedOn: '2026-10-30', dept: '', person: '見本 太郎', destination: '京都・大阪・東京都内',
  schedule: [
    { from: '2026-10-16', to: '2026-10-16', place: '大阪市内', detail: '旅費規程に定める日帰り出張' },
    { from: '2026-10-26', to: '2026-10-27', place: '東京都内', detail: '旅費規程に定める作業超過のための宿泊' },
  ],
  diem: [{ label: '出張日当　日帰り', unit: 3000, count: 1 }, { label: '出張日当　宿泊', unit: 4000, count: 6 }, { label: '出張日当　海外', unit: 6000, count: 0 }],
  lodge: [],
  lines: [{ date: '2026-10-16', kind: '鉄道', memo: '出町柳 → 京橋 → 西長堀', amount: 790 }, { date: '2026-10-26', kind: '鉄道', memo: '横堤 → 新大阪', amount: 340 }],
  advance: 0, ...o,
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
    const a = cleanItem({ ym: '2026-11', payee: '印紙', category: 'その他', subject: '租税公課', amount: 500 });
    const b = cleanItem({ ym: '2026-11', payee: 'x', category: '会議費', subject: '立替', amount: 1 });
    expect(a.ok && a.value.subject).toBe('租税公課');
    expect(b.ok && b.value.subject).toBe(null);
  });
  it('旅費精算：空の行は捨て、日当の数は0.5刻み、上限を守る', () => {
    const r = cleanTravel({
      ym: '2026-10', schedule: [{ from: '', to: '', place: '', detail: '' }, { place: '大阪' }],
      diem: [{ label: '出張日当　日帰り', unit: '3,000', count: '1.5' }, { label: '', unit: '', count: '' }],
      lines: [{ amount: '' }, { memo: 'バス', amount: '230' }], advance: '',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.schedule).toHaveLength(1);
      expect(r.value.diem).toEqual([{ label: '出張日当　日帰り', unit: 3000, count: 1.5 }]);
      expect(r.value.lines).toEqual([{ date: '', kind: '', memo: 'バス', amount: 230 }]);
      expect(r.value.advance).toBe(0);
    }
    expect(cleanTravel({ ym: '2026-10', lines: Array.from({ length: 17 }, () => ({ memo: 'x', amount: 1 })) }).ok).toBe(false);
    expect(cleanTravel({ ym: '2026-10', diem: Array.from({ length: 5 }, () => ({ label: 'x', unit: 1, count: 1 })) }).ok).toBe(false);
    expect(cleanTravel({ ym: '2026-10', lines: [{ memo: '電車' }] }).ok).toBe(false);
  });
});

describe('合計', () => {
  it('科目ごと・全体', () => {
    const t = expenseTotals([item({ amount: 6260 }), item({}), item({ category: 'その他', amount: 500 })]);
    expect(t.byCat['旅費交通費']).toBe(6730);
    expect(t.total).toBe(7230);
  });
  it('旅費：日当＋宿泊日当＋交通費−仮払金', () => {
    expect(travelTotals(travel({ advance: 10000 }))).toEqual({ diem: 27000, lodge: 0, allowance: 27000, lines: 1130, advance: 10000, net: 18130 });
  });
});

describe('用紙のセル（実際の書式：261110給与報告フォーム）', () => {
  it('日付は Excel の日付の値', () => {
    expect(serial('2026-10-20')).toBe(46315);
    expect(serial('1900-03-01')).toBe(61);
  });
  it('現金経費精算：24行、科目の列に金額、合計は30行目で6行目から', () => {
    const s = expenseCells({ ym: '2026-10', settleDate: '2026-11-05', settleMethod: 'bank', person: '上塚' },
      [item({ amount: 6260, payee: 'タイムズカーシェア' }), item({ id: 2, day: null, payee: '印紙', category: 'その他', subject: '租税公課', amount: 500 })], '2026-10');
    const c = cellMap(s.cells);
    expect(c.get('A1')).toBe('令和8年度');
    expect(c.get('D1')).toBe(10);
    expect([c.get('A6'), c.get('B6'), c.get('C6'), c.get('D6')]).toEqual([46315, '領収書', 'タイムズカーシェア', 6260]);
    expect([c.get('A7'), c.get('M7'), c.get('N7')]).toEqual([null, '租税公課', 500]);
    expect(c.has('C29') && c.get('C29')).toBe(null);
    expect(c.has('C30')).toBe(false);
    expect(c.get('D30')).toEqual({ f: 'SUM(D6:D29)', v: 6260 });
    expect(c.get('K32')).toEqual({ f: 'SUM(D30:L30,N30)', v: 6760 });
    expect(c.get('B33')).toBe('　■銀行振込　　　　□現金　　　　氏名　上塚');
    expect(c.get('B32')).toContain('11月');
  });
  it('1月〜3月は前の年度', () => {
    expect(reiwaFiscal('2027-03')).toBe(8);
    expect(reiwaFiscal('2027-04')).toBe(9);
  });
  it('24行を超えるとエラー', () => {
    expect(() => expenseCells(null, Array.from({ length: 25 }, (_, i) => item({ id: i })), '2026-10')).toThrow();
  });
  it('旅費精算書：申請日・スケジュール・日当の行・明細・差引', () => {
    const c = cellMap(travelCells(travel()).cells);
    expect([c.get('AB2'), c.get('AE2'), c.get('AH2')]).toEqual([8, 10, 30]);
    expect([c.get('Y11'), c.get('H11'), c.get('H12')]).toEqual(['見本 太郎', null, '京都・大阪・東京都内']);
    expect([c.get('B15'), c.get('F15'), c.get('I15')]).toEqual([serial('2026-10-16'), serial('2026-10-16'), '大阪市内']);
    expect([c.get('B17'), c.get('E17')]).toEqual([null, '～']);
    // 数が0の「海外」は書かない。2行のあとに「※旅費規程10条」
    expect([c.get('B26'), c.get('I26'), c.get('M26'), c.get('O26')]).toEqual(['出張日当　日帰り', 3000, 1, { f: 'I26*M26', v: 3000 }]);
    expect([c.get('B27'), c.get('I27'), c.get('M27')]).toEqual(['出張日当　宿泊', 4000, 6]);
    expect([c.get('B28'), c.get('I28'), c.get('B29')]).toEqual(['※旅費規程10条', null, null]);
    expect([c.get('S26'), c.get('S27'), c.get('AF26')]).toEqual(['宿泊日当', '※旅費規程10条', null]);
    expect(c.get('O30')).toEqual({ f: 'SUM(O26:R29)', v: 27000 });
    expect([c.get('B33'), c.get('F33'), c.get('L33'), c.get('AF33')]).toEqual([serial('2026-10-16'), '鉄道', '出町柳 → 京橋 → 西長堀', 790]);
    expect(c.get('AE51')).toEqual({ f: 'SUM(AF33:AI48)', v: 1130 });
    expect(c.get('AE53')).toEqual({ f: 'AE50+AE51-AE52', v: 28130 });
  });
  it('シートは経費1枚＋（中身があれば）旅費1枚', () => {
    expect(reportSheets('2026-10', null, [], null).map((x) => x.name)).toEqual(['現金経費精算']);
    expect(reportSheets('2026-10', null, [], travel()).map((x) => x.name)).toEqual(['現金経費精算', '旅費精算']);
    const empty = travel({ destination: '', schedule: [], lines: [], diem: [{ label: 'a', unit: 3000, count: 0 }] });
    expect(reportSheets('2026-10', null, [], empty)).toHaveLength(1);
  });
  it('ファイル名・フォルダ名は支給月（10月分→2611、12月分→2701）', () => {
    expect(formNames('2026-10', 10)).toEqual({ yymm: '2611', file: '2611給与報告フォーム.xlsx', folder: '261110支給分', payYm: '2026-11' });
    expect(formNames('2026-12', 10).file).toBe('2701給与報告フォーム.xlsx');
    expect(formNames('2026-12', 5).folder).toBe('270105支給分');
  });
});
