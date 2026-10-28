import { requireManager } from '@/lib/auth';
import { sql } from '@/lib/db';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const u = await requireManager();
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from correction_requests where status = 'pending'`;
  return <Shell user={u} manager area="manage" badges={{ '/manage/attendance': n }}>{children}</Shell>;
}
