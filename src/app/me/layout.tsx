import { requireUser, isManager } from '@/lib/auth';
import { Shell } from '@/components/Shell';
import { unseenNotices } from '@/lib/slots';

export const dynamic = 'force-dynamic';

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const n = await unseenNotices(u.id, u.store_id); // 「空きが出ました」のまだ見ていない数（シフト表のタブに出す）
  return <Shell user={u} manager={isManager(u)} area="me" badges={{ '/me/shifts': n }}>{children}</Shell>;
}
