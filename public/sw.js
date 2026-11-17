// 最小限のサービスワーカー：アプリとしてインストールできるようにし、通信できないときは案内を出す。
// 勤怠データはキャッシュしない（常に最新を表示するため）。
// ナビゲーションプリロード：サービスワーカーの起動を待たずにページの読み込みを始める（起動待ちのぶん速くなる）。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  try { if (self.registration.navigationPreload) await self.registration.navigationPreload.enable(); } catch { /* 対応していないブラウザ */ }
  await self.clients.claim();
})()));
const offline = () => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:24px"><h2>通信できません</h2><p>電波の良い場所で、もう一度開いてください。打刻は記録されていません。</p></body>',
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith((async () => {
    try {
      const pre = await e.preloadResponse;
      if (pre) return pre;
      return await fetch(e.request);
    } catch {
      return offline();
    }
  })());
});
