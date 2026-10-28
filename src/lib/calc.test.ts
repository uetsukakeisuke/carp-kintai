import { describe, expect, it } from 'vitest';
import { decideWorkDay, buildReportRows, canPunch, laborCost, minWageAt, planCost, reportGross, summarizeDay, wageAt, type Punch } from './calc';

const P = (kind: Punch['kind'], hm: string): Punch => {
  const [h, m] = hm.split(':').map(Number);
  return { kind, minute: h * 60 + m };
};

describe('summarizeDay', () => {
  it('通常の勤務：休憩を引いた実働', () => {
    const s = summarizeDay([P('in', '9:00'), P('break_start', '12:00'), P('break_end', '12:45'), P('out', '18:00')], { isPast: true });
    expect(s.workMin).toBe(8 * 60 + 15);
    expect(s.breakMin).toBe(45);
    expect(s.regularMin).toBe(480);
    expect(s.overtimeMin).toBe(15);
    expect(s.state).toBe('done');
    expect(s.complete).toBe(true);
  });

  it('間違えて退勤→もう一度出勤：全区間の合計（空き時間は含めない）', () => {
    const s = summarizeDay(
      [P('in', '9:00'), P('out', '10:00'), P('in', '10:10'), P('break_start', '12:00'), P('break_end', '12:45'), P('out', '15:00')],
      { isPast: true },
    );
    expect(s.segments).toHaveLength(2);
    expect(s.workMin).toBe(60 + 245); // 5時間5分
    expect(s.complete).toBe(true);
    expect(s.firstIn).toBe(540);
    expect(s.lastOut).toBe(900);
  });

  it('再出勤のまま退勤していない過去日は「退勤の打刻なし」', () => {
    const s = summarizeDay([P('in', '9:00'), P('out', '10:00'), P('in', '10:10')], { isPast: true });
    expect(s.state).toBe('missing');
    expect(s.complete).toBe(false);
    expect(s.workMin).toBe(60);
  });

  it('今日勤務中は現在時刻までを数える', () => {
    const s = summarizeDay([P('in', '9:00'), P('break_start', '12:00')], { now: 12 * 60 + 30 });
    expect(s.state).toBe('break');
    expect(s.workMin).toBe(180);
  });

  it('深夜：22時以降の実働。深夜帯の休憩は差し引く', () => {
    const s = summarizeDay([P('in', '18:00'), P('break_start', '22:30'), P('break_end', '23:00'), { kind: 'out', minute: 25 * 60 }], { isPast: true });
    expect(s.nightMin).toBe(3 * 60 - 30);
    expect(s.workMin).toBe(7 * 60 - 30);
  });

  it('予定があって打刻がない過去日は未出勤', () => {
    expect(summarizeDay([], { isPast: true, plan: { start: 540, end: 900 } }).state).toBe('absent');
  });
});

describe('canPunch', () => {
  it('退勤後はもう一度出勤できる', () => {
    expect(canPunch([P('in', '9:00'), P('out', '10:00')], 'in')).toBe(true);
    expect(canPunch([P('in', '9:00'), P('out', '10:00')], 'out')).toBe(false);
  });
  it('休憩中は休憩終了だけ', () => {
    const l = [P('in', '9:00'), P('break_start', '12:00')];
    expect(canPunch(l, 'break_end')).toBe(true);
    expect(canPunch(l, 'out')).toBe(false);
    expect(canPunch(l, 'in')).toBe(false);
  });
  it('出勤前は出勤だけ', () => {
    expect(canPunch([], 'in')).toBe(true);
    expect(canPunch([], 'out')).toBe(false);
  });
});

describe('時給・最低賃金', () => {
  const rates = [{ effective_from: '2026-04-01', hourly: 1150 }, { effective_from: '2026-11-16', hourly: 1180 }];
  it('適用開始日で切り替わる', () => {
    expect(wageAt(rates, '2026-11-15')).toBe(1150);
    expect(wageAt(rates, '2026-11-16')).toBe(1180);
    expect(wageAt(rates, '2026-03-01')).toBe(1150);
  });
  it('京都府の最低賃金', () => {
    const mw = [{ effective_from: '2025-11-21', hourly: 1122 }, { effective_from: '2026-11-16', hourly: 1180 }];
    expect(minWageAt(mw, '2026-11-15')).toBe(1122);
    expect(minWageAt(mw, '2026-12-01')).toBe(1180);
  });
});

describe('人件費', () => {
  it('予定シフト：6時間超は45分控除、深夜25%', () => {
    const c = planCost({ start: 18 * 60, end: 23 * 60 }, 1200, 300);
    expect(c.workMin).toBe(300);
    expect(c.base).toBe(6000);
    expect(c.night).toBe(300);
    expect(c.total).toBe(6600);
  });
  it('時間外は給与報告フォームと同じ丸め', () => {
    expect(laborCost({ regularMin: 480, overtimeMin: 30, nightMin: 0, hourly: 1180, transport: 0 }).overtime).toBe(738);
  });
});

describe('給与報告の行', () => {
  const staff = [{ id: 1, name: '佐藤 美咲', store: 'お酒の水族館', employment: 'ﾊﾟｰﾄ', transport: 300, commuteMeans: '電車', rates: [{ effective_from: '2026-01-01', hourly: 1150 }, { effective_from: '2026-11-16', hourly: 1180 }] }];
  it('月の途中で時給が変わると行が分かれ、交通費は最初の行だけ', () => {
    const days = [
      { staffId: 1, date: '2026-11-10', punches: [P('in', '10:00'), P('out', '15:00')] },
      { staffId: 1, date: '2026-11-20', punches: [P('in', '10:00'), P('out', '19:30'), ] },
      { staffId: 1, date: '2026-11-21', punches: [P('in', '10:00')] },
    ];
    const { rows, warnings } = buildReportRows({ staff, days });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ hourly: 1150, days: 1, regularMin: 300, transport: 300, commuteMeans: '電車' });
    expect(rows[1]).toMatchObject({ hourly: 1180, days: 1, regularMin: 480, overtimeMin: 90, transport: 0 });
    expect(warnings).toEqual([{ staffId: 1, name: '佐藤 美咲', date: '2026-11-21' }]);
    expect(reportGross(rows[0])).toBe(5750 + 300);
    expect(reportGross(rows[1])).toBe(9440 + Math.round(1475 * 1.5));
  });
});

describe('深夜営業：日付をまたぐ勤務', () => {
  it('前日 20:00 出勤で未退勤なら、翌 1:30 の退勤は前日の 25:30', () => {
    expect(decideWorkDay({ date: '2026-12-05', minute: 90 }, '2026-12-04', 'in')).toEqual({ date: '2026-12-04', minute: 1530 });
  });
  it('前日に退勤済みなら、早朝の打刻はその日のもの', () => {
    expect(decideWorkDay({ date: '2026-12-05', minute: 270 }, '2026-12-04', 'out')).toEqual({ date: '2026-12-05', minute: 270 });
  });
  it('5:00 以降は常にその日', () => {
    expect(decideWorkDay({ date: '2026-12-05', minute: 310 }, '2026-12-04', 'in')).toEqual({ date: '2026-12-05', minute: 310 });
  });
  it('日付をまたいだ勤務の実働と深夜時間', () => {
    const s = summarizeDay([{ kind: 'in', minute: 20 * 60 }, { kind: 'out', minute: 1530 }], { isPast: true });
    expect(s.workMin).toBe(330);
    expect(s.nightMin).toBe(210);
  });
});
