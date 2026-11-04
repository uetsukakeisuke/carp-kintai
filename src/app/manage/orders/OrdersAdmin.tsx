'use client';
import { useState } from 'react';
import { setLedgerSheetAction, rotateLedgerSecretAction } from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';
import { useToast } from '@/components/Toast';

/** 台帳（スプレッドシート）のURLを登録する */
export function SheetForm({ has }: { has: boolean }) {
  const [v, setV] = useState('');
  return (
    <div className="row" style={{ gap: 8 }}>
      <input className="in" style={{ flex: '1 1 260px', minWidth: 0 }} value={v} onChange={(e) => setV(e.target.value)}
        placeholder="https://docs.google.com/spreadsheets/d/…" aria-label="台帳のスプレッドシートのURL" inputMode="url" />
      <ActionButton className={`btn${has ? '' : ' primary'}`} action={() => setLedgerSheetAction(v)}>{has ? '登録し直す' : '登録'}</ActionButton>
    </div>
  );
}

/** LINEで届く文面（見本）とコピー */
export function LinePreview({ text }: { text: string }) {
  const [toast, node] = useToast();
  return (
    <div className="lineprev">
      <pre>{text}</pre>
      <button className="btn" type="button" onClick={() => { navigator.clipboard?.writeText(text).then(() => toast('コピーしました'), () => toast('コピーできませんでした')); }}>コピー</button>
      {node}
    </div>
  );
}

export function RotateLedgerSecret() {
  return <ActionButton className="btn ghost" confirmText="合言葉を作り直すと、今のスクリプトは使えなくなります。作り直しますか？" action={rotateLedgerSecretAction}>合言葉を作り直す</ActionButton>;
}
