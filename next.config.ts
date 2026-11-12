import type { NextConfig } from 'next';

const config: NextConfig = {
  // デプロイごとの番号。古い画面のまま操作したときは、自動で読み込み直す（固まるのを防ぐ）
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
  // 給与報告のひな形（Excel）をサーバーに同梱する
  outputFileTracingIncludes: { '/api/report': ['./templates/**'] },
  serverExternalPackages: ['bcryptjs', 'unpdf'],
  // 給与明細PDFの手動アップロード用
  experimental: {
    serverActions: { bodySizeLimit: '5mb' },
    // 30秒以内に同じ画面へ戻るときは、さっきの表示をそのまま使う（すぐ出る）。
    // 保存したとき（revalidatePath・router.refresh）やログイン・ログアウトのときは、覚えた表示を捨てて読み直す
    staleTimes: { dynamic: 30 },
  },
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
      ],
    }];
  },
};
export default config;
