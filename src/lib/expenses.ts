// 経費精算・旅費精算：入力の確かめ、合計、用紙（給与報告フォームの「現金経費精算」「旅費精算」）のどのセルに何を書くか。
// 用紙の形は、実際に使っている月のファイル（例：261110給与報告フォーム.xlsx）に合わせている。

export const CATEGORIES = ['旅費交通費', '通信費', '接待交際費', '会議費', '福利厚生費', '水道光熱費', '消耗品費', '事務消耗品', '新聞図書費', 'その他'] as const;
export type Category = (typeof CATEGORIES)[number];
/** 用紙の列。その他は M＝科目、N＝金額 */
export const CAT_COL: Record<Category, string> = {
  旅費交通費: 'D', 通信費: 'E', 接待交際費: 'F', 会議費: 'G', 福利厚生費: 'H', 水道光熱費: 'I', 消耗品費: 'J', 事務消耗品: 'K', 新聞図書費: 'L', その他: 'N',
};
export const ITEM_FIRST_ROW = 6;
export const MAX_ITEMS = 24;       // 6〜29行目（30行目が合計）
export const MAX_SCHEDULE = 8;     // 15〜22行目
export const MAX_DIEM = 4;         // 26〜29行目
export const MAX_LINES = 16;       // 33〜48行目
export const MAX_AMOUNT = 99_999_999;
export const TRAVEL_KINDS = ['鉄道', '新幹線', '飛行機', 'バス', 'タクシー', '宿泊', '駐車場', '高速代', 'ガソリン', 'その他'];
/** 日当の行の名前（いつも使っているもの） */
export const DIEM_PRESETS = [
  { label: '出張日当　日帰り', unit: 3000 },
  { label: '出張日当　宿泊', unit: 4000 },
  { label: '出張日当　海外', unit: 6000 },
];
export const LODGE_PRESETS = [{ label: '宿泊日当', unit: 0 }];
const NOTE = '※旅費規程10条';

export type ExpenseItem = { id: number; ym: string; day: string | null; doc: string | null; payee: string; category: Category; subject: string | null; amount: number };
export type ExpenseMonth = { ym: string; settleDate: string | null; settleMethod: 'bank' | 'cash' | null; person: string | null };
export type TripStop = { from: string; to: string; place: string; detail: string };
export type DiemLine = { label: string; unit: number; count: number };
export type TripLine = { date: string; kind: string; memo: string; amount: number };
/** 旅費精算書（1か月に1枚。その月の出張をまとめて書く） */
export type Travel = {
  ym: string; appliedOn: string | null; dept: string; person: string; destination: string;
  schedule: TripStop[]; diem: DiemLine[]; lodge: DiemLine[]; lines: TripLine[]; advance: number;
};

type Ok<T> = { ok: true; value: T };
type Bad = { ok: false; error: string };

export const isYm = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');
const toInt = (v: unknown) => { const n = typeof v === 'string' ? Number(v.replace(/[,，円¥\s]/g, '')) : Number(v); return Number.isFinite(n) ? n : NaN; };
const blank = (v: unknown) => v === '' || v === null || v === undefined;

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

const count = (v: unknown) => { if (blank(v)) return 0; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 99 ? Math.round(n * 2) / 2 : NaN; };
const unit = (v: unknown) => { if (blank(v)) return 0; const n = toInt(v); return Number.isInteger(n) && n >= 0 && n <= 1_000_000 ? n : NaN; };

function cleanDiem(raw: unknown, what: string): Ok<DiemLine[]> | Bad {
  const out: DiemLine[] = [];
  for (const d of Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []) {
    if (!d || typeof d !== 'object') continue;
    const label = text(d.label, 30), u = unit(d.unit), c = count(d.count);
    if (!label && !u && !c) continue;
    if (Number.isNaN(u)) return { ok: false, error: `${what}の単価を円単位の数字で入れてください` };
    if (Number.isNaN(c)) return { ok: false, error: `${what}の数は0〜99で入れてください（0.5刻み）` };
    out.push({ label: label || what, unit: u, count: c });
  }
  if (out.length > MAX_DIEM) return { ok: false, error: `${what}は${MAX_DIEM}行までです（用紙の行数）` };
  return { ok: true, value: out };
}

/** 旅費精算書（月1枚） */
export function cleanTravel(v: Record<string, unknown>): Ok<Travel> | Bad {
  if (!isYm(v.ym)) return { ok: false, error: '何月分かが正しくありません' };
  const appliedOn = v.appliedOn ? (isDay(v.appliedOn) ? (v.appliedOn as string) : null) : null;
  if (v.appliedOn && !appliedOn) return { ok: false, error: '申請日が正しくありません' };
  const schedule: TripStop[] = [];
  for (const s of Array.isArray(v.schedule) ? (v.schedule as Record<string, unknown>[]) : []) {
    if (!s || typeof s !== 'object') continue;
    const stop = { from: isDay(s.from) ? (s.from as string) : '', to: isDay(s.to) ? (s.to as string) : '', place: text(s.place, 50), detail: text(s.detail, 100) };
    if (!stop.from && !stop.to && !stop.place && !stop.detail) continue;
    schedule.push(stop);
  }
  if (schedule.length > MAX_SCHEDULE) return { ok: false, error: `出張スケジュールは${MAX_SCHEDULE}行までです（用紙の行数）` };
  const diem = cleanDiem(v.diem, '出張日当');
  if (!diem.ok) return diem;
  const lodge = cleanDiem(v.lodge, '宿泊日当');
  if (!lodge.ok) return lodge;
  const lines: TripLine[] = [];
  for (const l of Array.isArray(v.lines) ? (v.lines as Record<string, unknown>[]) : []) {
    if (!l || typeof l !== 'object') continue;
    const memo = text(l.memo, 100), kind = text(l.kind, 20), date = isDay(l.date) ? (l.date as string) : '';
    if (!memo && !kind && !date && (blank(l.amount) || Number(l.amount) === 0)) continue;
    const amount = toInt(l.amount);
    if (!Number.isInteger(amount) || amount === 0) return { ok: false, error: `交通費その他の${lines.length + 1}行目：金額を円単位の数字で入れてください` };
    if (Math.abs(amount) > MAX_AMOUNT) return { ok: false, error: '金額が大きすぎます' };
    lines.push({ date, kind, memo, amount });
  }
  if (lines.length > MAX_LINES) return { ok: false, error: `交通費その他は${MAX_LINES}行までです（用紙の行数）` };
  const advance = blank(v.advance) ? 0 : toInt(v.advance);
  if (!Number.isInteger(advance) || advance < 0 || advance > MAX_AMOUNT) return { ok: false, error: '仮払金を円単位の数字で入れてください' };
  return {
    ok: true,
    value: {
      ym: v.ym as string, appliedOn, dept: text(v.dept, 50), person: text(v.person, 30), destination: text(v.destination, 100),
      schedule, diem: diem.value, lodge: lodge.value, lines, advance,
    },
  };
}

/** 旅費精算書に何か書いてあるか（申請日・氏名だけなら空とみなす） */
export const travelHasContent = (t: Travel | null) =>
  !!t && (!!t.destination || t.schedule.length > 0 || t.lines.length > 0 || t.advance > 0 || [...t.diem, ...t.lodge].some((d) => d.count > 0));

// ---------- 合計 ----------
export function expenseTotals(items: Pick<ExpenseItem, 'category' | 'amount'>[]) {
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const it of items) byCat[it.category] += it.amount;
  return { byCat, total: CATEGORIES.reduce((a, c) => a + byCat[c], 0) };
}
const lineAmt = (d: DiemLine) => Math.round(d.unit * d.count);
export function travelTotals(t: Pick<Travel, 'diem' | 'lodge' | 'lines' | 'advance'>) {
  const diem = t.diem.reduce((a, d) => a + lineAmt(d), 0), lodge = t.lodge.reduce((a, d) => a + lineAmt(d), 0);
  const lines = t.lines.reduce((a, l) => a + l.amount, 0);
  return { diem, lodge, allowance: diem + lodge, lines, advance: t.advance, net: diem + lodge + lines - t.advance };
}

// ---------- 用紙のセル ----------
export type CellV = string | number | { f: string; v?: number } | null;
export type SheetCells = { kind: 'expense' | 'travel'; name: string; cells: [string, CellV][] };

/** Excel の日付の値（1900年方式の通し番号）。セルの書式（m/d、m月d日）で表示される */
export const serial = (d: string) => (Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86_400_000;
const dateCell = (d: string | null | undefined): CellV => (d ? serial(d) : null);
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
      row.A = dateCell(it.day); row.B = it.doc; row.C = it.payee;
      row[CAT_COL[it.category]] = it.amount;
      if (it.category === 'その他') row.M = it.subject;
    }
    for (const c of cols) put(`${c}${r}`, row[c] ?? null);
  }
  const t = expenseTotals(items);
  const last = ITEM_FIRST_ROW + MAX_ITEMS - 1;
  for (const c of CATEGORIES) put(`${CAT_COL[c]}30`, { f: `SUM(${CAT_COL[c]}${ITEM_FIRST_ROW}:${CAT_COL[c]}${last})`, v: t.byCat[c] });
  put('K32', { f: 'SUM(D30:L30,N30)', v: t.total });
  const sd = month?.settleDate;
  put('B32', sd ? `　${Number(sd.slice(5, 7))}月　　${Number(sd.slice(8, 10))}日` : '月　　　　　　日');
  const box = (on: boolean) => (on ? '■' : '□');
  put('B33', `　${box(month?.settleMethod === 'bank')}銀行振込　　　　${box(month?.settleMethod === 'cash')}現金　　　　氏名　${month?.person ?? ''}`.trimEnd());
  return { kind: 'expense', name: '現金経費精算', cells };
}

/** 日当の4行（26〜29行目）。数が0の行は書かない。行が余れば「※旅費規程10条」を次の行に */
function diemRows(put: (ref: string, v: CellV) => void, lines: DiemLine[], c: { label: string; unit: string; count: string; amount: string }, first: string) {
  const used = lines.filter((d) => d.count > 0);
  for (let i = 0; i < MAX_DIEM; i++) {
    const r = 26 + i, d = used[i];
    if (d) {
      put(`${c.label}${r}`, d.label); put(`${c.unit}${r}`, d.unit); put(`${c.count}${r}`, d.count);
      put(`${c.amount}${r}`, { f: `${c.unit}${r}*${c.count}${r}`, v: lineAmt(d) });
    } else {
      const label = !used.length && i === 0 ? first : i === Math.max(used.length, 1) ? NOTE : null;
      put(`${c.label}${r}`, label); put(`${c.unit}${r}`, null); put(`${c.count}${r}`, null); put(`${c.amount}${r}`, null);
    }
  }
}

/** 旅費精算書（月1枚） */
export function travelCells(t: Travel): SheetCells {
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
    put(`B${r}`, s ? dateCell(s.from) : null); put(`E${r}`, '～'); put(`F${r}`, s ? dateCell(s.to) : null);
    put(`I${r}`, s?.place || null); put(`Q${r}`, s?.detail || null);
  }
  const tt = travelTotals(t);
  diemRows(put, t.diem, { label: 'B', unit: 'I', count: 'M', amount: 'O' }, '出張日当');
  diemRows(put, t.lodge, { label: 'S', unit: 'Z', count: 'AD', amount: 'AF' }, '宿泊日当');
  put('O30', { f: 'SUM(O26:R29)', v: tt.diem }); put('AF30', { f: 'SUM(AF26:AI29)', v: tt.lodge });
  for (let i = 0; i < MAX_LINES; i++) {
    const r = 33 + i, l = t.lines[i];
    put(`B${r}`, l ? dateCell(l.date) : null); put(`F${r}`, l?.kind || null); put(`L${r}`, l?.memo || null); put(`AF${r}`, l ? l.amount : null);
  }
  put('AE50', { f: 'O30+AF30', v: tt.allowance });
  put('AE51', { f: 'SUM(AF33:AI48)', v: tt.lines });
  put('AE52', t.advance || null);
  put('AE53', { f: 'AE50+AE51-AE52', v: tt.net });
  return { kind: 'travel', name: '旅費精算', cells };
}

/** Excel に書くシート（中身がなくても月の見出しは入れる） */
export function reportSheets(ym: string, month: ExpenseMonth | null, items: ExpenseItem[], travel: Travel | null): SheetCells[] {
  return [expenseCells(month, items, ym), ...(travel && travelHasContent(travel) ? [travelCells(travel)] : [])];
}

/** 支給月の名前：10月分（11月10日支給）→ 2611給与報告フォーム.xlsx、フォルダ 261110支給分 */
export function formNames(ym: string, payDay: number) {
  const [y, m] = ym.split('-').map(Number);
  const py = m === 12 ? y + 1 : y, pm = m === 12 ? 1 : m + 1;
  const yymm = `${String(py).slice(2)}${String(pm).padStart(2, '0')}`;
  return { yymm, file: `${yymm}給与報告フォーム.xlsx`, folder: `${yymm}${String(payDay).padStart(2, '0')}支給分`, payYm: `${py}-${String(pm).padStart(2, '0')}` };
}
