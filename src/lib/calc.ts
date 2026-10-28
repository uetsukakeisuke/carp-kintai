// 勤怠・人件費の計算ロジック（画面・給与報告・テストで共通）
// 時刻はすべて「勤務日の 0:00 からの分」。日付をまたぐ勤務は 1440 以上。

export type PunchKind = 'in' | 'break_start' | 'break_end' | 'out';
export interface Punch { kind: PunchKind; minute: number }
export interface WageRate { effective_from: string; hourly: number }
export interface MinWage { effective_from: string; hourly: number }

export const NIGHT_START = 22 * 60; // 22:00
export const NIGHT_END = 29 * 60;   // 翌 5:00
export const DAILY_LIMIT = 8 * 60;  // 1日8時間

export function overlap(a: number, b: number, c: number, d: number): number {
  return Math.max(0, Math.min(b, d) - Math.max(a, c));
}

/** 休憩の自動控除（シフト予定の計算用）：6時間超で45分、8時間超で60分 */
export function autoBreak(duration: number): number {
  return duration > 480 ? 60 : duration > 360 ? 45 : 0;
}

/** 次に押せる打刻（退勤後はもう一度出勤できる） */
export const NEXT: Record<PunchKind | 'none', PunchKind[]> = {
  none: ['in'],
  in: ['break_start', 'out'],
  break_end: ['break_start', 'out'],
  break_start: ['break_end'],
  out: ['in'],
};
export function lastKind(punches: Punch[]): PunchKind | 'none' {
  const s = [...punches].sort((a, b) => a.minute - b.minute);
  return s.length ? s[s.length - 1].kind : 'none';
}
export function canPunch(punches: Punch[], kind: PunchKind): boolean {
  return NEXT[lastKind(punches)].includes(kind);
}

export interface Segment { start: number; end: number; breakMin: number; breaks: [number, number][]; live: boolean }
export type DayState = 'none' | 'before' | 'working' | 'break' | 'done' | 'missing' | 'absent';

export interface DaySummary {
  segments: Segment[];
  workMin: number;     // 実働（全区間の合計、休憩を除く）
  breakMin: number;
  nightMin: number;    // 22:00〜翌5:00 の実働
  regularMin: number;  // 1日8時間までの実働
  overtimeMin: number; // 1日8時間を超えた実働
  state: DayState;
  firstIn: number | null;
  lastOut: number | null; // 最後の打刻が退勤のときだけ
  complete: boolean;      // 出勤があり、最後が退勤で閉じている
}

/**
 * 1日の打刻から実働を求める。出勤〜退勤を1区間とし、間違えて退勤→再出勤しても全区間を合計する。
 * @param now 今日の場合の現在時刻（分）。未退勤の区間は now までを勤務中として数える。過去日は null。
 */
export function summarizeDay(
  punches: Punch[],
  opts: { now?: number | null; plan?: { start: number; end: number } | null; isPast?: boolean } = {},
): DaySummary {
  const list = [...punches].sort((a, b) => a.minute - b.minute);
  const segments: Segment[] = [];
  let cur: Segment | null = null;
  let breakOpen: number | null = null;
  for (const p of list) {
    if (p.kind === 'in') {
      if (!cur) cur = { start: p.minute, end: p.minute, breakMin: 0, breaks: [], live: false };
    } else if (p.kind === 'break_start') {
      if (cur && breakOpen === null) breakOpen = p.minute;
    } else if (p.kind === 'break_end') {
      if (cur && breakOpen !== null) { cur.breakMin += p.minute - breakOpen; cur.breaks.push([breakOpen, p.minute]); breakOpen = null; }
    } else if (p.kind === 'out') {
      if (cur) {
        if (breakOpen !== null) { cur.breakMin += p.minute - breakOpen; cur.breaks.push([breakOpen, p.minute]); breakOpen = null; }
        cur.end = p.minute;
        segments.push(cur);
        cur = null;
      }
    }
  }
  const onBreak = !!cur && breakOpen !== null;
  const now = opts.now ?? null;
  if (cur && now !== null && !opts.isPast) {
    if (breakOpen !== null) { cur.breakMin += Math.max(0, now - breakOpen); cur.breaks.push([breakOpen, Math.max(breakOpen, now)]); }
    cur.end = Math.max(cur.start, now);
    cur.live = true;
    segments.push(cur);
  }
  const workMin = segments.reduce((a, s) => a + Math.max(0, s.end - s.start - s.breakMin), 0);
  const breakMin = segments.reduce((a, s) => a + s.breakMin, 0);
  // 深夜（22:00〜翌5:00）の実働：区間の深夜帯から、深夜帯に取った休憩を差し引く
  const nightMin = segments.reduce(
    (a, s) => a + overlap(s.start, s.end, NIGHT_START, NIGHT_END) - s.breaks.reduce((b, [x, y]) => b + overlap(x, y, NIGHT_START, NIGHT_END), 0),
    0,
  );
  const firstInP = list.find((p) => p.kind === 'in') ?? null;
  const last = list.length ? list[list.length - 1] : null;
  const closed = !!last && last.kind === 'out' && !!firstInP;

  let state: DayState = 'none';
  if (firstInP) state = closed ? 'done' : onBreak ? 'break' : opts.isPast ? 'missing' : 'working';
  else if (opts.plan) state = opts.isPast || (now !== null && now > opts.plan.start + 30) ? 'absent' : 'before';

  return {
    segments,
    workMin,
    breakMin,
    nightMin,
    regularMin: Math.min(workMin, DAILY_LIMIT),
    overtimeMin: Math.max(0, workMin - DAILY_LIMIT),
    state,
    firstIn: firstInP ? firstInP.minute : null,
    lastOut: closed ? last!.minute : null,
    complete: closed,
  };
}

/** 指定日に適用される時給 */
export function wageAt(rates: WageRate[], date: string): number | null {
  let w: number | null = null;
  for (const r of [...rates].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    if (r.effective_from <= date) w = r.hourly;
  }
  if (w === null && rates.length) {
    // 適用開始日より前の日付は最初の時給を使う（入社前のデータなど）
    w = [...rates].sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0].hourly;
  }
  return w;
}
export function minWageAt(list: MinWage[], date: string): number {
  let w = 0;
  for (const m of [...list].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) if (m.effective_from <= date) w = m.hourly;
  return w;
}

/** 給与報告フォームと同じ丸めで人件費を計算（基本給・時間外・深夜・交通費） */
export function laborCost(p: { regularMin: number; overtimeMin: number; nightMin: number; hourly: number; transport: number }) {
  const base = Math.round((p.regularMin / 60) * p.hourly);
  const overtime = Math.round(Math.round(p.hourly * 1.25 * 1000) / 1000 * (p.overtimeMin / 60));
  const night = Math.round(p.hourly * 0.25 * (p.nightMin / 60));
  const total = base + overtime + night + p.transport;
  return { base, overtime, night, transport: p.transport, total };
}

/** シフト予定 1 件の人件費（休憩を自動控除） */
export function planCost(shift: { start: number; end: number }, hourly: number, transport: number) {
  const dur = shift.end - shift.start;
  const work = Math.max(0, dur - autoBreak(dur));
  return {
    workMin: work,
    breakMin: autoBreak(dur),
    ...laborCost({
      regularMin: Math.min(work, DAILY_LIMIT),
      overtimeMin: Math.max(0, work - DAILY_LIMIT),
      nightMin: overlap(shift.start, shift.end, NIGHT_START, NIGHT_END),
      hourly,
      transport,
    }),
  };
}

export interface ReportRow {
  store: string; name: string; employment: string; days: number;
  regularMin: number; overtimeMin: number; hourly: number; nightPay: number;
  commuteMeans: string | null; transport: number;
}

/**
 * 給与報告フォームの1行を作る。月の途中で時給が変わった人は時給ごとに行を分ける。
 * 退勤で閉じていない日は含めず、warnings に入れる。
 */
export function buildReportRows(input: {
  staff: { id: number; name: string; store: string; employment: string; transport: number; commuteMeans: string | null; rates: WageRate[] }[];
  days: { staffId: number; date: string; punches: Punch[] }[];
}): { rows: ReportRow[]; warnings: { staffId: number; name: string; date: string }[] } {
  const rows: ReportRow[] = [];
  const warnings: { staffId: number; name: string; date: string }[] = [];
  for (const st of input.staff) {
    const groups = new Map<number, { days: number; reg: number; ot: number; night: number }>();
    for (const d of input.days.filter((x) => x.staffId === st.id).sort((a, b) => a.date.localeCompare(b.date))) {
      if (!d.punches.some((p) => p.kind === 'in')) continue;
      const s = summarizeDay(d.punches, { isPast: true });
      if (!s.complete) { warnings.push({ staffId: st.id, name: st.name, date: d.date }); continue; }
      const w = wageAt(st.rates, d.date);
      if (w === null) { warnings.push({ staffId: st.id, name: st.name, date: d.date }); continue; }
      const g = groups.get(w) ?? { days: 0, reg: 0, ot: 0, night: 0 };
      g.days++; g.reg += s.regularMin; g.ot += s.overtimeMin; g.night += s.nightMin;
      groups.set(w, g);
    }
    let first = true;
    for (const [hourly, g] of groups) {
      rows.push({
        store: st.store, name: st.name, employment: st.employment, days: g.days,
        regularMin: g.reg, overtimeMin: g.ot, hourly,
        nightPay: Math.round(hourly * 0.25 * (g.night / 60)),
        commuteMeans: first && st.transport ? st.commuteMeans ?? '電車' : null,
        transport: first ? st.transport : 0,
      });
      first = false;
    }
  }
  return { rows, warnings };
}

/** フォームの計算式と同じ総支給額（確認表示用） */
export function reportGross(r: ReportRow): number {
  const h = Math.floor(r.regularMin / 60), m = r.regularMin % 60;
  const oh = Math.floor(r.overtimeMin / 60), om = r.overtimeMin % 60;
  const base = Math.round((h + m / 60) * r.hourly);
  const ot = Math.round(Math.round(r.hourly * 1.25 * 1000) / 1000 * (oh + om / 60));
  return base + ot + r.nightPay + r.transport * r.days;
}

/**
 * 打刻の勤務日を決める（深夜営業向け）。
 * 5:00 より前で、前日の勤務がまだ退勤していなければ「前日の続き」として前日の 24時以降（例：1:30 → 25:30）にする。
 */
export function decideWorkDay(now: { date: string; minute: number }, prevDate: string, prevLast: PunchKind | 'none', boundary = 5 * 60): { date: string; minute: number } {
  if (now.minute < boundary && prevLast !== 'none' && prevLast !== 'out') return { date: prevDate, minute: now.minute + 1440 };
  return now;
}
