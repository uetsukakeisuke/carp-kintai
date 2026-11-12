import { authApi } from '@/lib/apikeys';
import { v1Staff } from '@/lib/api-v1';

export const dynamic = 'force-dynamic';
// GET /api/v1/staff … 在籍しているスタッフの名前（時給などは含めない）
export async function GET(req: Request) {
  const a = await authApi(req, 'staff');
  if (!a.ok) return a.res;
  return Response.json({ staff: await v1Staff() }, { headers: { 'cache-control': 'no-store' } });
}
