// アクトヴィジョンの「給与支給明細書」PDF を読み取る。
// 1ページ＝1人。表の見出し（勤怠・支給・控除・単価）の位置で4列に分け、
// 各行を「項目名（列の左半分）」と「値（右半分）」に分ける。
import { getDocumentProxy } from 'unpdf';

export type SlipValue = number | string; // 数値、または "27:00" のような時間
export interface ParsedSlip {
  page: number;
  code: string | null; // 明細書の従業員コード（例 129）
  name: string; // 空白を除いた氏名（例 小舩愛賀）
  period: string | null; // 例 "8年9月分(令和08年10月09日支給)"
  workYear: number | null; workMonth: number | null; // 何月分か（西暦）
  payDate: string | null; // 支給日 YYYY-MM-DD
  attendance: Record<string, SlipValue>; // 勤怠
  pay: Record<string, SlipValue>; // 支給
  deduction: Record<string, SlipValue>; // 控除
  unit: Record<string, SlipValue>; // 単価・合計
}

type Item = { s: string; x: number; y: number };

function toValue(raw: string): SlipValue | null {
  const s = raw.replace(/[,，\s]/g, '');
  if (/^-?\d+:\d{2}$/.test(s)) return s;
  if (/^-?\d+(\.\d+)?$/.test(s)) return s.includes('.') ? Number(s) : parseInt(s, 10);
  return null;
}

/** 行ごとにまとめる（y の差が小さいものを同じ行に） */
function lines(items: Item[], tol = 2.5): Item[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Item[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= tol) last.push(it);
    else out.push([it]);
  }
  return out.map((l) => l.sort((a, b) => a.x - b.x));
}

const REIWA = 2018; // 令和n年 = 2018 + n

export async function parsePayslipPdf(data: Uint8Array): Promise<ParsedSlip[]> {
  const pdf = await getDocumentProxy(data);
  const result: ParsedSlip[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const h = page.getViewport({ scale: 1 }).height;
    const tc = await page.getTextContent();
    const items: Item[] = (tc.items as { str?: string; transform?: number[] }[])
      .filter((i) => typeof i.str === 'string' && i.str.trim() !== '' && i.transform)
      .map((i) => ({ s: i.str!, x: i.transform![4], y: h - i.transform![5] }));

    // 見出し（勤・支・控・単）が無いページは明細ではない（一覧表など）
    const hdr = (c: string) => items.find((i) => i.s.trim() === c);
    const k = hdr('勤'), sh = hdr('支'), ko = hdr('控'), ta = hdr('単');
    if (!k || !sh || !ko || !ta) continue;
    const top = Math.min(k.y, sh.y, ko.y, ta.y);
    const xs = [k.x, sh.x, ko.x, ta.x].map((x) => x - 24).sort((a, b) => a - b);
    const cols: [keyof Pick<ParsedSlip, 'attendance' | 'pay' | 'deduction' | 'unit'>, number, number][] = [
      ['attendance', xs[0], xs[1]], ['pay', xs[1], xs[2]], ['deduction', xs[2], xs[3]], ['unit', xs[3], 10_000],
    ];
    const slip: ParsedSlip = { page: p, code: null, name: '', period: null, workYear: null, workMonth: null, payDate: null, attendance: {}, pay: {}, deduction: {}, unit: {} };
    for (const ln of lines(items.filter((i) => i.y > top + 8))) {
      for (const [col, x0, x1] of cols) {
        const cw = ln.filter((i) => i.x >= x0 && i.x < x1);
        if (!cw.length) continue;
        const mid = x0 + (x1 === 10_000 ? 595 - x0 : x1 - x0) / 2;
        const label = cw.filter((i) => i.x < mid).map((i) => i.s).join('').replace(/\s/g, '');
        const v = toValue(cw.filter((i) => i.x >= mid).map((i) => i.s).join(''));
        if (label && v !== null) slip[col][label] = v;
      }
    }
    // 氏名とコード、対象月・支給日（見出しより上の行から）
    const head = lines(items.filter((i) => i.y <= top + 2)).map((l) => l.map((i) => i.s).join('').replace(/[\s　]/g, ''));
    for (const t of head) {
      const m = t.match(/^(?:氏名)?(\d{3})([^\d殿]{2,12})(?:殿)?$/);
      if (m && !slip.code) { slip.code = m[1]; slip.name = m[2]; }
      const per = t.match(/(\d+)年(\d+)月分\(令和(\d+)年(\d+)月(\d+)日支給\)/);
      if (per) {
        slip.period = per[0];
        slip.workYear = REIWA + Number(per[1]); slip.workMonth = Number(per[2]);
        slip.payDate = `${REIWA + Number(per[3])}-${per[4].padStart(2, '0')}-${per[5].padStart(2, '0')}`;
      }
    }
    if (!slip.name) {
      const m = head.map((t) => t.match(/^(.{2,12})殿$/)).find(Boolean);
      if (m) slip.name = m[1];
    }
    if (slip.name) result.push(slip);
  }
  return result;
}

/** 名前の照合用：空白を除き、よくある異体字・表記ゆれをそろえる */
export function normName(s: string) {
  return s.replace(/[\s　]/g, '').replace(/凜/g, '凛').replace(/[ヶヵケ]/g, 'ケ').replace(/髙/g, '高').replace(/﨑/g, '崎');
}

/** 差引支給額など、明細の主要な数字を取り出す */
export function slipTotals(s: Pick<ParsedSlip, 'pay' | 'deduction' | 'unit'>) {
  const n = (v: SlipValue | undefined) => (typeof v === 'number' ? v : 0);
  return {
    gross: n(s.pay['総支給額']) || n(s.pay['実総支給額']),
    deduction: n(s.deduction['総控除額']),
    net: n(s.unit['差引支給額']) || n(s.unit['現金支給額']),
  };
}
