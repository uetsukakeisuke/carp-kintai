'use client';
import { useEffect, useState } from 'react';

/** 画面を移るあいだの表示。押したのに何も起きない（固まった）ように見えないようにする */
export function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>読み込み中…</span>
      {slow && <span className="sub" style={{ maxWidth: 320, textAlign: 'center' }}>通信に時間がかかっています。電波の良い場所でお待ちください。続くときは画面を下に引っぱって再読み込みしてください。</span>}
    </div>
  );
}
