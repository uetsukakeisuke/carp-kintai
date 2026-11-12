import { authApi } from '@/lib/apikeys';
import { range, v1Day } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';
// GET /api/v1/day?date=YYYY-MM-DD … その日に出勤する人ごとの、シフトと予定（全体＋その人）。公式LINEで1人ずつ送る用
export async function GET(req: Request) {
  for (const s of ['shifts', 'tasks'] as const) {
    const a = await authApi(req, s);
    if (!a.ok) return a.res;
  }
  const r = range(new URL(req.url));
  if ('error' in r) return Response.json({ error: r.error }, { status: 400 });
  if (r.from !== r.to) return Response.json({ error: 'day は1日だけ指定してください（?date=YYYY-MM-DD）' }, { status: 400 });
  return Response.json(await v1Day(r.from), { headers: { 'cache-control': 'no-store' } });
}
