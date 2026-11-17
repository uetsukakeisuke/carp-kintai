'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveHopesAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';
import { PERIODS, periodParts, periodsOf, periodsLabel } from '@/lib/periods';
import type { Part } from '@/lib/shift-parts';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const TIMES: number[] = []; for (let x = 360; x <= 1740; x += 30) TIMES.push(x);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const KEY = 'kintai-hope-last';

/** 1日の希望。periods があれば「授業のコマ」で選んだ日（間の時間は入らない）、なければ開始〜終了 */
type Hope = { start: number; end: number; periods: number[] | null };
const fromPeriods = (ns: number[]): Hope => {
  const ps = periodParts(ns);
  return ps.length ? { start: ps[0][0], end: ps[ps.length - 1][1], periods: [...ns].sort((a, b) => a - b) } : { start: PERIODS[0].s, end: PERIODS[0].e, periods: [] };
};
const minutes = (v: Hope) => (v.periods ? periodParts(v.periods).reduce((a, [s, e]) => a + e - s, 0) : v.end - v.start);
const label = (v: Hope) => (v.periods ? (v.periods.length ? periodsLabel(v.periods) : 'コマ未選択') : `${hm(v.start)}〜${hm(v.end)}`);
const isBad = (v: Hope) => (v.periods ? v.periods.length === 0 : v.end <= v.start);

export function HopeForm({ year, month, initial, submitted }: { year: number; month: number; initial: { date: string; start: number; end: number; parts: Part[] | null }[]; submitted: boolean }) {
  const nd = new Date(year, month, 0).getDate();
  const [hopes, setHopes] = useState<Record<string, Hope>>(() => Object.fromEntries(initial.map((h) => [h.date, { start: h.start, end: h.end, periods: periodsOf(h.parts) }])));
  const [last, setLast] = useState<Hope>({ start: 600, end: 1020, periods: null }); // 最後に入れた時間
  const [lastP, setLastP] = useState<number[]>([1, 2]); // 最後に選んだコマ
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v?.start) setLast({ start: v.start, end: v.end, periods: null });
      if (Array.isArray(v?.lastP) && v.lastP.length) setLastP(v.lastP);
    } catch {}
  }, []);
  const remember = (v: Hope) => {
    if (isBad(v)) return;
    const t = v.periods ? last : { start: v.start, end: v.end, periods: null };
    const p = v.periods ?? lastP;
    setLast(t); setLastP(p);
    try { localStorage.setItem(KEY, JSON.stringify({ start: t.start, end: t.end, lastP: p })); } catch {}
  };
  const set = (date: string, v: Hope | null) => {
    setDirty(true);
    setHopes((h) => { const n = { ...h }; if (v) n[date] = v; else delete n[date]; return n; });
  };
  const key = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const MIN_T = TIMES[0], MAX_T = TIMES[TIMES.length - 1];
  /** 開始を変えたら、終了が開始より前にならないよう同じ長さだけずらす（終了を変えたときも同様） */
  const fixStart = (v: Hope, start: number): Hope => {
    if (start < v.end) return { start, end: v.end, periods: null };
    const len = Math.max(60, v.end - v.start);
    return { start: Math.min(start, MAX_T - 30), end: Math.min(start + len, MAX_T), periods: null };
  };
  const fixEnd = (v: Hope, end: number): Hope => {
    if (end > v.start) return { start: v.start, end, periods: null };
    const len = Math.max(60, v.end - v.start);
    return { start: Math.max(end - len, MIN_T), end: Math.max(end, MIN_T + 30), periods: null };
  };
  /** 時間 → コマ：その時間に入るコマを選ぶ（ひとつもなければ前回のコマ） */
  const toPeriods = (v: Hope): Hope => {
    const inside = PERIODS.filter((p) => p.s >= v.start && p.e <= v.end).map((p) => p.n);
    return fromPeriods(inside.length ? inside : lastP);
  };
  /** コマ → 時間：最初のコマの始まり〜最後のコマの終わり */
  const toTimes = (v: Hope): Hope => ({ start: v.start, end: v.end > v.start ? v.end : v.start + 60, periods: null });

  const list = Object.entries(hopes);
  const total = list.reduce((a, [, v]) => a + minutes(v), 0);
  const bad = list.find(([, v]) => isBad(v));

  const save = (submit: boolean) => {
    if (bad) {
      // どの日を直せばよいか知らせて、その日まで移動する
      toast(`${Number(bad[0].slice(5, 7))}/${Number(bad[0].slice(8, 10))} を直してください（${bad[1].periods ? 'コマを1つ以上選ぶ' : '終了を開始より後に'}）`);
      document.getElementById(`hr-${bad[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    doSave(submit);
  };
  const doSave = (submit: boolean) => start(async () => {
    const r = await call(() => saveHopesAction(year, month, list.map(([date, v]) => ({ date, start: v.start, end: v.end, parts: v.periods ? periodParts(v.periods) : null })), submit));
    toast(r.ok ? r.message ?? '保存しました' : r.error);
    if (r.ok) { setDirty(false); router.refresh(); }
  });
  const weekdays = (v: Hope) => { for (let d = 1; d <= nd; d++) { const w = new Date(year, month - 1, d).getDay(); if (w > 0 && w < 6) set(key(d), v); } };

  return (
    <>
      <div className="card" style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
        <b>まとめて入力</b>
        <button className="btn" onClick={() => weekdays(last)}>平日すべてに {label(last)}</button>
        <button className="btn" onClick={() => { setHopes({}); setDirty(true); }}>すべて消す</button>
      </div>
      <p className="sub" style={{ margin: '0 0 8px' }}>
        「コマで選ぶ」は、授業の空いているコマ（1限 8:45〜10:15 ／ 2限 10:30〜12:00 ／ 3限 13:15〜14:45 ／ 4限 15:00〜16:30 ／ 5限 16:45〜18:15）を押して選びます。コマとコマの間の時間は勤務に入りません。
      </p>
      <div className="hope-list">
        {Array.from({ length: nd }, (_, i) => i + 1).map((d) => {
          const k = key(d), v = hopes[k], w = new Date(year, month - 1, d).getDay();
          return (
            <div key={k} id={`hr-${k}`} className={`hrow${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}${v ? ' on' : ''}`}>
              <div className="dt"><b>{month}/{d}</b><small>{WD[w]}曜日</small></div>
              {v ? (
                <div className="hbody">
                  <div className="hmode" role="group" aria-label={`${d}日の入れ方`}>
                    <button type="button" aria-pressed={!v.periods} onClick={() => { if (v.periods) { const n = toTimes(v); set(k, n); remember(n); } }}>時間</button>
                    <button type="button" aria-pressed={!!v.periods} onClick={() => { if (!v.periods) { const n = toPeriods(v); set(k, n); remember(n); } }}>授業のコマ</button>
                  </div>
                  {v.periods ? (
                    <div className="hperiods" role="group" aria-label={`${d}日 出勤できるコマ`}>
                      {PERIODS.map((p) => {
                        const on = v.periods!.includes(p.n);
                        return (
                          <button key={p.n} type="button" className="hp-k" aria-pressed={on}
                            onClick={() => { const ns = on ? v.periods!.filter((x) => x !== p.n) : [...v.periods!, p.n]; const n = fromPeriods(ns); set(k, n); remember(n); }}>
                            <b>{p.n}限</b><small className="num">{hm(p.s)}<br />{hm(p.e)}</small>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="htimes">
                      <select className="sel" aria-label={`${d}日 開始`} value={v.start} onChange={(e) => { const n = fixStart(v, Number(e.target.value)); set(k, n); remember(n); }}>
                        {TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}
                      </select>〜
                      <select className="sel" aria-label={`${d}日 終了`} value={v.end} onChange={(e) => { const n = fixEnd(v, Number(e.target.value)); set(k, n); remember(n); }}>
                        {TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="hfoot">
                    {v.periods && v.periods.length > 0 && <span className="sub">{(minutes(v) / 60).toFixed(1)}時間</span>}
                    {isBad(v) && <span className="err">{v.periods ? 'コマを1つ以上選んでください' : '終了を開始より後に'}</span>}
                    <button className="btn ghost hdel" onClick={() => set(k, null)}>消す</button>
                  </div>
                </div>
              ) : (
                <div className="hadd">
                  <button className="addbtn" onClick={() => set(k, last)}>＋ 時間を入れる</button>
                  <button className="addbtn alt" onClick={() => set(k, fromPeriods(lastP))}>＋ コマで選ぶ</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="submitbar">
        <button className="btn primary" style={{ flex: '1 1 auto', fontSize: 15 }} disabled={pending} onClick={() => save(true)}>{submitted ? '修正を提出する' : '希望を提出する'}</button>
        {dirty && <button className="btn" disabled={pending} onClick={() => save(false)}>下書き保存</button>}
        <span className="sub">出勤希望 {list.length}日 ・ 合計 {(total / 60).toFixed(1)}時間{pending ? ' ・ 保存中…' : dirty ? ' ・ まだ保存していない変更があります' : ''}</span>
        <span className="sub" style={{ flexBasis: '100%' }}>時間を入れていない日は「休み（出勤しない日）」として提出されます。</span>
        {bad && <span className="err" style={{ flexBasis: '100%' }}>{Number(bad[0].slice(5, 7))}/{Number(bad[0].slice(8, 10))} を直すと提出できます。</span>}
      </div>
      {node}
    </>
  );
}
