import { requireUser } from '@/lib/auth';
import { PinForm } from './PinForm';

export const dynamic = 'force-dynamic';

export default async function PinPage() {
  const u = await requireUser({ allowMustChange: true });
  return (
    <main className="auth">
      <div className="auth-card">
        <h1>パスワードの変更</h1>
        <p className="sub" style={{ marginTop: 0 }}>
          {u.pin_must_change ? `${u.name}さん、はじめに自分だけの4桁のパスワードを決めてください。1111 や 1234 のような分かりやすい数字は使えません。` : '新しい4桁のパスワードを決めてください。'}
        </p>
        <PinForm canCancel={!u.pin_must_change} />
      </div>
    </main>
  );
}
