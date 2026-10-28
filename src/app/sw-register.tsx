'use client';
import { useEffect } from 'react';

// ホーム画面に追加したときにアプリとして起動できるよう、サービスワーカーを登録する
export function SwRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
