'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveHopesAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const TIMES: number[] = []; for (let x = 360; x <= 1740; x += 30) TIMES.push(x);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const KEY = 'kintai-hope-last';

export function HopeForm({ year, month, initial, submitted }: { year: number; month: number; initial: { date: string; start: number; end: number }[]; submitted: boolean }) {
  const nd = new Date(year, month, 0).getDate();
  const [hopes, setHopes] = useState<Record<string, { start: number; end: number }>>(() => Object.fromEntries(initial.map((h) => [h.date, { start: h.start, end: h.end }])));
  const [last, setLast] = useState({ start: 600, end: 1020 });
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
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v?.start) setLast(v); } catch {} }, []);
  const remember = (v: { start: number; end: number }) => { setLast(v); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };
  const set = (date: string, v: { start: number; end: number } | null) => {
    setDirty(true);
    setHopes((h) => { const n = { ...h }; if (v) n[date] = v; else delete n[date]; return n; });
  };
  const key = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const MIN_T = TIMES[0], MAX_T = TIMES[TIMES.length - 1];
  /** 開始を変えたら、終了が開始より前にならないよう同じ長さだけずらす（終了を変えたときも同様） */
  const fixStart = (v: { start: number; end: number }, start: number) => {
    if (start < v.end) return { start, end: v.end };
    const len = Math.max(60, v.end - v.start);
    return { start: Math.min(start, MAX_T - 30), end: Math.min(start + len, MAX_T) };
  };
  const fixEnd = (v: { start: number; end: number }, end: number) => {
    if (end > v.start) return { start: v.start, end };
    const len = Math.max(60, v.end - v.start);
    return { start: Math.max(end - len, MIN_T), end: Math.max(end, MIN_T + 30) };
  };
  const list = Object.entries(hopes);
  const total = list.reduce((a, [, v]) => a + (v.end - v.start), 0);
  const bad = list.find(([, v]) => v.end <= v.start);

  const save = (submit: boolean) => {
    if (bad) {
      // どの日を直せばよいか知らせて、その日まで移動する
      toast(`${Number(bad[0].slice(5, 7))}/${Number(bad[0].slice(8, 10))} の時間を直してください（終了を開始より後に）`);
      document.getElementById(`hr-${bad[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    doSave(submit);
  };
  const doSave = (submit: boolean) => start(async () => {
    const r = await call(() => saveHopesAction(year, month, list.map(([date, v]) => ({ date, start: v.start, end: v.end })), submit));
    toast(r.ok ? r.message ?? '保存しました' : r.error);
    if (r.ok) { setDirty(false); router.refresh(); }
  });

  return (
    <>
      <div className="card" style={{ marginBottom: 12, display: 'grid', gap: 8 }}>
        <b>まとめて入力</b>
        <button className="btn" onClick={() => { for (let d = 1; d <= nd; d++) { const w = new Date(year, month - 1, d).getDay(); if (w > 0 && w < 6) set(key(d), last); } }}>平日すべてに {hm(last.start)}〜{hm(last.end)}</button>
        <button className="btn" onClick={() => { setHopes({}); setDirty(true); }}>すべて消す</button>
      </div>
      <div className="hope-list">
        {Array.from({ length: nd }, (_, i) => i + 1).map((d) => {
          const k = key(d), v = hopes[k], w = new Date(year, month - 1, d).getDay();
          return (
            <div key={k} id={`hr-${k}`} className={`hrow${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}${v ? ' on' : ''}`}>
              <div className="dt"><b>{month}/{d}</b><small>{WD[w]}曜日</small></div>
              {v ? (
                <div className="htimes">
                  <select className="sel" aria-label={`${d}日 開始`} value={v.start} onChange={(e) => { const n = fixStart(v, Number(e.target.value)); set(k, n); remember(n); }}>
                    {TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}
                  </select>〜
                  <select className="sel" aria-label={`${d}日 終了`} value={v.end} onChange={(e) => { const n = fixEnd(v, Number(e.target.value)); set(k, n); remember(n); }}>
                    {TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}
                  </select>
                  <button className="btn ghost" onClick={() => set(k, null)}>消す</button>
                  {v.end <= v.start && <span className="err">終了を開始より後に</span>}
                </div>
              ) : <div><button className="addbtn" onClick={() => set(k, last)}>＋ 時間を入れる</button></div>}
            </div>
          );
        })}
      </div>
      <div className="submitbar">
        <button className="btn primary" style={{ flex: '1 1 auto', fontSize: 15 }} disabled={pending} onClick={() => save(true)}>{submitted ? '修正を提出する' : '希望を提出する'}</button>
        {dirty && <button className="btn" disabled={pending} onClick={() => save(false)}>下書き保存</button>}
        <span className="sub">出勤希望 {list.length}日 ・ 合計 {(total / 60).toFixed(1)}時間{pending ? ' ・ 保存中…' : dirty ? ' ・ まだ保存していない変更があります' : ''}</span>
        <span className="sub" style={{ flexBasis: '100%' }}>時間を入れていない日は「休み（出勤しない日）」として提出されます。</span>
        {bad && <span className="err" style={{ flexBasis: '100%' }}>{Number(bad[0].slice(5, 7))}/{Number(bad[0].slice(8, 10))} の時間が逆になっています。直すと提出できます。</span>}
      </div>
      {node}
    </>
  );
}
