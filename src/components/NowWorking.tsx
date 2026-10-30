'use client';
import { useEffect, useState } from 'react';
import type { NowBoard } from '@/lib/data';

const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const REFRESH_MS = 30_000;

/** いま出勤している人。30秒ごと（と画面に戻ったとき）に自動で更新する */
export function NowWorking({ initial, meId }: { initial: NowBoard; meId?: number }) {
  const [b, setB] = useState(initial);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/now', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as NowBoard;
        if (alive) { setB(j); setStale(false); }
      } catch { if (alive) setStale(true); }
    };
    const id = setInterval(load, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, []);
  return (
    <section className="nowcard" aria-live="polite">
      <div className="now-h">
        <b>いま出勤中 <span className="num now-n">{b.working.length}</span>人</b>
        <span className={`sub${stale ? ' warn-t' : ''}`}>{stale ? '更新できません（通信を確認）' : `${b.asOf} 現在・自動で更新`}</span>
      </div>
      {b.working.length ? (
        <ul className="now-list">
          {b.working.map((w) => (
            <li key={w.id} className={`${w.state}${w.id === meId ? ' me' : ''}`}>
              <i className="dot" aria-hidden />
              <b>{w.name}{w.id === meId ? '（自分）' : ''}</b>
              <span className="sub num">{hm(w.since)}〜{w.planEnd ? `（予定 〜${hm(w.planEnd)}）` : ''}</span>
              {w.state === 'break' && <span className="stt s-break">休憩中</span>}
            </li>
          ))}
        </ul>
      ) : <p className="sub" style={{ margin: '6px 0 0' }}>いま出勤している人はいません。</p>}
      {b.upcoming.length > 0 && (
        <div className="now-up">
          <span className="sub">このあと：</span>
          {b.upcoming.map((u) => <span key={u.id} className="nchip"><b>{u.name}</b> <span className="num">{hm(u.start)}〜{hm(u.end)}</span></span>)}
        </div>
      )}
      {b.notYet?.length > 0 && (
        <div className="now-up">
          <span className="sub">予定の時間だが未打刻：</span>
          {b.notYet.map((u) => <span key={u.id} className="nchip"><b>{u.name}</b> <span className="num">{hm(u.start)}〜{hm(u.end)}</span></span>)}
        </div>
      )}
      {b.done > 0 && <p className="sub" style={{ margin: '6px 0 0' }}>今日すでに退勤：{b.done}人</p>}
    </section>
  );
}
