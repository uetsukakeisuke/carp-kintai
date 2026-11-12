// 作業量の予測と、シフトの下書きの自動作成。データベースに触れない純粋な関数だけを置く。
//
// 予測：受発注台帳の各行から、入荷の日（仕入納期）と出荷の日（客先納入日の前）に作業が発生するとみなし、
//   作業時間（分）＝ 1件あたり ＋ √個数 × 係数 ＋ 重さ(kg) × 係数   を日ごとに足す。
//   個数は√にして「多いほど1個あたりは速くなる」ようにしている（7000個の注文が何十時間にならないように）。
//   営業日には「毎日の決まった作業」を足す。
// 学習：台帳の「仕入」「客先納品」が済になった日（＝その作業をした日）と、その日に実際に働いた時間から、
//   係数を少しずつ実績に合わせる（仮の値に引き寄せながら合わせるので、データが少ないうちは仮の値に近い）。
// 下書き：シフト希望の時間どおりに、予測の作業時間と最低人数を満たすまで人を入れる。日の人件費予算を守り、
//   特定の人に偏らないよう「希望した時間に対して入った時間の割合」が低い人から選ぶ。
import type { OrderRow } from './kobo';

export type Coef = { base: number; inLine: number; inSqrt: number; inKg: number; outLine: number; outSqrt: number; outKg: number };
export type ForecastParams = { coef: Coef; shipLead: number; workdays: number[]; minPeople: number; learn: boolean };
export const COEF_KEYS: (keyof Coef)[] = ['base', 'inLine', 'inSqrt', 'inKg', 'outLine', 'outSqrt', 'outKg'];
export const DEFAULT_PARAMS: ForecastParams = {
  coef: { base: 0, inLine: 10, inSqrt: 2, inKg: 0.5, outLine: 15, outSqrt: 2, outKg: 0.5 },
  shipLead: 1, workdays: [1, 2, 3, 4, 5], minPeople: 1, learn: true,
};
export const MIN_LEARN_DAYS = 10; // 学習した値を使い始める日数

/** 保存されていた設定を、足りない所は既定値で補って読む */
export function readParams(v: unknown): ForecastParams {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ForecastParams> & { coef?: Partial<Coef> };
  const num = (x: unknown, d: number, lo = 0, hi = 10000) => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : d);
  const coef = Object.fromEntries(COEF_KEYS.map((k) => [k, num(o.coef?.[k], DEFAULT_PARAMS.coef[k])])) as Coef;
  const wd = Array.isArray(o.workdays) ? [...new Set(o.workdays.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : DEFAULT_PARAMS.workdays;
  return { coef, shipLead: Math.round(num(o.shipLead, 1, 0, 14)), workdays: wd, minPeople: Math.round(num(o.minPeople, 1, 0, 30)), learn: o.learn !== false };
}

// ---------- 日付 ----------
const DAY = 86400000;
const ms = (d: string) => Date.parse(d + 'T00:00:00Z');
export const shift = (d: string, n: number) => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
export const weekdayOf = (d: string) => new Date(ms(d)).getUTCDay();

// ---------- 作業量 ----------
export type Load = { inLines: number; inSqrt: number; inKg: number; outLines: number; outSqrt: number; outKg: number };
export type LoadItem = { kind: 'in' | 'out'; part: string; customer: string; supplier: string; due: string; qty: number; qtyText: string; kg: number; line: number; late: boolean };
export type DayLoad = Load & { date: string; items: LoadItem[] };
const emptyLoad = (date: string): DayLoad => ({ date, inLines: 0, inSqrt: 0, inKg: 0, outLines: 0, outSqrt: 0, outKg: 0, items: [] });
export function addTo(l: Load, kind: 'in' | 'out', qty: number, kg: number) {
  if (kind === 'in') { l.inLines++; l.inSqrt += Math.sqrt(qty); l.inKg += kg; } else { l.outLines++; l.outSqrt += Math.sqrt(qty); l.outKg += kg; }
}

/**
 * これからの作業を日ごとに並べる。まだ入荷していない行は仕入納期の日に「入荷」、まだ納品していない行は
 * 客先納入日の shipLead 日前に「出荷」。すでに日が過ぎているものは今日に寄せる（遅れて届く・急いで出す）
 */
export function dayLoads(rows: OrderRow[], today: string, shipLead: number, opts: { keepEmpty?: boolean } = {}): Map<string, DayLoad> {
  const m = new Map<string, DayLoad>();
  const put = (date: string, it: LoadItem, empty: boolean) => {
    const d = m.get(date) ?? emptyLoad(date);
    if (!empty) addTo(d, it.kind, it.qty, it.kg);
    d.items.push(it); m.set(date, d);
  };
  for (const r of rows) {
    // 個数も重さも読めない行は作業量の予測に使わない（keepEmpty のときは一覧にだけ出す）
    const empty = r.qtyN <= 0 && r.kg <= 0;
    if (empty && !opts.keepEmpty) continue;
    if (!r.fromStock && !r.received && r.supDue) {
      const late = r.supDue < today;
      put(late ? today : r.supDue, { kind: 'in', part: r.part, customer: r.customer, supplier: r.supplier, due: r.supDue, qty: r.qtyN, qtyText: r.qty, kg: r.kg, line: r.line, late }, empty);
    }
    if (!r.toStock && !r.delivered && r.custDue) {
      const d = shift(r.custDue, -shipLead), late = d < today;
      put(late ? today : d, { kind: 'out', part: r.part, customer: r.customer, supplier: r.supplier, due: r.custDue, qty: r.qtyN, qtyText: r.qty, kg: r.kg, line: r.line, late }, empty);
    }
  }
  return m;
}

/** 予測の作業時間（分） */
export function predictMin(l: Load | undefined, c: Coef, workday: boolean): number {
  const x = l ?? { inLines: 0, inSqrt: 0, inKg: 0, outLines: 0, outSqrt: 0, outKg: 0 };
  const v = (workday ? c.base : 0) + x.inLines * c.inLine + x.inSqrt * c.inSqrt + x.inKg * c.inKg + x.outLines * c.outLine + x.outSqrt * c.outSqrt + x.outKg * c.outKg;
  return Math.max(0, Math.round(v));
}

// ---------- 学習 ----------
export type Sample = { date: string; actualMin: number; workday: boolean; load: Load };
const featuresOf = (s: Sample) => [s.workday ? 1 : 0, s.load.inLines, s.load.inSqrt, s.load.inKg, s.load.outLines, s.load.outSqrt, s.load.outKg];

/** 連立方程式 A x = b（ガウスの消去法） */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * 実績に合わせた係数。仮の値（prior）を「5日分の実績」と同じ重みで持たせて引き寄せる（リッジ回帰）。
 * 負の値にはしない。mae＝1日あたりの予測のずれ（分）
 */
export function fit(samples: Sample[], prior: Coef, priorDays = 5): { coef: Coef; n: number; mae: number; maePrior: number } {
  const p = COEF_KEYS.map((k) => prior[k]);
  const n = samples.length;
  const X = samples.map(featuresOf), y = samples.map((s) => s.actualMin);
  const err = (c: number[]) => (n ? samples.reduce((a, _, i) => a + Math.abs(X[i].reduce((t, x, j) => t + x * c[j], 0) - y[i]), 0) / n : 0);
  if (n < 2) return { coef: { ...prior }, n, mae: err(p), maePrior: err(p) };
  const k = p.length;
  const A = Array.from({ length: k }, () => Array(k).fill(0)), b = Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { b[a] += X[i][a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += X[i][a] * X[i][c]; }
  for (let j = 0; j < k; j++) {
    // 「毎日の決まった作業」(j=0) はほとんど縛らない（実績の平均に素直に合わせる）。ほかは仮の値に引き寄せる
    const ms2 = X.reduce((t, x) => t + x[j] * x[j], 0) / n;
    const lam = (j === 0 ? 0.05 : priorDays) * (ms2 > 0 ? ms2 : 1);
    A[j][j] += lam; b[j] += lam * p[j];
  }
  let beta = solve(A, b) ?? p;
  // 負になった係数は0にして、残りでもう一度
  for (let round = 0; round < k && beta.some((v) => v < 0); round++) {
    const neg = beta.map((v) => v < 0);
    const A2 = A.map((r, i) => r.map((v, j) => (neg[i] || neg[j] ? (i === j ? 1 : 0) : v)));
    const b2 = b.map((v, i) => (neg[i] ? 0 : v));
    beta = (solve(A2, b2) ?? beta).map((v, i) => (neg[i] ? 0 : v));
  }
  beta = beta.map((v) => Math.max(0, Math.round(v * 100) / 100));
  return { coef: Object.fromEntries(COEF_KEYS.map((key, i) => [key, beta[i]])) as Coef, n, mae: err(beta), maePrior: err(p) };
}

// ---------- 下書き ----------
export type Window = { staffId: number; date: string; s: number; e: number };
export type DraftDay = { date: string; needMin: number; minPeople: number; workMin: number; people: number; cost: number; budget: number; added: number; short: boolean; over: boolean };
export type DraftInput = {
  dates: string[];
  need: Record<string, { min: number; people: number }>;
  hopes: Window[];
  existing: Window[];
  cost: (staffId: number, date: string, s: number, e: number) => { workMin: number; total: number };
  budget: (date: string) => number; // 0＝予算なし
  eligible: Set<number>;
};
export function planDraft(x: DraftInput): { add: Window[]; days: DraftDay[] } {
  const has = new Set(x.existing.map((w) => `${w.staffId}|${w.date}`));
  const hopeMin = new Map<number, number>(), got = new Map<number, number>();
  for (const h of x.hopes) if (x.eligible.has(h.staffId)) hopeMin.set(h.staffId, (hopeMin.get(h.staffId) ?? 0) + x.cost(h.staffId, h.date, h.s, h.e).workMin);
  for (const w of x.existing) got.set(w.staffId, (got.get(w.staffId) ?? 0) + x.cost(w.staffId, w.date, w.s, w.e).workMin);

  const state = new Map(x.dates.map((d) => {
    const ex = x.existing.filter((w) => w.date === d);
    return [d, {
      workMin: ex.reduce((a, w) => a + x.cost(w.staffId, d, w.s, w.e).workMin, 0),
      people: ex.length, cost: ex.reduce((a, w) => a + x.cost(w.staffId, d, w.s, w.e).total, 0), added: 0,
    }];
  }));
  const cands = (d: string) => x.hopes.filter((h) => h.date === d && x.eligible.has(h.staffId) && !has.has(`${h.staffId}|${d}`));
  // 人が足りなくなりやすい日（希望できる時間に対して必要な時間が多い日）から先に決める
  const tight = (d: string) => {
    const n = x.need[d] ?? { min: 0, people: 0 };
    const avail = cands(d).reduce((a, h) => a + x.cost(h.staffId, d, h.s, h.e).workMin, 0);
    return (n.min + n.people * 240) / Math.max(avail, 1);
  };
  const order = [...x.dates].filter((d) => (x.need[d]?.min ?? 0) > 0 || (x.need[d]?.people ?? 0) > 0).sort((a, b) => tight(b) - tight(a) || a.localeCompare(b));
  const add: Window[] = [];
  for (const d of order) {
    const n = x.need[d], st = state.get(d)!, bud = x.budget(d);
    const pool = cands(d);
    while ((st.workMin < n.min || st.people < n.people) && pool.length) {
      // 予算に収まる人のうち、入った割合が低い人。人数が最低に届かないときは予算を超えてでも入れる
      const ranked = pool.map((h) => ({ h, c: x.cost(h.staffId, d, h.s, h.e) }))
        .map((o) => ({ ...o, share: ((got.get(o.h.staffId) ?? 0) + o.c.workMin) / Math.max(hopeMin.get(o.h.staffId) ?? 1, 1) }))
        .sort((a, b) => a.share - b.share || b.c.workMin - a.c.workMin || a.h.staffId - b.h.staffId);
      const fits = ranked.find((o) => !bud || st.cost + o.c.total <= bud);
      const pick = fits ?? (st.people < n.people ? ranked[0] : undefined);
      if (!pick) break;
      pool.splice(pool.indexOf(pick.h), 1);
      add.push(pick.h); has.add(`${pick.h.staffId}|${d}`);
      st.workMin += pick.c.workMin; st.people++; st.cost += pick.c.total; st.added++;
      got.set(pick.h.staffId, (got.get(pick.h.staffId) ?? 0) + pick.c.workMin);
    }
  }
  const days = x.dates.map((d) => {
    const n = x.need[d] ?? { min: 0, people: 0 }, st = state.get(d)!, bud = x.budget(d);
    return { date: d, needMin: n.min, minPeople: n.people, workMin: st.workMin, people: st.people, cost: st.cost, budget: bud, added: st.added,
      short: st.workMin < n.min || st.people < n.people, over: bud > 0 && st.cost > bud };
  });
  return { add: add.sort((a, b) => a.date.localeCompare(b.date) || a.staffId - b.staffId), days };
}
