'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from './Toast';

type R = { ok: true; message?: string } | { ok: false; error: string };
/** サーバーの処理を1つ呼ぶボタン（結果をトーストで出す） */
export function ActionButton({ action, children, className = 'btn', confirmText }: { action: () => Promise<R>; children: React.ReactNode; className?: string; confirmText?: string }) {
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  return (
    <>
      <button className={className} disabled={pending} onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        start(async () => { const r = await action(); toast(r.ok ? r.message ?? '完了しました' : r.error); router.refresh(); });
      }}>{children}</button>
      {node}
    </>
  );
}
