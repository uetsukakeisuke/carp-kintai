'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { punchAction, checkPunchCodeAction } from '@/app/actions';
import { FaceStep } from '@/components/FaceStep';
import { loadFace } from '@/lib/face-client';
import type { PunchKind } from '@/lib/calc';
import { useToast } from '@/components/Toast';
import { PunchButtons } from '@/components/PunchButtons';
import { PUNCH_LABEL } from '@/components/PunchLog';
import { Clock } from '@/components/Clock';
import { Keypad } from '@/components/Keypad';
import { call } from '@/lib/call';

export function PunchPanel({ allowed, reClockIn, staffId, face = true }: { allowed: PunchKind[]; reClockIn: boolean; serverNow: number; staffId: number; face?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, toastNode] = useToast();
  const [kind, setKind] = useState<PunchKind | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [faceStep, setFaceStep] = useState<string | null>(null); // 打刻コードが正しかったら顔の撮影へ
  // 顔認証の準備を先にしておく（初回は数秒かかるため）
  useEffect(() => { if (face) { const t = setTimeout(() => loadFace().catch(() => {}), 1500); return () => clearTimeout(t); } }, [face]);

  // 画面を開いたままにしても状態がずれないよう、復帰時に最新化する
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, [router]);

  const close = () => { setKind(null); setCode(''); setErr(''); setFaceStep(null); };
  // 打刻コード（全員 1111）を入れると記録する
  const record = (v: string, f?: { r: string; dist?: number }) => start(async () => {
    const r = await call(() => punchAction(kind!, v, f));
    if (!r.ok) { setErr(r.error); setCode(''); setFaceStep(null); return; }
    close();
    toast(r.message ?? '記録しました');
    router.refresh();
  });
  const submit = (v: string) => {
    if (!face) return record(v);
    start(async () => {
      const r = await call(() => checkPunchCodeAction(v));
      if (!r.ok) { setErr(r.error); setCode(''); return; }
      setErr(''); setFaceStep(v);
    });
  };

  return (
    <>
      <Clock />
      <PunchButtons allowed={allowed} reClockIn={reClockIn} disabled={pending} onPunch={(k) => { setErr(''); setCode(''); setKind(k); }} />
      {kind && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="pc">
            <h3 id="pc">{kind === 'in' && reClockIn ? 'もう一度出勤' : PUNCH_LABEL[kind]}</h3>
            {faceStep ? (
              <>
                {pending ? <p className="sub" style={{ textAlign: 'center' }}>記録しています…</p>
                  : <FaceStep staffId={staffId} onResult={(f) => record(faceStep, f)} />}
              </>
            ) : (
              <>
                <p className="meta">打刻コード（4桁）を入れると{face ? '、顔の確認に進みます' : '記録します'}。{kind === 'out' && '間違えて退勤しても、あとで「もう一度出勤」できます。'}</p>
                <Keypad value={code} onChange={setCode} onDone={submit} disabled={pending} />
              </>
            )}
            {pending && !faceStep && <p className="sub" style={{ textAlign: 'center' }}>確認しています…</p>}
            {err && <p className="err" role="alert" style={{ textAlign: 'center' }}>{err}</p>}
            <div className="actions"><button className="btn" onClick={close}>やめる</button></div>
          </div>
        </div>
      )}
      {toastNode}
    </>
  );
}
