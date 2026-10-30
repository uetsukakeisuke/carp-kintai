import Link from 'next/link';
import { logoutAction } from '@/app/actions';
import { NavLinks } from './NavLinks';

type NavItem = { href: string; label: string; short?: string; icon?: string; bottom?: boolean; tab?: boolean; also?: string[] };
export const STAFF_NAV: NavItem[] = [
  { href: '/me/punch', label: '打刻', icon: '◷' },
  { href: '/me/calendar', label: 'カレンダー', icon: '▦' },
  { href: '/me/hopes', label: 'シフト希望', short: '希望', icon: '✎' },
  { href: '/me/shifts', label: 'みんなのシフト', short: 'シフト表', icon: '☰' },
  { href: '/me/settings', label: '設定', icon: '⚙' },
];
// PC：上のタブ ／ スマホ：下のバー（よく使う4つ＋その他）
export const MANAGE_NAV: NavItem[] = [
  { href: '/manage/shifts', label: 'シフト作成', short: 'シフト', icon: '▦' },
  { href: '/manage/hopes', label: '希望の提出状況', bottom: false },
  { href: '/manage/attendance', label: '勤怠実績', short: '勤怠', icon: '◷' },
  { href: '/manage/report', label: '給与報告', short: '給与報告', icon: '⇩' },
  { href: '/manage/staff', label: 'スタッフ・時給', short: 'スタッフ', icon: '☺' },
  { href: '/manage/settings', label: '店舗・端末', bottom: false },
  { href: '/manage/more', label: 'その他', icon: '⋯', tab: false, also: ['/manage/hopes', '/manage/settings'] },
];

export function Shell({ user, manager, area, badges, children }: {
  user: { name: string }; manager: boolean; area: 'me' | 'manage'; badges?: Record<string, number>; children: React.ReactNode;
}) {
  const nav = area === 'me' ? STAFF_NAV : MANAGE_NAV;
  return (
    <>
      <header className="top"><div className="top-in">
        <Link className="brand" href="/">カープ勤怠</Link>
        {manager && (
          <nav className="seg" aria-label="画面の切り替え">
            <Link href="/manage/shifts" aria-current={area === 'manage' ? 'page' : undefined}>管理</Link>
            <Link href="/me/punch" aria-current={area === 'me' ? 'page' : undefined}>打刻</Link>
          </nav>
        )}
        <div className="who">
          <details className="usermenu">
            <summary aria-label="メニュー">{user.name}</summary>
            <div className="menu">
              <div className="who-name">{user.name} さん</div>
              {manager && <Link href="/pin">パスワード（4桁）を変える</Link>}
              <form action={logoutAction}><button type="submit">ログアウト</button></form>
            </div>
          </details>
        </div>
      </div></header>
      <div className="wrap">
        <NavLinks items={nav.filter((n) => n.tab !== false)} className="tabs bnav-tabs" badges={badges} />
        {children}
      </div>
      <NavLinks items={nav.filter((n) => n.bottom !== false)} className="botnav" bottom badges={badges} />
    </>
  );
}
