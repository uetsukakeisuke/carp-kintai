'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestCorrectionAction } from '@/app/actions';
import type { PunchKind } from '@/lib/calc';
import { PUNCH_LABEL } from '@/components/PunchLog';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';

const TIMES: number[] = []; for (let x = 300; x <= 1740; x += 5) TIMES.push(x);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const KINDS: PunchKind[] = ['in', 'break_start', 'break_end', 'out'];
const r5 = (x: number) => Math.min(1740, Math.max(300, Math.round(x / 5) * 5));

/** 出勤・休憩開始・休憩終了・退勤を1回の申請でまとめて直す。直す打刻にチェックを入れて時刻を選ぶ */
export function CorrectionForm({ date, current, suggested, planStart, planEnd }: {
  date: string; current: { kind: PunchKind; minute: number | null }[]; suggested: PunchKind | PunchKind[]; planStart: number | null; planEnd: number | null;
}) {
  const cur = (k: PunchKind) => current.find((c) => c.kind === k)?.minute ?? null;
  // 今の記録がなければ、シフトの時間から見当をつける（休憩はシフトの真ん中あたり）
  const guess = (k: PunchKind) => {
    const c = cur(k);
    if (c !== null) return r5(c);
    const s = planStart ?? 600, e = planEnd ?? s + 480, mid = s + Math.floor((e - s) / 2);
    return r5(k === 'in' ? s : k === 'out' ? e : k === 'break_start' ? mid - 30 : mid + 30);
  };
  const init = () => Object.fromEntries(KINDS.map((k) => [k, { on: false, minute: guess(k) }])) as Record<PunchKind, { on: boolean; minute: number }>;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(init);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  const set = (k: PunchKind, v: Partial<{ on: boolean; minute: number }>) => { setErr(''); setRows((x) => ({ ...x, [k]: { ...x[k], ...v } })); };
  const begin = () => { const r = init(); for (const k of [suggested].flat()) r[k].on = true; setRows(r); setErr(''); setOpen(true); };

  const picked = KINDS.filter((k) => rows[k].on);
  // 直したあとの時刻（チェックしていない打刻は今の記録）で順番を確かめる
  const after = KINDS.map((k) => ({ k, m: rows[k].on ? rows[k].minute : cur(k) })).filter((x): x is { k: PunchKind; m: number } => x.m !== null);
  let bad = '';
  for (let i = 1; i < after.length; i++) if (after[i].m <= after[i - 1].m) { bad = `${PUNCH_LABEL[after[i].k]}は${PUNCH_LABEL[after[i - 1].k]}（${hm(after[i - 1].m)}）より後の時刻にしてください`; break; }
  // 休憩の開始と終了が片方だけになるとき（止めはしない。今まさに休憩中のこともあるため）
  const hasK = (k: PunchKind) => after.some((x) => x.k === k);
  const half = !bad && (rows.break_start.on || rows.break_end.on) && hasK('break_start') !== hasK('break_end')
    ? `${hasK('break_start') ? '休憩終了' : '休憩開始'}の記録がありません。必要ならチェックを入れてください` : '';
  const same = picked.filter((k) => cur(k) === rows[k].minute);

  if (!open) return <div><button className="btn" style={{ width: '100%' }} onClick={begin}>打刻の修正を申請（出勤・休憩・退勤をまとめて）</button>{node}</div>;
  return (
    <div className="card cr-card">
      <div className="cr-head">
        <p className="sub" style={{ margin: 0 }}>直す打刻にチェックを入れて、正しい時刻を選んでください。出勤・休憩・退勤をまとめて1回で申請できます。</p>
        <button type="button" className="btn ghost" onClick={() => { const all = picked.length < KINDS.length; setErr(''); setRows((x) => Object.fromEntries(KINDS.map((k) => [k, { ...x[k], on: all }])) as typeof x); }}>
          {picked.length < KINDS.length ? '4つすべて直す' : 'チェックを外す'}
        </button>
      </div>
      <div className="cr-rows" role="group" aria-label="直す打刻">
        {KINDS.map((k) => {
          const c = cur(k), on = rows[k].on;
          return (
            <div key={k} className={`cr-row${on ? ' on' : ''}`}>
              <label className="cr-k" htmlFor={`cc-${k}`}>
                <input id={`cc-${k}`} type="checkbox" checked={on} onChange={(e) => set(k, { on: e.target.checked })} />
                <b>{PUNCH_LABEL[k]}</b>
              </label>
              <span className="sub cr-now">今の記録 <span className="num">{c === null ? 'なし' : hm(c)}</span></span>
              <select id={`cm-${k}`} className="sel" aria-label={`${PUNCH_LABEL[k]}の正しい時刻`} value={rows[k].minute} disabled={!on}
                onChange={(e) => set(k, { minute: Number(e.target.value) })}>
                {TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <div className="formgrid">
        <label htmlFor="cr">理由</label>
        <input id="cr" className="in" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="出勤と退勤を押し忘れました" maxLength={200} />
      </div>
      {bad && <p className="err">{bad}</p>}
      {half && <p className="sub" style={{ margin: 0 }}>{half}</p>}
      {!bad && same.length > 0 && <p className="sub" style={{ margin: 0 }}>{same.map((k) => PUNCH_LABEL[k]).join('・')}は今の記録と同じ時刻です。</p>}
      {err && <p className="err">{err}</p>}
      <div className="actions">
        <button className="btn" style={{ flex: 1 }} onClick={() => setOpen(false)}>やめる</button>
        <button className="btn primary" style={{ flex: 2 }} disabled={pending || !picked.length || !!bad} onClick={() => {
          if (!reason.trim()) { setErr('理由を入力してください'); return; }
          start(async () => {
            const r = await call(() => requestCorrectionAction(date, picked.map((k) => ({ kind: k, minute: rows[k].minute })), reason));
            if (!r.ok) { setErr(r.error); return; }
            setOpen(false); setReason(''); toast(r.message ?? '申請しました'); router.refresh();
          });
        }}>{picked.length > 1 ? `${picked.length}件まとめて申請する` : '申請する'}</button>
      </div>
      {node}
    </div>
  );
}
