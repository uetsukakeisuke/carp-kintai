import { describe, expect, it } from 'vitest';
import { buildReport, closingDate, closingOf, dateOf, monthOf, reportText, type Cell } from './kobo';

// 台帳と同じ並びの見出し（見本。実在の取引先は使わない）
const HEAD: Cell[] = ['', '　（管理番/部品名）', '個数', '単重kg', '総重kg', '仕入単価', '合計', '材質', '熱処理', '表面処理', '納期', '備考',
  '仕入先', '掛け率', '売単価', '合計', '粗利', '利益率', '客先', '小品番1', '小品番2', '見積提出日', '列 1', '客先\n納入日', '仕入\n納期',
  '仕入', '客先納品', '検収明細', '客先請求書\n発行', '客先注文番号', '番号②', '売上月', '仕入月'];
type R = { part: string; sup?: string; cust?: string; amt?: Cell; cd?: Cell; sd?: Cell; st?: string; sm?: string; pm?: string };
const row = (x: R): Cell[] => {
  const c: Cell[] = Array(33).fill('');
  const st = (x.st ?? '未未未未').split('');
  c[1] = x.part; c[12] = x.sup ?? '仕入A'; c[15] = x.amt ?? '10,000'; c[18] = x.cust ?? '株式会社 甲'; c[23] = x.cd ?? ''; c[24] = x.sd ?? '';
  c[25] = st[0] === '済' ? '済' : '未'; c[26] = st[1] === '済' ? '済' : '未'; c[27] = st[2] === '済' ? '済' : '未'; c[28] = st[3] === '済' ? '済' : '未';
  c[31] = x.sm ?? ''; c[32] = x.pm ?? '';
  return c;
};
const TERMS: Cell[][] = [['会社名', '支払い条件'], ['株式会社　甲', '20日締め翌月15日現金振り込み'], ['乙株式会社', '末締め翌月末']];
const TODAY = '2026-11-04';
const report = (...rows: R[]) => buildReport([HEAD, ...rows.map(row)], TERMS, TODAY);

describe('日付', () => {
  it('年のない日付は売上月（なければ今日）にいちばん近い年', () => {
    expect(dateOf('11/10', '2026-11', TODAY)).toBe('2026-11-10');
    expect(dateOf('01/04', '2027-01', TODAY)).toBe('2027-01-04');
    expect(dateOf('12/28', null, '2027-01-03')).toBe('2026-12-28');
    expect(dateOf('11月17日', '2026-11', TODAY)).toBe('2026-11-17');
    expect(dateOf('9/28', null, TODAY)).toBe('2026-09-28');
  });
  it('年の入った日付・空欄・読めない値', () => {
    expect(dateOf('2026/10/27', '2026-10', TODAY)).toBe('2026-10-27');
    expect(dateOf('2026-01-04', '2027-01', TODAY)).toBe('2027-01-04'); // 年の入れ違いを直す
    expect(dateOf('', null, TODAY)).toBeNull();
    expect(dateOf('1899-12-30', null, TODAY)).toBeNull();
    expect(dateOf('来週', null, TODAY)).toBe('bad');
    expect(dateOf('2/30', null, TODAY)).toBe('bad');
  });
  it('売上月', () => {
    expect(monthOf('2026-11')).toBe('2026-11');
    expect(monthOf('2026-9')).toBe('2026-09');
    expect(monthOf('2026-11-01')).toBe('2026-11');
    expect(monthOf('1899-12')).toBeNull();
  });
});

describe('締め日', () => {
  it('支払い条件から締め日', () => {
    expect(closingOf('20日締め翌々月20日全額現金振り込み')).toBe(20);
    expect(closingOf('末締め翌月末　現金振り込み')).toBe('end');
    expect(closingOf('月末締め、翌月26日支払い')).toBe('end');
    expect(closingOf('納品後30日以内に現金振り込み')).toBeNull();
  });
  it('納入日を含む締めの日', () => {
    expect(closingDate('2026-09-30', 20)).toBe('2026-10-20');
    expect(closingDate('2026-10-20', 20)).toBe('2026-10-20');
    expect(closingDate('2026-12-21', 20)).toBe('2027-01-20');
    expect(closingDate('2026-02-10', 'end')).toBe('2026-02-28');
  });
});

describe('朝の報告', () => {
  it('客先納期の超過：入荷済みでも未納品なら載る。納品済みは載らない', () => {
    const r = report(
      { part: 'A-1', cd: '11/01', sm: '2026-11' },
      { part: 'A-2', cd: '11/02', sm: '2026-11', st: '済未未未' },
      { part: 'A-3', cd: '11/02', sm: '2026-11', st: '済済未未' },
      { part: 'A-4', cd: '11/04', sm: '2026-11' }, // 今日が納期はまだ超過ではない
    );
    expect(r.overdue.map((f) => f.row.part)).toEqual(['A-1', 'A-2']);
  });
  it('納期が近いのに未入荷：7日以内だけ', () => {
    const r = report(
      { part: 'B-1', cd: '11/10', sm: '2026-11' },
      { part: 'B-2', cd: '11/11', sm: '2026-11' },
      { part: 'B-3', cd: '11/12', sm: '2026-11' },
      { part: 'B-4', cd: '11/10', sm: '2026-11', st: '済未未未' },
    );
    expect(r.soon.map((f) => f.row.part)).toEqual(['B-1', 'B-2']);
  });
  it('仕入先の遅れ。仕入先が「在」は外す。客先が「在」（在庫にする分）は入れる', () => {
    const r = report(
      { part: 'C-1', sd: '10/27', pm: '2026-10' },
      { part: 'C-2', sd: '10/27', pm: '2026-10', sup: '在' },
      { part: 'C-3', sd: '10/27', pm: '2026-10', cust: '在', amt: 0 },
      { part: 'C-4', sd: '11/05', pm: '2026-11' },
    );
    expect(r.late.map((f) => f.row.part)).toEqual(['C-1', 'C-3']);
  });
  it('締め日を過ぎた未請求。0円と在庫は外す。締め日前は載らない', () => {
    const r = report(
      { part: 'D-1', cd: '9/30', sm: '2026-09', st: '済済済未', amt: '15,880' },
      { part: 'D-2', cd: '10/21', sm: '2026-10', st: '済済済未' }, // 甲は20日締め：次の締めは11/20
      { part: 'D-3', cd: '9/30', sm: '2026-09', st: '済済済未', amt: 0 },
      { part: 'D-4', cd: '9/30', sm: '2026-09', st: '済済済未', cust: '在' },
      { part: 'D-5', cd: '10/15', sm: '2026-10', st: '済済済未', cust: '乙株式会社' }, // 末締め：10/31を過ぎた
      { part: 'D-6', cd: '9/30', sm: '2026-09', st: '済済済済' },
    );
    expect(r.unbilled.map((f) => [f.row.part, f.closing])).toEqual([['D-1', '2026-10-20'], ['D-5', '2026-10-31']]);
  });
  it('未入金のメモ・台帳の確認', () => {
    const r = report(
      { part: '10月20日段階　累積未入金残高', amt: '476,032', cd: '10/20', sm: '2026-10' },
      { part: 'E-1', sup: '', cd: '01/04', sm: '2027-01' },
      { part: 'E-2', cd: '#REF!' },
      { part: 'E-3', cd: '9/30', st: '済済済未', cust: '丙工業' },
    );
    expect(r.unpaid).toEqual([{ line: 2, label: '10月20日段階 累積未入金残高', customer: '株式会社 甲', amount: 476032, date: '2026-10-20' }]);
    expect(r.issues.map((i) => i.what)).toEqual([
      '仕入先が空欄です', '数式のエラー（#REF!）', '客先納入日が読めません（#REF!）', '取引先一覧に締め日がないため、請求の確認ができません（1行）',
    ]);
    expect(r.read).toBe(3);
  });
  it('列が入れ替わっても見出しの名前で読む', () => {
    const head = [...HEAD], rows = [row({ part: 'F-1', cd: '11/01', sm: '2026-11' })];
    // 先頭に列を1つ足す
    const r = buildReport([['追加', ...head], ...rows.map((x) => ['', ...x])], TERMS, TODAY);
    expect(r.fallbackColumns).toEqual([]);
    expect(r.overdue.map((f) => f.row.part)).toEqual(['F-1']);
  });
  it('文面：同じ品番はまとめる', () => {
    const r = report(
      { part: 'G-1', cd: '11/02', sm: '2026-11', st: '済未未未' },
      { part: 'G-1', cd: '11/02', sm: '2026-11', st: '済未未未' },
    );
    const t = reportText(r);
    expect(t).toContain('11/4(水)の京都工房です');
    expect(t).toContain('・甲 G-1（11/2・入荷済み）×2');
  });
});
