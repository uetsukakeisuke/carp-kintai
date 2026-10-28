'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestCorrectionAction } from '@/app/actions';
import type { PunchKind } from '@/lib/calc';
import { PUNCH_LABEL } from '@/components/PunchLog';
import { useToast } from '@/components/Toast';

const TIMES: number[] = []; for (let x = 300; x <= 1740; x += 5) TIMES.push(x);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;

export function CorrectionForm({ date, current, suggested, planStart, planEnd }: {
  date: string; current: { kind: PunchKind; minute: number | null }[]; suggested: PunchKind; planStart: number | null; planEnd: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PunchKind>(suggested);
  const cur = (k: PunchKind) => current.find((c) => c.kind === k)?.minute ?? null;
  const guess = (k: PunchKind) => cur(k) ?? (k === 'out' ? planEnd : planStart) ?? 600;
  const [minute, setMinute] = useState(Math.round(guess(suggested) / 5) * 5);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  if (!open) return <div style={{ textAlign: 'right' }}><button className="btn" onClick={() => setOpen(true)}>打刻の修正を申請</button>{node}</div>;
  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <div className="formgrid">
        <label htmlFor="ck">修正する打刻</label>
        <select id="ck" className="sel" value={kind} onChange={(e) => { const k = e.target.value as PunchKind; setKind(k); setMinute(Math.round(guess(k) / 5) * 5); }}>
          {(['in', 'break_start', 'break_end', 'out'] as PunchKind[]).map((k) => <option key={k} value={k}>{PUNCH_LABEL[k]}（今の記録：{cur(k) === null ? 'なし' : hm(cur(k)!)}）</option>)}
        </select>
        <label htmlFor="cm">正しい時刻</label>
        <select id="cm" className="sel" value={minute} onChange={(e) => setMinute(Number(e.target.value))}>
          {TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}
        </select>
        <label htmlFor="cr">理由</label>
        <input id="cr" className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="退勤を押し忘れました" maxLength={200} />
      </div>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        <button className="btn" onClick={() => setOpen(false)}>やめる</button>
        <button className="btn primary" disabled={pending} onClick={() => start(async () => {
          const r = await requestCorrectionAction(date, kind, minute, reason);
          if (!r.ok) { setErr(r.error); return; }
          setOpen(false); setReason(''); toast(r.message ?? '申請しました'); router.refresh();
        })}>申請する</button>
      </div>
      {node}
    </div>
  );
}
