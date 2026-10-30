import { redirect } from 'next/navigation';
import { currentUser, currentTerminal } from '@/lib/auth';
import { listStores, listStaff } from '@/lib/data';
import { LoginForm } from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  const terminal = await currentTerminal();
  const [stores, staff] = await Promise.all([listStores(), listStaff()]);
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>カープ勤怠</h1>
        <p className="sub" style={{ marginTop: 0 }}>自分の名前を押してください。</p>
        <LoginForm
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          staff={staff.map((s) => ({ id: s.id, name: s.name, storeId: s.store_id, pin: s.role !== 'staff' }))}
        />
        {terminal && <p className="sub" style={{ marginTop: 16 }}>この端末は「{terminal.store_name}」の店舗端末です。<a href="/terminal">打刻画面に戻る</a></p>}
      </div>
    </main>
  );
}
