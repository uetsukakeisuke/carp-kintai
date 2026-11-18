'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { selfAddShiftAction, selfChangeShiftAction, selfDeleteShiftAction, markNoticesSeenAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { call, timedOut } from '@/lib/call';

const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const dl = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${m}/${dd}(${WD[new Date(y, m - 1, dd).getDay()]})`; };
type R = { ok: true; message?: string } | { ok: false; error: string };

function useRun() {
  const [pending, start] = useTransition();
  const [toast] = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<R>, after?: () => void) => start(async () => {
    const r = await call(fn);
    toast(r.ok ? r.message ?? '完了しました' : r.error);
    if (r.ok) after?.();
    if (!timedOut(r)) router.refresh();
  });
  return [pending, run] as const;
}

/** 開いたら「見た」にする（シフト表のタブの数字を消す） */
export function SeenMarker({ unseen }: { unseen: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!unseen) return;
    const t = setTimeout(() => { void call(markNoticesSeenAction).then(() => router.refresh()); }, 1500);
    return () => clearTimeout(t);
  }, [unseen, router]);
  return null;
}

export type NoticeView = { id: number; slotId: number | null; date: string; start: number; end: number; label: string; open: number | null; mine: boolean; isNew: boolean };
/** 「空きが出ました」のお知らせ */
export function Notices({ items, myDates }: { items: NoticeView[]; myDates: string[] }) {
  const [pending, run] = useRun();
  if (!items.length) return null;
  return (
    <div className="card notices">
      <div className="row" style={{ marginBottom: 6 }}><b>空きが出ました</b><span className="sub">早い者勝ちです</span></div>
      {items.map((n) => {
        const iWork = myDates.includes(n.date);
        return (
          <div key={n.id} className={`nt-row${n.isNew ? ' new' : ''}`}>
            <div className="nt-main">
              <b>{dl(n.date)}</b> <span className="num">{hm(n.start)}〜{hm(n.end)}</span>{n.label && <span className="nchip">{n.label}</span>}
              {n.isNew && <span className="nt-new">NEW</span>}
            </div>
            <div className="nt-act">
              {n.open === null ? <span className="sub">枠がなくなりました</span>
                : n.open <= 0 ? <span className="sub">埋まりました</span>
                : n.mine ? <span className="sub">あなたが空けた枠（空き{n.open}人）</span>
                : iWork ? <span className="sub">空き{n.open}人・この日は出勤予定あり</span>
                : <><span className="ok-t sub">空き{n.open}人</span><button className="btn primary" disabled={pending} onClick={() => run(() => selfAddShiftAction(n.slotId!))}>入る</button></>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type SlotView = { id: number; start: number; end: number; label: string; capacity: number; filled: number; meIn: boolean };
/** 選んだ日の枠（人数と空き）。空きがあり、その日に出勤予定がなければ入れる */
export function DaySlots({ slots, canAdd, past }: { slots: SlotView[]; canAdd: boolean; past: boolean }) {
  const [pending, run] = useRun();
  if (!slots.length) return null;
  return (
    <div className="dslots">
      <div className="sub" style={{ marginBottom: 4 }}>この日の枠</div>
      {slots.map((s) => {
        const open = s.capacity - s.filled;
        return (
          <div key={s.id} className={`dslot${open <= 0 ? ' full' : ''}${s.meIn ? ' me' : ''}`}>
            <span className="dslot-n">{s.label && <b>{s.label}</b>} <span className="num">{hm(s.start)}〜{hm(s.end)}</span></span>
            <span className="num dslot-c">{s.filled}/{s.capacity}人</span>
            {s.meIn ? <span className="sub">入っています</span>
              : open <= 0 ? <span className="sub">満員</span>
              : past ? <span className="sub">空き{open}人</span>
              : canAdd ? <button className="btn primary" disabled={pending} onClick={() => run(() => selfAddShiftAction(s.id))}>入る（空き{open}人）</button>
              : <span className="sub">空き{open}人</span>}
          </div>
        );
      })}
    </div>
  );
}

const STEPS: number[] = []; for (let x = 300; x <= 1740; x += 15) STEPS.push(x);
/** 自分のシフト1日分：変更（午前 → 午後の向きだけ）・やめる */
export function MyShiftEdit({ date, start, end, label }: { date: string; start: number; end: number; label: string }) {
  const [mode, setMode] = useState<'none' | 'change' | 'delete'>('none');
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [pending, run] = useRun();
  const close = () => setMode('none');
  if (mode === 'none') return (
    <div className="mse-btns">
      <button className="btn" onClick={() => { setS(start); setE(end); setMode('change'); }}>変更</button>
      <button className="btn ghost" onClick={() => setMode('delete')}>やめる</button>
    </div>
  );
  if (mode === 'delete') return (
    <div className="mse-box">
      <p style={{ margin: 0 }}><b>{dl(date)} {label}</b> のシフトをやめますか？</p>
      <p className="sub" style={{ margin: 0 }}>空いた枠は「空きが出ました」として全員にお知らせされます。</p>
      <div className="actions">
        <button className="btn" onClick={close}>戻る</button>
        <button className="btn danger" disabled={pending} onClick={() => run(() => selfDeleteShiftAction(date), close)}>やめる</button>
      </div>
    </div>
  );
  return (
    <div className="mse-box">
      <div className="htimes">
        <select className="sel" aria-label={`${dl(date)} 始まり`} value={s} onChange={(x) => { const v = Number(x.target.value); setS(v); if (e <= v) setE(Math.max(end, v + 60)); }}>
          {STEPS.filter((x) => x >= start).map((x) => <option key={x} value={x}>{hm(x)}</option>)}
        </select>〜
        <select className="sel" aria-label={`${dl(date)} 終わり`} value={e} onChange={(x) => setE(Number(x.target.value))}>
          {STEPS.filter((x) => x >= end && x > s).map((x) => <option key={x} value={x}>{hm(x)}</option>)}
        </select>
      </div>
      <p className="sub" style={{ margin: 0 }}>時間は後ろへ（午前 → 午後）だけ動かせます。新しく入る時間は、空きのある枠の中に限ります。</p>
      <div className="actions">
        <button className="btn" onClick={close}>戻る</button>
        <button className="btn primary" disabled={pending || (s === start && e === end)} onClick={() => run(() => selfChangeShiftAction(date, s, e), close)}>この時間に変える</button>
      </div>
    </div>
  );
}
