import { icsFor } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

// 自分のカレンダー（Googleカレンダー・iPhoneのカレンダーなど）が定期的に読みに来るURL。ログインは不要で、URLの中の鍵で本人を見分ける
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const host = new URL(req.url).host;
  const body = await icsFor(token.replace(/\.ics$/i, ''), host);
  if (!body) return new Response('見つかりません', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="carp-kintai.ics"',
      'cache-control': 'private, max-age=300',
    },
  });
}
