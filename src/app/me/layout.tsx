import { requireUser, isManager } from '@/lib/auth';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  return <Shell user={u} manager={isManager(u)} area="me">{children}</Shell>;
}
