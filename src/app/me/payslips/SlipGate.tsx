'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSlipPinAction, unlockSlipsAction, lockSlipsAction } from '@/app/actions';
import { Keypad } from '@/components/Keypad';
import { call } from '@/lib/call';

/** 明細を開くための本人の暗証番号。初回は決める（2回入力）、以後は入れて開く */
export function SlipGate({ hasPin, locked }: { hasPin: boolean; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const title = hasPin ? '明細の暗証番号を入れてください' : first ? 'もう一度入れてください' : '明細を見るための暗証番号（4桁）を決めてください';
  const done = (pin: string) => {
    setErr('');
    if (!hasPin && !first) { setFirst(pin); setV(''); return; }
    if (!hasPin && first !== pin) { setErr('1回目と違います。最初からやり直してください。'); setFirst(null); setV(''); return; }
    start(async () => {
      const r = await call(() => (hasPin ? unlockSlipsAction(pin) : setSlipPinAction(pin)));
      if (!r.ok) { setErr(r.error); setV(''); setFirst(null); return; }
      router.refresh();
    });
  };
  return (
    <div className="card narrow" style={{ maxWidth: 420, margin: '0 auto' }}>
      <p style={{ textAlign: 'center', fontWeight: 700, margin: '4px 0 0' }}>{title}</p>
      {!hasPin && <p className="sub" style={{ textAlign: 'center', margin: '4px 0 0' }}>打刻の 1111 とは別の番号にしてください。この番号は管理者（上塚）も確認できます。銀行カードなど大事な暗証番号と同じ番号にはしないでください。</p>}
      {locked ? <p className="err" style={{ textAlign: 'center' }}>5回間違えたため、しばらく開けません。急ぐ場合は管理者に聞いてください。</p>
        : <Keypad value={v} onChange={setV} onDone={done} disabled={pending} />}
      {err && <p className="err" role="alert" style={{ textAlign: 'center' }}>{err}</p>}
      {hasPin && <p className="sub" style={{ textAlign: 'center' }}>忘れたときは管理者に聞いてください。</p>}
    </div>
  );
}

export function LockButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button className="btn ghost" disabled={pending} onClick={() => start(async () => { await call(lockSlipsAction); router.refresh(); })}>明細を閉じる</button>;
}
