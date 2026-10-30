'use client';
import { useEffect, useState, useTransition } from 'react';
import { loginAction } from '../actions';
import { Keypad } from '@/components/Keypad';

const KEY = 'kintai-last-staff';

export function LoginForm({ stores, staff }: { stores: { id: number; name: string }[]; staff: { id: number; name: string; storeId: number | null }[] }) {
  const [store, setStore] = useState<number | 'all'>('all');
  const [sel, setSel] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    try { const v = Number(localStorage.getItem(KEY)); if (v && staff.some((s) => s.id === v)) setSel(v); } catch {}
  }, [staff]);

  const submit = (v: string) => {
    if (!sel) return;
    setErr('');
    start(async () => {
      try { localStorage.setItem(KEY, String(sel)); } catch {}
      const r = await loginAction(sel, v);
      if (r && !r.ok) { setErr(r.error); setPin(''); }
    });
  };
  const me = staff.find((s) => s.id === sel);
  const shown = staff.filter((s) => store === 'all' || s.storeId === store || s.storeId === null);

  if (me) {
    return (
      <div>
        <div className="row" style={{ justifyContent: 'space-between', margin: '12px 0 0' }}>
          <b style={{ fontSize: 18 }}>{me.name} さん</b>
          <button className="btn ghost" type="button" onClick={() => { setSel(null); setPin(''); setErr(''); try { localStorage.removeItem(KEY); } catch {} }}>別の人</button>
        </div>
        <Keypad value={pin} onChange={setPin} onDone={submit} disabled={pending} />
        {pending && <p className="sub" style={{ textAlign: 'center' }}>確認しています…</p>}
        {err && <p className="err" role="alert" style={{ textAlign: 'center' }}>{err}</p>}
      </div>
    );
  }
  return (
    <div>
      {stores.length > 1 && (
        <div className="chips">
          <button type="button" className={`btn${store === 'all' ? ' primary' : ''}`} onClick={() => setStore('all')}>すべて</button>
          {stores.map((s) => <button key={s.id} type="button" className={`btn${store === s.id ? ' primary' : ''}`} onClick={() => setStore(s.id)}>{s.name}</button>)}
        </div>
      )}
      <div className="namegrid">
        {shown.map((s) => <button key={s.id} type="button" onClick={() => setSel(s.id)}>{s.name}</button>)}
      </div>
      {!staff.length && <p className="sub">スタッフが登録されていません。管理者に連絡してください。</p>}
    </div>
  );
}
