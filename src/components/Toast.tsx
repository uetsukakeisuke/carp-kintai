'use client';
import { useCallback, useEffect, useState } from 'react';

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3600);
    return () => clearTimeout(t);
  }, [msg]);
  const show = useCallback((m: string) => setMsg(m), []);
  const node = msg ? <div className="toast" role="status">{msg}</div> : null;
  return [show, node] as const;
}
