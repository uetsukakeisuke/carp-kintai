import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SwRegister } from './sw-register';

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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Zen+Kaku+Gothic+New:wght@500;700&family=IBM+Plex+Mono:wght@500;600&display=swap" />
      </head>
      <body>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
