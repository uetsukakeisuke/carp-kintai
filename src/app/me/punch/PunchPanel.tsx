'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { punchAction } from '@/app/actions';
import type { PunchKind } from '@/lib/calc';
import { useToast } from '@/components/Toast';
import { PunchButtons } from '@/components/PunchButtons';
import { Clock } from '@/components/Clock';

export function PunchPanel({ allowed, reClockIn }: { allowed: PunchKind[]; reClockIn: boolean; serverNow: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, toastNode] = useToast();
  const [confirm, setConfirm] = useState<PunchKind | null>(null);

  // 画面を開いたままにしても状態がずれないよう、復帰時に最新化する
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [router]);

  const doPunch = (k: PunchKind) => start(async () => {
    const r = await punchAction(k);
    setConfirm(null);
    toast(r.ok ? r.message ?? '記録しました' : r.error);
    router.refresh();
  });

  return (
    <>
      <Clock />
      <PunchButtons allowed={allowed} reClockIn={reClockIn} disabled={pending} onPunch={(k) => (k === 'out' ? setConfirm(k) : doPunch(k))} />
      {confirm && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setConfirm(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cfm">
            <h3 id="cfm">退勤しますか？</h3>
            <p className="meta">間違えて押した場合も、あとで「もう一度出勤」できます。</p>
            <div className="actions">
              <button className="btn" onClick={() => setConfirm(null)}>やめる</button>
              <button className="btn primary" onClick={() => doPunch('out')} disabled={pending}>退勤する</button>
            </div>
          </div>
        </div>
      )}
      {toastNode}
    </>
  );
}
