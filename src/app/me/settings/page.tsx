import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { logoutAction } from '@/app/actions';

export default async function SettingsPage() {
  const u = await requireUser();
  return (
    <div className="narrow" style={{ display: 'grid', gap: 12 }}>
      <div className="card"><b>{u.name} さん</b></div>
      <div className="card row" style={{ justifyContent: 'space-between' }}>
        <span>パスワード（4桁）を変える</span><Link className="btn" href="/pin">変更する</Link>
      </div>
      <div className="card">
        <b>スマホのホーム画面に追加する</b>
        <ul className="sub" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>iPhone：Safariで開き、共有ボタン → 「ホーム画面に追加」</li>
          <li>Android：Chromeで開き、右上の︙ → 「ホーム画面に追加」または「アプリをインストール」</li>
        </ul>
      </div>
      <form action={logoutAction}><button className="btn" type="submit">ログアウト</button></form>
    </div>
  );
}
