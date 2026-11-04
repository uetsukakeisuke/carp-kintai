// 京都工房の受発注台帳（受発注履歴・取引先一覧）を読み、朝の報告を組み立てる。
// データベースに触れない純粋な関数だけを置く（テストしやすいように）。
//
// 判定のルール（設計書「朝の報告の判定ルール」）
//   客先納期の超過    … 客先納入日を過ぎていて、客先納品が済でない
//   納期が近いのに未入荷 … 客先納入日まで7日以内で、仕入が済でない
//   仕入先の遅れ      … 仕入納期を過ぎていて、仕入が済でない
//   締め日を過ぎた未請求 … 客先納品が済で、客先の締め日を過ぎても請求書発行が済でない
//   未入金のメモ      … 品名に「未入金」とある行
// 外す行
//   仕入先が「在」（在庫から出す）→ 仕入のチェックをしない
//   客先が「在」（在庫にする）  → 客先納期・請求のチェックをしない
//   売上が0円             → 請求のチェックをしない

export type Cell = string | number | boolean | null;

export type OrderRow = {
  line: number;          // スプレッドシートの行番号
  part: string;          // 管理番・部品名
  qty: string;
  supplier: string;
  customer: string;
  amount: number;        // 売上の合計（税抜き）
  custDue: string | null; // 客先納入日 YYYY-MM-DD
  supDue: string | null;  // 仕入納期 YYYY-MM-DD
  received: boolean;     // 仕入 済
  delivered: boolean;    // 客先納品 済
  inspected: boolean;    // 検収明細 済
  invoiced: boolean;     // 客先請求書発行 済
  orderNo: string;
  fromStock: boolean;    // 仕入先が「在」
  toStock: boolean;      // 客先が「在」
};
export type Flag = { row: OrderRow; closing?: string };
export type Issue = { line: number; part: string; what: string };
export type Unpaid = { line: number; label: string; customer: string; amount: number; date: string | null };
export type Report = {
  today: string;
  read: number;          // 読んだ注文の行数
  overdue: Flag[];
  soon: Flag[];
  late: Flag[];
  unbilled: Flag[];
  unpaid: Unpaid[];
  issues: Issue[];
  fallbackColumns: string[]; // 見出しが見つからず、決まった位置で読んだ列
};

export const SOON_DAYS = 7;

// ---------- 文字・数値 ----------
const nfkc = (s: string) => s.normalize('NFKC');
export function text(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^[\s　]+|[\s　]+$/g, '').replace(/[\s　]+/g, ' ');
}
const headKey = (v: Cell | undefined) => nfkc(text(v)).replace(/[\s　]+/g, '');
export function yen(v: Cell | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(nfkc(text(v)).replace(/[¥,\s円]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
const isDone = (v: Cell | undefined) => text(v) === '済';
const ERR = /^#(REF!|N\/A|VALUE!|NAME\?|DIV\/0!|NUM!|ERROR!|NULL!)/;
/** 会社名を比べるための形（空白・会社の種類を取る） */
export function companyKey(s: string): string {
  return nfkc(s).replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)/g, '').replace(/[\s　]+/g, '');
}
/** 報告文で使う短い会社名 */
export function shortName(s: string): string {
  return nfkc(s).replace(/株式会社|有限会社|\(株\)|\(有\)/g, '').replace(/^[\s　]+|[\s　]+$/g, '').replace(/[\s　]+/g, ' ');
}

// ---------- 日付 ----------
const DAY = 86400000;
const ms = (d: string) => Date.parse(d + 'T00:00:00Z');
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
function real(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, m - 1, d), x = new Date(t);
  return x.getUTCMonth() === m - 1 ? iso(t) : null;
}
/** 年が書かれていない日付は、基準（売上月・仕入月、なければ今日）にいちばん近い年とみなす */
function nearest(m: number, d: number, base: string): string | null {
  const by = Number(base.slice(0, 4));
  let best: string | null = null;
  for (const y of [by - 1, by, by + 1]) {
    const c = real(y, m, d);
    if (c && (!best || Math.abs(ms(c) - ms(base)) < Math.abs(ms(best) - ms(base)))) best = c;
  }
  return best;
}
/** 「2026-11」「2026/11/01」などから YYYY-MM。1899年など空欄の数式は null */
export function monthOf(v: Cell | undefined): string | null {
  const m = /^(\d{4})[-/年.](\d{1,2})/.exec(nfkc(text(v)));
  if (!m || Number(m[1]) < 2000) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, '0')}` : null;
}
/**
 * 台帳の日付を YYYY-MM-DD に。空欄は null、読めないものは 'bad'。
 * 「11/10」「9/28」「11月17日」「2026/10/27」「2026-11-10」に対応。
 * 年の書かれた日付でも、売上月（仕入月）から半年以上離れていれば年の入れ違いとみなして直す
 */
export function dateOf(v: Cell | undefined, refMonth: string | null, today: string): string | null | 'bad' {
  const base = refMonth ? `${refMonth}-15` : today;
  if (typeof v === 'number') {
    if (v > 30000 && v < 80000) return iso(Date.UTC(1899, 11, 30) + Math.round(v) * DAY); // スプレッドシートの日付の通し番号
    return 'bad';
  }
  const s = nfkc(text(v));
  if (!s) return null;
  let m = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?/.exec(s);
  if (m) {
    const y = Number(m[1]);
    if (y < 2000) return null;
    const d = real(y, Number(m[2]), Number(m[3]));
    if (!d) return 'bad';
    if (refMonth && Math.abs(ms(d) - ms(base)) > 200 * DAY) return nearest(Number(m[2]), Number(m[3]), base);
    return d;
  }
  m = /^(\d{1,2})[/月.](\d{1,2})日?$/.exec(s);
  if (m) return nearest(Number(m[1]), Number(m[2]), base) ?? 'bad';
  return 'bad';
}
export const addDaysIso = (d: string, n: number) => iso(ms(d) + n * DAY);

// ---------- 締め日 ----------
export type Closing = number | 'end';
/** 「20日締め翌月15日」→ 20、「末締め翌月末」→ 'end'。書いていなければ null */
export function closingOf(terms: string): Closing | null {
  const s = nfkc(terms);
  const m = /(\d{1,2})日\s*締/.exec(s);
  if (m) return Number(m[1]);
  if (/末\s*締/.test(s)) return 'end';
  return null;
}
/** 納入日 d を含む締めの日（その日を過ぎたら請求書を出す） */
export function closingDate(d: string, c: Closing): string {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), day = Number(d.slice(8, 10));
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (c === 'end') return real(y, m, last(y, m))!;
  if (day <= c) return real(y, m, Math.min(c, last(y, m)))!;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return real(ny, nm, Math.min(c, last(ny, nm)))!;
}
export function termsMap(rows: Cell[][]): Map<string, Closing | null> {
  const map = new Map<string, Closing | null>();
  for (const r of rows) {
    const name = text(r[0]), t = text(r[1]);
    if (!name || name === '会社名' || name === '仕入れ先') continue;
    if (!map.has(companyKey(name)) || t) map.set(companyKey(name), t ? closingOf(t) : null);
  }
  return map;
}

// ---------- 列 ----------
// 見出しの名前で列を探す。見つからなければ、今の台帳の列の位置で読む
const COLS = {
  part: { find: (h: string) => h.includes('部品名') || h.includes('管理番'), at: 1, label: '管理番/部品名' },
  qty: { find: (h: string) => h === '個数', at: 2, label: '個数' },
  supplier: { find: (h: string) => h === '仕入先', at: 12, label: '仕入先' },
  customer: { find: (h: string) => h === '客先', at: 18, label: '客先' },
  custDue: { find: (h: string) => h === '客先納入日', at: 23, label: '客先納入日' },
  supDue: { find: (h: string) => h === '仕入納期', at: 24, label: '仕入納期' },
  received: { find: (h: string) => h === '仕入', at: 25, label: '仕入' },
  delivered: { find: (h: string) => h === '客先納品', at: 26, label: '客先納品' },
  inspected: { find: (h: string) => h === '検収明細', at: 27, label: '検収明細' },
  invoiced: { find: (h: string) => h.includes('請求書') && h.includes('発行'), at: 28, label: '客先請求書発行' },
  orderNo: { find: (h: string) => h.includes('客先注文番号'), at: 29, label: '客先注文番号' },
  salesMonth: { find: (h: string) => h === '売上月', at: 31, label: '売上月' },
  supMonth: { find: (h: string) => h === '仕入月', at: 32, label: '仕入月' },
} as const;
type ColKey = keyof typeof COLS | 'amount';

function headerRow(rows: Cell[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const h = rows[i].map(headKey);
    if (h.includes('客先') && h.includes('仕入先')) return i;
  }
  return 0;
}
function columns(head: Cell[]): { at: Record<ColKey, number>; fallback: string[] } {
  const h = head.map(headKey), fallback: string[] = [];
  const at = {} as Record<ColKey, number>;
  for (const [k, c] of Object.entries(COLS) as [keyof typeof COLS, (typeof COLS)[keyof typeof COLS]][]) {
    const i = h.findIndex((x) => c.find(x));
    if (i < 0) fallback.push(c.label);
    at[k] = i < 0 ? c.at : i;
  }
  // 売上の「合計」は「売単価」のすぐ後ろにある（仕入の「合計」と区別する）
  const unit = h.indexOf('売単価');
  const sum = unit >= 0 ? h.findIndex((x, i) => i > unit && x === '合計') : -1;
  if (sum < 0) fallback.push('合計（売上）');
  at.amount = sum < 0 ? 15 : sum;
  return { at, fallback };
}

// ---------- 組み立て ----------
export function buildReport(orders: Cell[][], terms: Cell[][], today: string): Report {
  const r: Report = { today, read: 0, overdue: [], soon: [], late: [], unbilled: [], unpaid: [], issues: [], fallbackColumns: [] };
  if (!orders.length) return r;
  const hi = headerRow(orders);
  const { at, fallback } = columns(orders[hi]);
  r.fallbackColumns = fallback;
  const closing = termsMap(terms);
  const soonEnd = addDaysIso(today, SOON_DAYS);
  const noTerms = new Map<string, number[]>();

  for (let i = hi + 1; i < orders.length; i++) {
    const c = orders[i] ?? [];
    const get = (k: ColKey) => c[at[k]];
    const part = text(get('part'));
    if (!part) continue;
    const line = i + 1;
    const supplier = text(get('supplier')), customer = text(get('customer'));
    const amount = yen(get('amount'));

    if (part.includes('未入金')) {
      if (amount > 0) {
        const d = dateOf(get('custDue'), monthOf(get('salesMonth')), today);
        r.unpaid.push({ line, label: part, customer, amount, date: d === 'bad' ? null : d });
      }
      continue;
    }
    r.read++;

    const errCell = (['part', 'supplier', 'customer', 'amount', 'custDue', 'supDue', 'received', 'delivered', 'invoiced'] as ColKey[])
      .map((k) => text(get(k))).find((v) => ERR.test(v));
    if (errCell) r.issues.push({ line, part, what: `数式のエラー（${errCell}）` });

    const cd = dateOf(get('custDue'), monthOf(get('salesMonth')), today);
    const sd = dateOf(get('supDue'), monthOf(get('supMonth')), today);
    if (cd === 'bad') r.issues.push({ line, part, what: `客先納入日が読めません（${text(get('custDue'))}）` });
    if (sd === 'bad') r.issues.push({ line, part, what: `仕入納期が読めません（${text(get('supDue'))}）` });

    const row: OrderRow = {
      line, part, qty: text(get('qty')), supplier, customer, amount,
      custDue: cd === 'bad' ? null : cd, supDue: sd === 'bad' ? null : sd,
      received: isDone(get('received')), delivered: isDone(get('delivered')),
      inspected: isDone(get('inspected')), invoiced: isDone(get('invoiced')),
      orderNo: text(get('orderNo')), fromStock: supplier === '在', toStock: customer === '在',
    };

    if (!row.fromStock && !supplier && !row.received) r.issues.push({ line, part, what: '仕入先が空欄です' });

    if (!row.toStock && row.custDue && !row.delivered) {
      if (row.custDue < today) r.overdue.push({ row });
      else if (!row.received && !row.fromStock && row.custDue <= soonEnd) r.soon.push({ row });
    }
    if (!row.fromStock && row.supDue && !row.received && row.supDue < today) r.late.push({ row });

    if (!row.toStock && amount > 0 && row.delivered && !row.invoiced && row.custDue) {
      const key = companyKey(customer), cl = closing.get(key);
      if (cl === undefined || cl === null) noTerms.set(customer, [...(noTerms.get(customer) ?? []), line]);
      else {
        const cdate = closingDate(row.custDue, cl);
        if (cdate < today) r.unbilled.push({ row, closing: cdate });
      }
    }
  }
  for (const [name, lines] of noTerms) {
    r.issues.push({ line: lines[0], part: name || '（客先が空欄）', what: `取引先一覧に締め日がないため、請求の確認ができません（${lines.length}行）` });
  }
  const byDue = (k: 'custDue' | 'supDue') => (a: Flag, b: Flag) => (a.row[k] ?? '').localeCompare(b.row[k] ?? '') || a.row.line - b.row.line;
  r.overdue.sort(byDue('custDue'));
  r.soon.sort(byDue('custDue'));
  r.late.sort(byDue('supDue'));
  r.unbilled.sort((a, b) => (a.closing ?? '').localeCompare(b.closing ?? '') || a.row.line - b.row.line);
  r.issues.sort((a, b) => a.line - b.line);
  return r;
}

// ---------- LINE で届く文面 ----------
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const mdw = (d: string) => `${md(d)}(${WD[new Date(ms(d)).getUTCDay()]})`;
const money = (n: number) => Math.round(n).toLocaleString('ja-JP') + '円';

/** 同じ客先・同じ品番が並ぶときは1行にまとめる */
function group(flags: Flag[], key: (f: Flag) => string) {
  const out: { first: Flag; n: number }[] = [];
  for (const f of flags) {
    const g = out.find((x) => key(x.first) === key(f));
    if (g) g.n++; else out.push({ first: f, n: 1 });
  }
  return out;
}
export function reportText(r: Report): string {
  const L: string[] = [`おはようございます。${mdw(r.today)}の京都工房です。`];
  const none = !r.overdue.length && !r.soon.length && !r.late.length && !r.unbilled.length && !r.unpaid.length;
  if (none) L.push('', '期限を過ぎているもの・急ぐものはありません。');

  if (r.overdue.length) {
    L.push('', `■ 客先納期を過ぎているもの ${r.overdue.length}件`);
    for (const g of group(r.overdue, (f) => `${f.row.customer}|${f.row.part}`)) {
      const x = g.first.row;
      L.push(`・${shortName(x.customer)} ${x.part}（${md(x.custDue!)}・${x.received || x.fromStock ? '入荷済み' : '未入荷'}）${g.n > 1 ? `×${g.n}` : ''}`);
    }
  }
  if (r.soon.length) {
    L.push('', `■ 納期が近いのに未入荷 ${r.soon.length}件`);
    for (const g of group(r.soon, (f) => `${f.row.customer}|${f.row.custDue}`)) {
      const x = g.first.row;
      const parts = r.soon.filter((f) => f.row.customer === x.customer && f.row.custDue === x.custDue).map((f) => f.row.part);
      L.push(`・${shortName(x.customer)} ${parts.join('／')}（客先納期${md(x.custDue!)}）`);
    }
  }
  if (r.late.length) {
    L.push('', `■ 仕入先の遅れ ${r.late.length}件`);
    for (const g of group(r.late, (f) => f.row.supplier).sort((a, b) => b.n - a.n)) {
      L.push(`・${shortName(g.first.row.supplier)} ${g.n}件`);
    }
  }
  if (r.unbilled.length) {
    L.push('', `■ 締め日を過ぎて未請求 ${r.unbilled.length}件`);
    for (const g of group(r.unbilled, (f) => `${f.row.customer}|${f.closing}`)) {
      const sum = r.unbilled.filter((f) => f.row.customer === g.first.row.customer && f.closing === g.first.closing).reduce((a, f) => a + f.row.amount, 0);
      L.push(`・${shortName(g.first.row.customer)} ${g.n}件 ${money(sum)}（締め日${md(g.first.closing!)}）`);
    }
  }
  if (r.unpaid.length) {
    L.push('', '■ 未入金のメモ');
    for (const u of r.unpaid) L.push(`・${shortName(u.customer)} ${money(u.amount)}（${u.label}）`);
  }
  if (r.issues.length) L.push('', `台帳の確認が${r.issues.length}件あります。`);
  return L.join('\n');
}
