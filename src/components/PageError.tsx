'use client';
import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 画面を表示できなかったとき（通信の混雑など）。押せば読み込み直す */
export function PageError({ error, reset, home }: { error: Error & { digest?: string }; reset: () => void; home: string }) {
  const router = useRouter();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="empty" style={{ margin: '24px auto', maxWidth: 420 }}>
      <b>うまく表示できませんでした</b>
      <span>通信が混み合っていた可能性があります。入力した内容が消えることはありません。</span>
      <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
        <button className="btn primary" onClick={() => startTransition(() => { router.refresh(); reset(); })}>もう一度読み込む</button>
        <a className="btn" href={home}>最初の画面へ</a>
      </div>
      {error.digest && <span className="sub" style={{ fontSize: 11 }}>番号：{error.digest}</span>}
    </div>
  );
}
