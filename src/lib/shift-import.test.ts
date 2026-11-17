import { describe, expect, it } from 'vitest';
import { matchStaff, nameKey, parseCsv, parseDate, parseRanges, parseShiftTable, decodeText } from './shift-import';
import { planCost } from './calc';

// スマレジ「シフト表」の Excel と同じ形（名前は架空）
const HEAD = ['', ...Array.from({ length: 31 }, (_, i) => `2026/12/${String(i + 1).padStart(2, '0')}`), '計'];
const row = (name: string, cells: Record<number, string>, total = '') => [name, ...Array.from({ length: 31 }, (_, i) => cells[i + 1] ?? ''), total];
const GRID = [
  HEAD,
  row('見本太郎', {}, '0'),
  row('試験　花子', { 1: '15:00 ~ 16:30\n16:45 ~ 18:15', 3: '13:15 ~ 14:45\n15:00 ~ 16:30' }, '6'),
  row('架空一郎', { 8: '10:00 ~ 15:00', 9: '10:00 ~ 18:00' }, '13'),
  row('例示ケ丘 次郎', { 2: '08:45 ~ 10:15\n10:30 ~ 12:00\n13:15 ~ 14:45\n15:00 ~ 16:30\n16:45 ~ 18:15' }, '7.5'),
  ['出勤人数', ...Array.from({ length: 31 }, (_, i) => String(i % 3)), '30'],
  ['勤務時間(h)', ...Array.from({ length: 31 }, () => '7.5'), '183'],
  ['人件費(円)', ...Array.from({ length: 31 }, () => '9075'), '225050'],
];

describe('時刻・日付', () => {
  it('時間帯（改行で複数・日付またぎ・全角）', () => {
    expect(parseRanges('08:45 ~ 10:15\n10:30 ~ 12:00')).toEqual([[525, 615], [630, 720]]);
    expect(parseRanges('22:00 ~ 02:00')).toEqual([[1320, 1560]]);
    expect(parseRanges('１８：００〜２３：３０')).toEqual([[1080, 1410]]);
    expect(parseRanges('休')).toEqual([]);
    expect(parseRanges('')).toEqual([]);
    expect(parseRanges('午後から')).toBe('bad');
    expect(parseRanges('10:00 ~ 15:00 12')).toBe('bad');
  });
  it('日付', () => {
    expect(parseDate('2026/12/01')).toBe('2026-12-01');
    expect(parseDate('2026-12-1')).toBe('2026-12-01');
    expect(parseDate('2026年12月1日')).toBe('2026-12-01');
    expect(parseDate('46357')).toBe('2026-12-01'); // Excel の日付の数
    expect(parseDate('2026/02/30')).toBeNull();
    expect(parseDate('計')).toBeNull();
  });
});

describe('スマレジのシフト表', () => {
  const r = parseShiftTable(GRID);
  if (typeof r === 'string') throw new Error(r);
  it('月と人を読み、集計の行は飛ばす', () => {
    expect(r.ym).toBe('2026-12');
    expect(r.format).toBe('grid');
    expect(r.rows.map((x) => x.name)).toEqual(['見本太郎', '試験 花子', '架空一郎', '例示ケ丘 次郎']);
    expect(r.rows[0].days).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
  it('分かれた時間帯はそのまま。続いている時間帯は1つ', () => {
    const h = r.rows[1].days[0];
    expect(h).toEqual({ date: '2026-12-01', start: 900, end: 1095, parts: [[900, 990], [1005, 1095]] });
    expect(r.rows[2].days[0]).toEqual({ date: '2026-12-08', start: 600, end: 900, parts: null });
  });
  it('時間はスマレジの計と同じ（分割の間は入れない。6時間を超える続いたシフトは休憩を引く）', () => {
    const hours = (i: number) => r.rows[i].days.reduce((a, d) => a + planCost(d, 0).workMin, 0) / 60;
    expect(hours(1)).toBe(6);
    expect(hours(3)).toBe(7.5);
    expect(hours(2)).toBe(5 + 7.25); // 10:00〜18:00（8時間）は休憩45分を引いて7.25時間（スマレジは8時間で数える）
  });
  it('読めないマスは知らせて飛ばす', () => {
    const g = GRID.map((x) => [...x]);
    g[3][10] = '午前のみ';
    const x = parseShiftTable(g);
    if (typeof x === 'string') throw new Error(x);
    expect(x.warnings[0]).toContain('架空一郎 の 12/10');
  });
  it('表でないとき', () => {
    expect(typeof parseShiftTable([['a', 'b'], ['c', 'd']])).toBe('string');
  });
});

describe('1行1シフトの CSV', () => {
  it('名前・日付・開始・終了（同じ日の2行は分割シフト）', () => {
    const csv = '名前,日付,開始,終了\r\n見本太郎,2026/12/01,9:00,12:00\r\n見本太郎,2026/12/01,13:00,17:00\r\n"試験 花子",2026-12-02,18:00,23:30\r\n';
    const r = parseShiftTable(parseCsv(csv));
    if (typeof r === 'string') throw new Error(r);
    expect(r.format).toBe('list');
    expect(r.rows[0].days[0]).toEqual({ date: '2026-12-01', start: 540, end: 1020, parts: [[540, 720], [780, 1020]] });
    expect(r.rows[1]).toEqual({ name: '試験 花子', days: [{ date: '2026-12-02', start: 1080, end: 1410, parts: null }] });
  });
  it('CSV の引用符・改行', () => {
    expect(parseCsv('a,"b\nc","d""e"\n1,2,3')).toEqual([['a', 'b\nc', 'd"e'], ['1', '2', '3']]);
  });
  it('Shift_JIS', () => {
    const sjis = new Uint8Array([0x96, 0xbc, 0x91, 0x4f]); // 「名前」
    expect(decodeText(sjis)).toBe('名前');
    expect(decodeText(new TextEncoder().encode('名前'))).toBe('名前');
  });
});

describe('名前あわせ', () => {
  const staff = [{ id: 1, name: '例示ヶ丘 次郎' }, { id: 2, name: '試験 花子' }, { id: 3, name: '髙橋 一' }, { id: 4, name: '同名' }, { id: 5, name: '同 名' }];
  it('空白・ヶ/ケ・旧字をそろえる', () => {
    expect(nameKey('例示ケ丘　次郎')).toBe(nameKey('例示ヶ丘 次郎'));
    expect(matchStaff('例示ケ丘　次郎', staff)).toBe(1);
    expect(matchStaff('試験花子', staff)).toBe(2);
    expect(matchStaff('高橋一', staff)).toBe(3);
  });
  it('決まらないときは null', () => {
    expect(matchStaff('同名', staff)).toBeNull();
    expect(matchStaff('いない人', staff)).toBeNull();
  });
});
