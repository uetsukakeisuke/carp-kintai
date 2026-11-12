import { authApi } from '@/lib/apikeys';
import { range, v1Tasks } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';
// GET /api/v1/tasks?from=YYYY-MM-DD&to=YYYY-MM-DD（または ?date=）… 予定表
export async function GET(req: Request) {
  const a = await authApi(req, 'tasks');
  if (!a.ok) return a.res;
  const r = range(new URL(req.url));
  if ('error' in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ from: r.from, to: r.to, tasks: await v1Tasks(r.from, r.to) }, { headers: { 'cache-control': 'no-store' } });
}
