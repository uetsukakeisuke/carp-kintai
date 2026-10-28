import type { NextConfig } from 'next';

const config: NextConfig = {
  // 給与報告のひな形（Excel）をサーバーに同梱する
  outputFileTracingIncludes: { '/api/report': ['./templates/**'] },
  serverExternalPackages: ['bcryptjs'],
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
