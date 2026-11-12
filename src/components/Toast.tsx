'use client';
import { useCallback, useEffect, useState } from 'react';

// お知らせ（「保存しました」など）。画面のいちばん外側（ToastHost）で出すので、
// 押したボタンの行が保存のあとに消えても（例：申請を承認すると一覧から消える）お知らせは残る。
const EVENT = 'kintai-toast';

export function useToast() {
  const show = useCallback((m: string) => { window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: m })); }, []);
  return [show, null] as const;
}

export function ToastHost() {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg((o) => ({ text: (e as CustomEvent<string>).detail, n: (o?.n ?? 0) + 1 }));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div key={msg.n} className="toast" role="status" aria-live="polite">{msg.text}</div> : null;
}
