'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createApiKeyAction, revokeApiKeyAction } from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';

/** APIキーを発行する（キーはこの1回だけ表示） */
export function NewKey({ scopes }: { scopes: Record<string, string> }) {
  const [name, setName] = useState('公式LINE');
  const [sel, setSel] = useState<string[]>(Object.keys(scopes));
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  if (key) {
    return (
      <div className="api-new">
        <b className="ok-t">APIキーを発行しました</b>
        <p className="sub" style={{ margin: '4px 0 8px' }}><b>この画面を閉じると二度と表示できません。</b>今すぐコピーして、連携する人に安全な方法で渡してください（LINEのグループやメールの本文に貼らない、など）。</p>
        <div className="row"><input className="in num" readOnly value={key} onFocus={(e) => e.currentTarget.select()} style={{ flex: '1 1 260px', minWidth: 0, fontSize: 13 }} aria-label="発行したAPIキー" />
          <button className="btn primary" type="button" onClick={() => navigator.clipboard?.writeText(key).then(() => toast('コピーしました'), () => toast('コピーできませんでした。選択してコピーしてください'))}>コピー</button></div>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => { setKey(''); router.refresh(); }}>閉じる</button>
        {node}
      </div>
    );
  }
  return (
    <div className="api-new">
      <label className="field"><span>使い道（あとで見分けるための名前）</span><input className="in" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
      <div className="api-scopes">
        <span className="sub">読める範囲</span>
        {Object.entries(scopes).map(([k, label]) => (
          <label key={k}><input type="checkbox" checked={sel.includes(k)} onChange={(e) => setSel(e.target.checked ? [...sel, k] : sel.filter((x) => x !== k))} /> {label}</label>
        ))}
      </div>
      {err && <p className="bad-t" style={{ margin: 0 }}>{err}</p>}
      <div><button className="btn primary" disabled={pending} onClick={() => start(async () => {
        setErr('');
        const r = await call(() => createApiKeyAction(name, sel));
        if (r.ok) setKey((r as { key: string }).key); else setErr(r.error);
      })}>APIキーを発行する</button></div>
    </div>
  );
}

export function RevokeKey({ id, name }: { id: number; name: string }) {
  return <ActionButton className="btn ghost bad-t" confirmText={`「${name}」のAPIキーを取り消しますか？連携しているシステムは、すぐにデータを読めなくなります。`} action={() => revokeApiKeyAction(id)}>取り消す</ActionButton>;
}
