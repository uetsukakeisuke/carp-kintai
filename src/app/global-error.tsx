'use client';
// いちばん外側（全体の枠）で起きたエラー。ここでは globals.css が効かない場合があるので最小限の見た目で
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja"><body style={{ fontFamily: 'sans-serif', padding: 24, textAlign: 'center' }}>
      <p><b>うまく表示できませんでした</b></p>
      <p>通信が混み合っていた可能性があります。</p>
      <p><button onClick={() => reset()} style={{ fontSize: 16, padding: '10px 18px' }}>もう一度読み込む</button></p>
      <p><a href="/">最初の画面へ</a></p>
    </body></html>
  );
}
