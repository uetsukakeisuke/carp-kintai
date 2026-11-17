import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SwRegister } from './sw-register';
import { StuckBanner } from '@/components/StuckBanner';
import { ToastHost } from '@/components/Toast';

// サーバーの処理は30秒で打ち切る（止まった処理が後ろの操作を待たせ続けないように。初期値は最大300秒）
export const maxDuration = 30;
const FONTS = '/fonts/v1/fonts.css';

export const metadata: Metadata = {
  title: 'カープ勤怠',
  description: '株式会社カープエージェンシーのシフト・勤怠管理',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'カープ勤怠', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#FFFFFF' }, { media: '(prefers-color-scheme: dark)', color: '#1A2029' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        {/* 文字（フォント）は、アプリと同じ場所から、画面の表示を止めずにあとから読む（まず端末の文字で出し、届いたら切り替わる）。
            ファイルは scripts/copy-fonts.mjs がビルドの前に public/fonts/ に用意する */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var l=document.createElement('link');l.rel='stylesheet';l.href='${FONTS}';document.head.appendChild(l)})()` }} />
        <noscript><link rel="stylesheet" href={FONTS} /></noscript>
      </head>
      <body>
        {children}
        <StuckBanner />
        <ToastHost />
        <SwRegister />
      </body>
    </html>
  );
}
