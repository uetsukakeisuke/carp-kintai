'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleTaskAction } from '@/app/actions';
import { useToast } from './Toast';
import { call } from '@/lib/call';

// 予定表の1件（画面に渡す形）
export type TaskItem = {
  id: number; staffId: number | null; kind: 'task' | 'note'; title: string; note: string | null; atMin: number | null;
  firstDate: string; date: string; doneAt: string | null; doneBy: string | null; staffName: string | null;
};
const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const doneTime = (iso: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** 1件の表示（チェック・時刻・内容・メモ・済の記録） */
export function TaskLine({ t, canCheck, onToggle, busy, children }: {
  t: TaskItem; canCheck: boolean; onToggle?: (done: boolean) => void; busy?: boolean; children?: React.ReactNode;
}) {
  const done = !!t.doneAt;
  return (
    <li className={`tk${done ? ' done' : ''}${t.kind === 'note' ? ' note' : ''}`}>
      {t.kind === 'task'
        ? <input type="checkbox" className="tk-cb" checked={done} disabled={!canCheck || busy} onChange={(e) => onToggle?.(e.target.checked)}
            aria-label={`${t.title}を${done ? '未に戻す' : '済にする'}`} />
        : <span className="tk-dot" aria-hidden="true">●</span>}
      <div className="tk-body">
        <div className="tk-title">
          {t.atMin !== null && <span className="tk-at num">{hm(t.atMin)}</span>}
          <span className="tk-text">{t.title}</span>
          {t.kind === 'note' && <span className="tk-tag">予定・連絡</span>}
          {t.firstDate < t.date && <span className="tk-tag carry">{md(t.firstDate)}から</span>}
        </div>
        {t.note && <div className="tk-note">{t.note}</div>}
        {done && <div className="tk-done">済{t.doneBy ? ` ${t.doneBy}` : ''} {doneTime(t.doneAt!)}</div>}
      </div>
      {children}
    </li>
  );
}

/** スタッフ向け：全体＋自分の作業。チェックすると済になる。meId を渡すと、ほかの人の作業も名前ごとに（見るだけで）出す */
export function TaskList({ items, canCheck, empty, meId }: { items: TaskItem[]; canCheck: boolean; empty?: string; meId?: number }) {
  const [list, setList] = useState(items);
  useEffect(() => setList(items), [items]);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, node] = useToast();
  const router = useRouter();
  const toggle = (t: TaskItem, done: boolean) => {
    setBusy(t.id);
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, doneAt: done ? new Date().toISOString() : null, doneBy: done ? 'あなた' : null } : x)));
    start(async () => {
      const r = await call(() => toggleTaskAction(t.id, done));
      if (!r.ok) { toast(r.error); setList(items); }
      setBusy(null);
      router.refresh();
    });
  };
  if (!list.length) return empty ? <p className="sub" style={{ margin: 0 }}>{empty}</p> : null;
  const all = list.filter((t) => t.staffId === null);
  const mine = list.filter((t) => t.staffId !== null && (meId === undefined || t.staffId === meId));
  const others = meId === undefined ? [] : list.filter((t) => t.staffId !== null && t.staffId !== meId);
  const who = (t: TaskItem) => t.staffName ?? '（退職した人）';
  const names = [...new Set(others.map(who))];
  return (
    <>
      {all.length > 0 && <><div className="tk-h">全体</div><ul className="tks">{all.map((t) => <TaskLine key={t.id} t={t} canCheck={canCheck} busy={pending && busy === t.id} onToggle={(d) => toggle(t, d)} />)}</ul></>}
      {mine.length > 0 && <><div className="tk-h">あなたの作業</div><ul className="tks">{mine.map((t) => <TaskLine key={t.id} t={t} canCheck={canCheck} busy={pending && busy === t.id} onToggle={(d) => toggle(t, d)} />)}</ul></>}
      {names.map((n) => (
        <div key={n}><div className="tk-h">{n}さんの作業</div><ul className="tks">{others.filter((t) => who(t) === n).map((t) => <TaskLine key={t.id} t={t} canCheck={false} />)}</ul></div>
      ))}
      {node}
    </>
  );
}
