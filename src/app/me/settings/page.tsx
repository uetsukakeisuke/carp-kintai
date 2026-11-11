import Link from 'next/link';
import { requireUser, isManager } from '@/lib/auth';
import { logoutAction } from '@/app/actions';
import { headers } from 'next/headers';
import { FaceReset } from './FaceReset';
import { CalLink } from './CalLink';
import { calToken } from '@/lib/calendar';

export default async function SettingsPage() {
  const u = await requireUser();
  const [token, h] = await Promise.all([calToken(u.id), headers()]);
  const url = token ? `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}/cal/${token}.ics` : null;
  return (
    <div className="narrow" style={{ display: 'grid', gap: 12 }}>
      <div className="card"><b>{u.name} さん</b></div>
{isManager(u) && (
      <div className="card row" style={{ justifyContent: 'space-between', minHeight: 64 }}>
        <span>パスワード（4桁）を変える</span><Link className="btn" href="/pin">変更する</Link>
      </div>
      )}
      <CalLink url={url} />
      <FaceReset staffId={u.id} />
      <div className="card">
        <b>スマホのホーム画面に追加する</b>
        <ul className="sub" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>iPhone：Safariで開き、共有ボタン → 「ホーム画面に追加」</li>
          <li>Android：Chromeで開き、右上の︙ → 「ホーム画面に追加」または「アプリをインストール」</li>
        </ul>
      </div>
      <form action={logoutAction}><button className="btn" type="submit" style={{ width: '100%' }}>ログアウト</button></form>
    </div>
  );
}
