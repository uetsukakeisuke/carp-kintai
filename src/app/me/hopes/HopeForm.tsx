'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveHopesAction } from '@/app/actions';
import { useToast } from '@/components/Toast';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const TIMES: number[] = []; for (let x = 360; x <= 1740; x += 30) TIMES.push(x);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const KEY = 'kintai-hope-last';

export function HopeForm({ year, month, initial, submitted }: { year: number; month: number; initial: { date: string; start: number; end: number }[]; submitted: boolean }) {
  const nd = new Date(year, month, 0).getDate();
  const [hopes, setHopes] = useState<Record<string, { start: number; end: number }>>(() => Object.fromEntries(initial.map((h) => [h.date, { start: h.start, end: h.end }])));
  const [last, setLast] = useState({ start: 600, end: 1020 });
  const [dirty, setDirty] = useState(false);
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
  const list = Object.entries(hopes);
  const total = list.reduce((a, [, v]) => a + (v.end - v.start), 0);
  const bad = list.find(([, v]) => v.end <= v.start);

  const save = (submit: boolean) => start(async () => {
    const r = await saveHopesAction(year, month, list.map(([date, v]) => ({ date, start: v.start, end: v.end })), submit);
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
            <div key={k} className={`hrow${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}${v ? ' on' : ''}`}>
              <div className="dt"><b>{month}/{d}</b><small>{WD[w]}曜日</small></div>
              {v ? (
                <div className="htimes">
                  <select className="sel" aria-label={`${d}日 開始`} value={v.start} onChange={(e) => { const n = { ...v, start: Number(e.target.value) }; set(k, n); remember(n); }}>
                    {TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}
                  </select>〜
                  <select className="sel" aria-label={`${d}日 終了`} value={v.end} onChange={(e) => { const n = { ...v, end: Number(e.target.value) }; set(k, n); remember(n); }}>
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
        <button className="btn primary" style={{ flex: '1 1 auto', fontSize: 15 }} disabled={pending || !!bad} onClick={() => save(true)}>{submitted ? '修正を提出する' : '希望を提出する'}</button>
        {dirty && <button className="btn" disabled={pending} onClick={() => save(false)}>下書き保存</button>}
        <span className="sub">出勤希望 {list.length}日 ・ 合計 {(total / 60).toFixed(1)}時間</span>
      </div>
      {node}
    </>
  );
}
