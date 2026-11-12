'use client';
import { useEffect, useState } from 'react';

/**
 * 通信が止まったときの案内。Next.js では、1つの保存の返事を待っているあいだ
 * 画面の移動や他のボタンも後ろで待たされるため、止まったら再読み込みで抜け出せるようにする。
 * アプリの更新直後に古い画面のまま操作して読み込みに失敗したときも同じ案内を出す。
 */
export function StuckBanner() {
  const [why, setWhy] = useState<'' | 'slow' | 'update'>('');
  useEffect(() => {
    const onStuck = () => setWhy((w) => w || 'slow');
    const isChunk = (m: string) => /ChunkLoadError|Loading chunk|dynamically imported module|Failed to find Server Action/i.test(m);
    const onErr = (e: ErrorEvent) => { if (isChunk(String(e.message))) setWhy('update'); };
    const onRej = (e: PromiseRejectionEvent) => { const r = e.reason as { message?: string; name?: string } | undefined; if (isChunk(`${r?.name ?? ''} ${r?.message ?? ''}`)) setWhy('update'); };
    window.addEventListener('kintai-stuck', onStuck);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    return () => { window.removeEventListener('kintai-stuck', onStuck); window.removeEventListener('error', onErr); window.removeEventListener('unhandledrejection', onRej); };
  }, []);
  if (!why) return null;
  return (
    <div className="stuck" role="alert">
      <span>{why === 'update' ? 'アプリが新しくなりました。読み込み直してください。' : '通信が止まっています。読み込み直すと、また操作できるようになります。'}</span>
      <button className="btn primary" onClick={() => window.location.reload()}>再読み込み</button>
      <button className="btn ghost" aria-label="閉じる" onClick={() => setWhy('')}>×</button>
    </div>
  );
}
