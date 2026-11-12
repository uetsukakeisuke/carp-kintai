import { authApi } from '@/lib/apikeys';
import { range, v1Shifts } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';
// GET /api/v1/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD（または ?date=）… 公開済みのシフト
export async function GET(req: Request) {
  const a = await authApi(req, 'shifts');
  if (!a.ok) return a.res;
  const r = range(new URL(req.url));
  if ('error' in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ from: r.from, to: r.to, shifts: await v1Shifts(r.from, r.to) }, { headers: { 'cache-control': 'no-store' } });
}
