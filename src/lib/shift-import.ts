// シフトのファイル取り込み（スマレジ「シフト表」の Excel・CSV と、1行1シフトの CSV）。
// データベースには触れない（テストしやすいように）。読み取った表（文字の2次元配列）から、人ごと・日ごとの時間帯を作る。
import { mergeParts, sameParts, type Part } from './shift-parts';

export type ImportDay = { date: string; start: number; end: number; parts: Part[] | null };
export type ImportRow = { name: string; days: ImportDay[] };
export type ParsedShifts = { ym: string; format: 'grid' | 'list'; rows: ImportRow[]; warnings: string[] };

const SUMMARY = /^(出勤人数|勤務時間|人件費|合計|計|小計|総計|人数)/;

// ---------- 名前 ----------
/** 名前を比べる形（空白をとる・全角半角・「ヶ/ケ」「髙/高」などの書き分けをそろえる） */
export function nameKey(s: string): string {
  return s.normalize('NFKC').replace(/[\s　・･]/g, '')
    .replace(/[ヶヵ]/g, (c) => (c === 'ヶ' ? 'ケ' : 'カ'))
    .replace(/髙/g, '高').replace(/[﨑嵜]/g, '崎').replace(/[邊邉]/g, '辺').replace(/[齋齊]/g, '斉').replace(/濵/g, '浜').replace(/德/g, '徳')
    .toLowerCase();
}
/** ファイルの名前に合うスタッフ（1人に決まるときだけ） */
export function matchStaff(name: string, staff: { id: number; name: string; kana?: string | null }[]): number | null {
  const k = nameKey(name);
  if (!k) return null;
  const hit = staff.filter((s) => nameKey(s.name) === k || (s.kana ? nameKey(s.kana) === k : false));
  return hit.length === 1 ? hit[0].id : null;
}

// ---------- 日付・時刻 ----------
const pad = (n: number) => String(n).padStart(2, '0');
function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
/** 「2026/12/01」「2026-12-1」「2026年12月1日」、Excel の日付の数（46357 など） */
export function parseDate(v: string): string | null {
  const s = v.normalize('NFKC').trim();
  let m = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?(?:\s*[(（].*[)）])?(?:\s+0{1,2}:0{2}(?::0{2})?)?$/.exec(s);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{5})(?:\.0+)?$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    if (n < 36526 || n > 73050) return null; // 2000年〜2099年
    const t = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return realDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return null;
}
const TIME = String.raw`(翌\s*)?(\d{1,2})\s*[:：時]\s*(\d{2})分?`;
const RANGE = new RegExp(`${TIME}\\s*[~〜～\\-－–—]\\s*${TIME}`, 'g');
/** 「08:45 ~ 10:15」（改行で複数）を時間帯に。読めない文字があれば 'bad' */
export function parseRanges(cell: string): Part[] | 'bad' {
  const s = cell.normalize('NFKC').replace(/\r/g, '');
  if (!s.trim()) return [];
  const out: Part[] = [];
  let rest = s;
  for (const m of s.matchAll(RANGE)) {
    let a = Number(m[2]) * 60 + Number(m[3]) + (m[1] ? 1440 : 0);
    let b = Number(m[5]) * 60 + Number(m[6]) + (m[4] ? 1440 : 0);
    if (Number(m[3]) > 59 || Number(m[6]) > 59) return 'bad';
    if (b <= a) b += 1440; // 日付をまたぐ（22:00 ~ 02:00）
    if (a >= 2880 || b > 2880 || b - a > 1440) return 'bad';
    out.push([a, b]);
    rest = rest.replace(m[0], '');
  }
  // 時間帯以外に意味のありそうな文字が残っていたら読めないものとする（休み・有給などの印は「なし」）
  if (!out.length) return /^[\s\-－ー―休公有欠×✕/／・.、,]*$|^(休み?|公休|有給|有休|欠勤|希望休)$/.test(rest.trim()) ? [] : 'bad';
  return /[0-9]/.test(rest) ? 'bad' : out;
}
const toDay = (date: string, parts: Part[]): ImportDay => {
  const ps = mergeParts(parts);
  return { date, start: ps[0][0], end: ps[ps.length - 1][1], parts: ps.length > 1 ? ps : null };
};

// ---------- 表の読み取り ----------
/** スマレジの「シフト表」（1行目が日付、1列目が名前、マスに時間帯）か、1行1シフトの表（名前・日付・開始・終了） */
export function parseShiftTable(grid: string[][]): ParsedShifts | string {
  const rows = grid.map((r) => r.map((c) => (c ?? '').toString()));
  // 日付が5つ以上並ぶ行を見出しにする
  for (let h = 0; h < Math.min(rows.length, 8); h++) {
    const cols = rows[h].map((c, i) => ({ i, d: parseDate(c) })).filter((x) => x.d) as { i: number; d: string }[];
    if (cols.length >= 5) return fromGrid(rows, h, cols);
  }
  const list = fromList(rows);
  if (list) return list;
  return '表の形が読み取れませんでした。スマレジの「シフト表」を Excel で出力したファイルか、「名前・日付・開始・終了」の列がある CSV を選んでください。';
}

function monthOf(dates: string[]): { ym: string; others: string[] } | string {
  const count = new Map<string, number>();
  for (const d of dates) count.set(d.slice(0, 7), (count.get(d.slice(0, 7)) ?? 0) + 1);
  if (!count.size) return '日付が見つかりませんでした。';
  const ym = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { ym, others: [...count.keys()].filter((k) => k !== ym) };
}

function fromGrid(rows: string[][], h: number, cols: { i: number; d: string }[]): ParsedShifts | string {
  const mo = monthOf(cols.map((c) => c.d));
  if (typeof mo === 'string') return mo;
  const warnings: string[] = [];
  if (mo.others.length) warnings.push(`${mo.ym.replace('-', '年')}月以外の日（${mo.others.join('、')}）の列は取り込みません。`);
  const useCols = cols.filter((c) => c.d.startsWith(mo.ym));
  const nameCol = Math.max(0, useCols[0].i - 1);
  const out: ImportRow[] = [];
  const seen = new Map<string, ImportRow>();
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[nameCol] ?? '').replace(/[\s　]+/g, ' ').trim();
    if (!name || SUMMARY.test(name.normalize('NFKC'))) continue;
    // 名前が数字だけの行・日付の列に数字だけが並ぶ行（出勤人数・勤務時間などの集計）は飛ばす
    if (/^-?\d+(\.\d+)?$/.test(name.normalize('NFKC'))) continue;
    const cells = useCols.map((c) => (row[c.i] ?? '').trim()).filter(Boolean);
    if (cells.length && cells.every((c) => /^-?[\d,]+(\.\d+)?$/.test(c.normalize('NFKC')))) continue;
    const days: ImportDay[] = [];
    for (const c of useCols) {
      const cell = row[c.i] ?? '';
      if (!cell.trim()) continue;
      const ps = parseRanges(cell);
      if (ps === 'bad') { warnings.push(`${name} の ${Number(c.d.slice(5, 7))}/${Number(c.d.slice(8))}「${cell.replace(/\n/g, ' ')}」が読めないため、取り込みません。`); continue; }
      if (!ps.length) continue;
      days.push(toDay(c.d, ps));
    }
    const prev = seen.get(nameKey(name));
    if (prev) { warnings.push(`${name} が2行あります。2行目は取り込みません。`); continue; }
    const rowOut = { name, days };
    seen.set(nameKey(name), rowOut); out.push(rowOut);
  }
  if (!out.length) return '名前の行が見つかりませんでした。';
  return { ym: mo.ym, format: 'grid', rows: out, warnings };
}

function fromList(rows: string[][]): ParsedShifts | string | null {
  const head = rows.findIndex((r) => r.some((c) => /名前|氏名|スタッフ|従業員/.test(c)) && r.some((c) => /日付|勤務日/.test(c)));
  if (head < 0 || head > 5) return null;
  const H = rows[head].map((c) => c.normalize('NFKC').trim());
  const at = (re: RegExp) => H.findIndex((c) => re.test(c));
  const iName = at(/名前|氏名|スタッフ|従業員/), iDate = at(/日付|勤務日/), iStart = at(/開始|出勤|始業/), iEnd = at(/終了|退勤|終業/), iTime = at(/^(時間|時間帯|シフト)$/);
  if (iName < 0 || iDate < 0 || ((iStart < 0 || iEnd < 0) && iTime < 0)) return null;
  const warnings: string[] = [];
  const items: { name: string; date: string; parts: Part[] }[] = [];
  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[iName] ?? '').replace(/[\s　]+/g, ' ').trim();
    if (!name && !(row[iDate] ?? '').trim()) continue;
    const date = parseDate(row[iDate] ?? '');
    const ps = iStart >= 0 && iEnd >= 0 && (row[iStart] ?? '').trim() ? parseRanges(`${row[iStart]} ~ ${row[iEnd]}`) : parseRanges(row[iTime] ?? '');
    if (!name || !date || ps === 'bad' || !ps.length) { warnings.push(`${r + 1}行目が読めないため、取り込みません。`); continue; }
    items.push({ name, date, parts: ps });
  }
  const mo = monthOf(items.map((x) => x.date));
  if (typeof mo === 'string') return mo;
  if (mo.others.length) warnings.push(`${mo.ym.replace('-', '年')}月以外の日（${mo.others.length}件）は取り込みません。1か月分ずつ取り込んでください。`);
  const by = new Map<string, { name: string; days: Map<string, Part[]> }>();
  for (const x of items.filter((x) => x.date.startsWith(mo.ym))) {
    const k = nameKey(x.name);
    const g = by.get(k) ?? { name: x.name, days: new Map() };
    g.days.set(x.date, [...(g.days.get(x.date) ?? []), ...x.parts]);
    by.set(k, g);
  }
  const out = [...by.values()].map((g) => ({ name: g.name, days: [...g.days.entries()].sort().map(([d, ps]) => toDay(d, ps)) }));
  return { ym: mo.ym, format: 'list', rows: out, warnings };
}

// ---------- CSV ----------
/** CSV を2次元配列に（"…" の中の改行・カンマ・"" に対応） */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const sep = (s.split('\n', 1)[0].match(/\t/g)?.length ?? 0) > (s.split('\n', 1)[0].match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/** 文字コードを見分けて読む（UTF-8 で読めなければ Shift_JIS。スマレジや Excel の CSV は Shift_JIS のことが多い） */
export function decodeText(buf: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('shift_jis').decode(buf); }
}

// ---------- 取り込みで下書きがどう変わるか（画面の確認と保存で同じ数え方） ----------
export type ExistingShift = { staffId: number; date: string; start: number; end: number; parts: Part[] | null };
export type ImportEntry = { staffId: number; date: string; start: number; end: number; parts: Part[] | null };
export type ImportCounts = { added: number; changed: number; same: number; removed: number; skipped: number };

/** 取り込みで下書きがどう変わるか（画面の確認と保存で同じ数え方にする） */
export function importDiff(existing: ExistingShift[], entries: ImportEntry[], staffIds: number[], mode: 'replace' | 'fill'): ImportCounts {
  const ex = new Map(existing.filter((e) => staffIds.includes(e.staffId)).map((e) => [`${e.staffId}|${e.date}`, e]));
  const c: ImportCounts = { added: 0, changed: 0, same: 0, removed: 0, skipped: 0 };
  const keys = new Set<string>();
  for (const e of entries) {
    const k = `${e.staffId}|${e.date}`; keys.add(k);
    const o = ex.get(k);
    if (!o) c.added++;
    else if (mode === 'fill') c.skipped++;
    else if (o.start === e.start && o.end === e.end && sameParts(o.parts, e.parts)) c.same++;
    else c.changed++;
  }
  if (mode === 'replace') for (const k of ex.keys()) if (!keys.has(k)) c.removed++;
  return c;
}

