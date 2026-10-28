'use client';
import { useState, useTransition } from 'react';
import { changePinAction } from '../actions';
import { Keypad } from '@/components/Keypad';

export function PinForm({ canCancel }: { canCancel: boolean }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const titles = ['今のパスワード', '新しいパスワード', '新しいパスワード（もう一度）'];

  const done = (v: string) => {
    setErr('');
    if (step === 0) { setCur(v); setVal(''); setStep(1); return; }
    if (step === 1) { setNext(v); setVal(''); setStep(2); return; }
    if (v !== next) { setErr('2回の入力が一致しません。新しいパスワードからやり直してください。'); setVal(''); setStep(1); return; }
    start(async () => {
      const r = await changePinAction(cur, next);
      if (r && !r.ok) { setErr(r.error); setVal(''); setStep(r.error.includes('違います') || r.error.includes('ロック') ? 0 : 1); }
    });
  };
  return (
    <div>
      <p style={{ textAlign: 'center', fontWeight: 700, margin: '12px 0 0' }}>{titles[step]}</p>
      <Keypad value={val} onChange={setVal} onDone={done} disabled={pending} />
      {err && <p className="err" role="alert" style={{ textAlign: 'center' }}>{err}</p>}
      {canCancel && <p style={{ textAlign: 'center' }}><a href="/">やめる</a></p>}
    </div>
  );
}
