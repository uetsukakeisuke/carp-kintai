import { redirect } from 'next/navigation';
import { currentUser, currentTerminal, isManager } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const u = await currentUser();
  if (!u) redirect((await currentTerminal()) ? '/terminal' : '/login');
  if (u.pin_must_change && u.role !== 'staff') redirect('/pin');
  redirect(isManager(u) ? '/manage/shifts' : '/me/punch');
}
