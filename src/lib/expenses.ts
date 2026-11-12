// 経費精算・旅費精算：入力の確かめ、合計、用紙（現金経費精算・旅費精算）のどのセルに何を書くか。
// セルの書き方は Excel（給与報告フォーム）と専用スプレッドシート（Apps Script）で同じものを使う。

export const CATEGORIES = ['旅費交通費', '通信費', '接待交際費', '会議費', '福利厚生費', '水道光熱費', '消耗品費', '事務消耗品', '新聞図書費', 'その他'] as const;
export type Category = (typeof CATEGORIES)[number];
/** 用紙の列。その他は M＝科目、N＝金額 */
export const CAT_COL: Record<Category, string> = {
  旅費交通費: 'D', 通信費: 'E', 接待交際費: 'F', 会議費: 'G', 福利厚生費: 'H', 水道光熱費: 'I', 消耗品費: 'J', 事務消耗品: 'K', 新聞図書費: 'L', その他: 'N',
};
export const ITEM_FIRST_ROW = 6;
export const MAX_ITEMS = 22;       // 6〜27行目
export const MAX_SCHEDULE = 8;     // 15〜22行目
export const MAX_LINES = 16;       // 33〜48行目
export const MAX_AMOUNT = 99_999_999;
export const TRAVEL_KINDS = ['電車', '新幹線', '飛行機', 'バス', 'タクシー', '宿泊', '駐車場', '高速代', 'ガソリン', 'その他'];

export type ExpenseItem = { id: number; ym: string; day: string | null; doc: string | null; payee: string; category: Category; subject: string | null; amount: number };
export type ExpenseMonth = { ym: string; settleDate: string | null; settleMethod: 'bank' | 'cash' | null; person: string | null };
export type TripStop = { from: string; to: string; place: string; detail: string };
export type TripLine = { date: string; kind: string; memo: string; amount: number };
export type Trip = {
  id: number; ym: string; appliedOn: string | null; dept: string; person: string; destination: string;
  schedule: TripStop[]; diemUnit: number; diemDays: number; lodgeUnit: number; lodgeNights: number; lines: TripLine[]; advance: number;
};

type Ok<T> = { ok: true; value: T };
type Bad = { ok: false; error: string };

export const isYm = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const toInt = (v: unknown) => { const n = typeof v === 'string' ? Number(v.replace(/[,，円¥\s]/g, '')) : Number(v); return Number.isFinite(n) ? n : NaN; };

/** 現金経費精算の1行 */
export function cleanItem(v: Record<string, unknown>): Ok<Omit<ExpenseItem, 'id'>> | Bad {
  if (!isYm(v.ym)) return { ok: false, error: '何月分かが正しくありません' };
  const day = v.day ? (isDay(v.day) ? (v.day as string) : null) : null;
  if (v.day && !day) return { ok: false, error: '日付が正しくありません' };
  const payee = text(v.payee, 100);
  if (!payee) return { ok: false, error: '支払内容・支払先を入れてください' };
  const category = CATEGORIES.find((c) => c === v.category);
  if (!category) return { ok: false, error: '科目を選んでください' };
  const amount = toInt(v.amount);
  if (!Number.isInteger(amount) || amount === 0) return { ok: false, error: '金額を円単位の数字で入れてください' };
  if (Math.abs(amount) > MAX_AMOUNT) return { ok: false, error: '金額が大きすぎます' };
  const subject = category === 'その他' ? text(v.subject, 30) || null : null;
  return { ok: true, value: { ym: v.ym as string, day, doc: text(v.doc, 30) || null, payee, category, subject, amount } };
}

/** 精算書の下の欄 */
export function cleanFooter(v: Record<string, unknown>): Ok<ExpenseMonth> | Bad {
  if (!isYm(v.ym)) return { ok: false, error: '何月分かが正しくありません' };
  const settleDate = v.settleDate ? (isDay(v.settleDate) ? (v.settleDate as string) : null) : null;
  if (v.settleDate && !settleDate) return { ok: false, error: '精算日が正しくありません' };
  const settleMethod = v.settleMethod === 'bank' || v.settleMethod === 'cash' ? v.settleMethod : null;
  return { ok: true, value: { ym: v.ym as string, settleDate, settleMethod, person: text(v.person, 30) || null } };
}

const count = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 99 ? Math.round(n * 2) / 2 : NaN; };
const unit = (v: unknown) => { const n = toInt(v); return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : NaN; };

/** 旅費精算書1枚 */
export function cleanTrip(v: Record<string, unknown>): Ok<Omit<Trip, 'id'>> | Bad {
  if (!isYm(v.ym)) return { ok: false, error: '何月分かが正しくありません' };
  const appliedOn = v.appliedOn ? (isDay(v.appliedOn) ? (v.appliedOn as string) : null) : null;
  if (v.appliedOn && !appliedOn) return { ok: false, error: '申請日が正しくありません' };
  const rawStops = Array.isArray(v.schedule) ? (v.schedule as Record<string, unknown>[]) : [];
  const schedule: TripStop[] = [];
  for (const s of rawStops) {
    if (!s || typeof s !== 'object') continue;
    const stop = { from: isDay(s.from) ? (s.from as string) : '', to: isDay(s.to) ? (s.to as string) : '', place: text(s.place, 50), detail: text(s.detail, 100) };
    if (!stop.from && !stop.to && !stop.place && !stop.detail) continue;
    schedule.push(stop);
  }
  if (schedule.length > MAX_SCHEDULE) return { ok: false, error: `出張スケジュールは${MAX_SCHEDULE}行までです（用紙の行数）` };
  const rawLines = Array.isArray(v.lines) ? (v.lines as Record<string, unknown>[]) : [];
  const lines: TripLine[] = [];
  for (const l of rawLines) {
    if (!l || typeof l !== 'object') continue;
    const memo = text(l.memo, 100), kind = text(l.kind, 20), date = isDay(l.date) ? (l.date as string) : '';
    const empty = !memo && !kind && !date && (l.amount === '' || l.amount === null || l.amount === undefined || Number(l.amount) === 0);
    if (empty) continue;
    const amount = toInt(l.amount);
    if (!Number.isInteger(amount) || amount === 0) return { ok: false, error: `交通費その他の${lines.length + 1}行目：金額を円単位の数字で入れてください` };
    if (Math.abs(amount) > MAX_AMOUNT) return { ok: false, error: '金額が大きすぎます' };
    lines.push({ date, kind, memo, amount });
  }
  if (lines.length > MAX_LINES) return { ok: false, error: `交通費その他は${MAX_LINES}行までです（用紙の行数）` };
  const diemUnit = unit(v.diemUnit), lodgeUnit = unit(v.lodgeUnit), diemDays = count(v.diemDays), lodgeNights = count(v.lodgeNights);
  if ([diemUnit, lodgeUnit].some(Number.isNaN)) return { ok: false, error: '日当の単価を円単位の数字で入れてください' };
  if ([diemDays, lodgeNights].some(Number.isNaN)) return { ok: false, error: '日当の数は0〜99で入れてください（0.5刻み）' };
  const advance = v.advance === '' || v.advance === null || v.advance === undefined ? 0 : toInt(v.advance);
  if (!Number.isInteger(advance) || advance < 0 || advance > MAX_AMOUNT) return { ok: false, error: '仮払金を円単位の数字で入れてください' };
  return {
    ok: true,
    value: {
      ym: v.ym as string, appliedOn, dept: text(v.dept, 50), person: text(v.person, 30), destination: text(v.destination, 100),
      schedule, diemUnit, diemDays, lodgeUnit, lodgeNights, lines, advance,
    },
  };
}

// ---------- 合計 ----------
export function expenseTotals(items: Pick<ExpenseItem, 'category' | 'amount'>[]) {
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const it of items) byCat[it.category] += it.amount;
  return { byCat, total: CATEGORIES.reduce((a, c) => a + byCat[c], 0) };
}
export function tripTotals(t: Pick<Trip, 'diemUnit' | 'diemDays' | 'lodgeUnit' | 'lodgeNights' | 'lines' | 'advance'>) {
  const diem = Math.round(t.diemUnit * t.diemDays), lodge = Math.round(t.lodgeUnit * t.lodgeNights);
  const lines = t.lines.reduce((a, l) => a + l.amount, 0);
  return { diem, lodge, allowance: diem + lodge, lines, advance: t.advance, net: diem + lodge + lines - t.advance };
}

// ---------- 用紙のセル ----------
export type CellV = string | number | { f: string; v?: number } | null;
export type SheetCells = { kind: 'expense' | 'travel'; name: string; cells: [string, CellV][] };

const md = (d: string | null | undefined) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : null);
/** 令和の年度（4月はじまり） */
export function reiwaFiscal(ym: string) { const [y, m] = ym.split('-').map(Number); return (m <= 3 ? y - 1 : y) - 2018; }
export const reiwa = (y: number) => y - 2018;
export const ymLabel = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;

/** 現金経費精算（1か月1枚）。入力欄はすべて書き直す（空の欄は消す） */
export function expenseCells(month: ExpenseMonth | null, items: ExpenseItem[], ym: string): SheetCells {
  if (items.length > MAX_ITEMS) throw new Error(`現金経費精算は1か月${MAX_ITEMS}行までです`);
  const cells: [string, CellV][] = [];
  const put = (ref: string, v: CellV) => cells.push([ref, v]);
  put('A1', `令和${reiwaFiscal(ym)}年度`);
  put('D1', Number(ym.slice(5, 7)));
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  for (let i = 0; i < MAX_ITEMS; i++) {
    const r = ITEM_FIRST_ROW + i, it = items[i];
    const row: Record<string, CellV> = {};
    if (it) {
      row.A = md(it.day); row.B = it.doc; row.C = it.payee;
      row[CAT_COL[it.category]] = it.amount;
      if (it.category === 'その他') row.M = it.subject;
    }
    for (const c of cols) put(`${c}${r}`, row[c] ?? null);
  }
  const t = expenseTotals(items);
  const last = ITEM_FIRST_ROW + MAX_ITEMS - 1;
  for (const c of CATEGORIES) put(`${CAT_COL[c]}28`, { f: `SUM(${CAT_COL[c]}${ITEM_FIRST_ROW}:${CAT_COL[c]}${last})`, v: t.byCat[c] });
  put('K30', { f: 'SUM(D28:L28,N28)', v: t.total });
  const sd = month?.settleDate;
  put('B30', sd ? `　${Number(sd.slice(5, 7))}月　　${Number(sd.slice(8, 10))}日` : '月　　　　　　日');
  const box = (on: boolean) => (on ? '■' : '□');
  put('B31', `　${box(month?.settleMethod === 'bank')}銀行振込　　　　${box(month?.settleMethod === 'cash')}現金　　　　氏名　${month?.person ?? ''}`.trimEnd());
  return { kind: 'expense', name: '現金経費精算', cells };
}

/** 旅費精算書（出張1回で1枚） */
export function travelCells(t: Trip, index: number): SheetCells {
  if (t.schedule.length > MAX_SCHEDULE || t.lines.length > MAX_LINES) throw new Error('旅費精算書の行数が用紙を超えています');
  const cells: [string, CellV][] = [];
  const put = (ref: string, v: CellV) => cells.push([ref, v]);
  const a = t.appliedOn;
  put('AB2', a ? reiwa(Number(a.slice(0, 4))) : null);
  put('AE2', a ? Number(a.slice(5, 7)) : null);
  put('AH2', a ? Number(a.slice(8, 10)) : null);
  put('H11', t.dept || null); put('Y11', t.person || null); put('H12', t.destination || null);
  for (let i = 0; i < MAX_SCHEDULE; i++) {
    const r = 15 + i, s = t.schedule[i];
    put(`B${r}`, s ? md(s.from) : null); put(`F${r}`, s ? md(s.to) : null);
    put(`I${r}`, s?.place || null); put(`Q${r}`, s?.detail || null);
  }
  const tt = tripTotals(t);
  put('I26', t.diemDays ? t.diemUnit : null); put('M26', t.diemDays || null); put('O26', { f: 'I26*M26', v: tt.diem });
  put('Z26', t.lodgeNights ? t.lodgeUnit : null); put('AD26', t.lodgeNights || null); put('AF26', { f: 'Z26*AD26', v: tt.lodge });
  put('O30', { f: 'SUM(O26:O29)', v: tt.diem }); put('AF30', { f: 'SUM(AF26:AF29)', v: tt.lodge });
  for (let i = 0; i < MAX_LINES; i++) {
    const r = 33 + i, l = t.lines[i];
    put(`B${r}`, l ? md(l.date) : null); put(`F${r}`, l?.kind || null); put(`L${r}`, l?.memo || null); put(`AF${r}`, l ? l.amount : null);
  }
  put('AE50', { f: 'O30+AF30', v: tt.allowance });
  put('AE51', { f: 'SUM(AF33:AF48)', v: tt.lines });
  put('AE52', t.advance || null);
  put('AE53', { f: 'AE50+AE51-AE52', v: tt.net });
  return { kind: 'travel', name: index ? `旅費精算 (${index + 1})` : '旅費精算', cells };
}

/** その月に書き出すシート（経費が何もない月は現金経費精算を出さない） */
export function monthSheets(ym: string, month: ExpenseMonth | null, items: ExpenseItem[], trips: Trip[]): SheetCells[] {
  const out: SheetCells[] = [];
  const hasFooter = !!(month && (month.settleDate || month.settleMethod || month.person));
  if (items.length || hasFooter) out.push(expenseCells(month, items, ym));
  trips.forEach((t, i) => out.push(travelCells(t, i)));
  return out;
}
