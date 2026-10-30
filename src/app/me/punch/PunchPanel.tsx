'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { punchAction } from '@/app/actions';
import type { PunchKind } from '@/lib/calc';
import { useToast } from '@/components/Toast';
import { PunchButtons } from '@/components/PunchButtons';
import { PUNCH_LABEL } from '@/components/PunchLog';
import { Clock } from '@/components/Clock';
import { Keypad } from '@/components/Keypad';

export function PunchPanel({ allowed, reClockIn }: { allowed: PunchKind[]; reClockIn: boolean; serverNow: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, toastNode] = useToast();
  const [kind, setKind] = useState<PunchKind | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  // 画面を開いたままにしても状態がずれないよう、復帰時に最新化する
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [router]);

  const close = () => { setKind(null); setCode(''); setErr(''); };
  // 打刻コード（全員 1111）を入れると記録する
  const submit = (v: string) => start(async () => {
    const r = await punchAction(kind!, v);
    if (!r.ok) { setErr(r.error); setCode(''); return; }
    close();
    toast(r.message ?? '記録しました');
    router.refresh();
  });

  return (
    <>
      <Clock />
      <PunchButtons allowed={allowed} reClockIn={reClockIn} disabled={pending} onPunch={(k) => { setErr(''); setCode(''); setKind(k); }} />
      {kind && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pc">
            <h3 id="pc">{kind === 'in' && reClockIn ? 'もう一度出勤' : PUNCH_LABEL[kind]}</h3>
            <p className="meta">打刻コード（4桁）を入れると記録します。{kind === 'out' && '間違えて退勤しても、あとで「もう一度出勤」できます。'}</p>
            <Keypad value={code} onChange={setCode} onDone={submit} disabled={pending} />
            {pending && <p className="sub" style={{ textAlign: 'center' }}>記録しています…</p>}
            {err && <p className="err" role="alert" style={{ textAlign: 'center' }}>{err}</p>}
            <div className="actions"><button className="btn" onClick={close}>やめる</button></div>
          </div>
        </div>
      )}
      {toastNode}
    </>
  );
}
