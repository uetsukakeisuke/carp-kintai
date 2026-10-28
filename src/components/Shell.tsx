import Link from 'next/link';
import { logoutAction } from '@/app/actions';
import { NavLinks } from './NavLinks';

export const STAFF_NAV = [
  { href: '/me/punch', label: '打刻', icon: '◷' },
  { href: '/me/calendar', label: 'カレンダー', icon: '▦' },
  { href: '/me/hopes', label: 'シフト希望', icon: '✎' },
  { href: '/me/shifts', label: 'みんなのシフト', short: 'シフト表', icon: '☰' },
  { href: '/me/settings', label: '設定', icon: '⚙' },
];
export const MANAGE_NAV = [
  { href: '/manage/shifts', label: 'シフト作成' },
  { href: '/manage/hopes', label: '希望の提出状況' },
  { href: '/manage/attendance', label: '勤怠実績' },
  { href: '/manage/report', label: '給与報告' },
  { href: '/manage/staff', label: 'スタッフ・時給' },
  { href: '/manage/settings', label: '店舗・端末' },
];

export function Shell({ user, manager, area, badges, children }: {
  user: { name: string }; manager: boolean; area: 'me' | 'manage'; badges?: Record<string, number>; children: React.ReactNode;
}) {
  return (
    <>
      <header className="top"><div className="top-in">
        <Link className="brand" href="/">カープ勤怠</Link>
        {manager && (
          <nav className="row" aria-label="画面の切り替え">
            <Link className={`btn${area === 'manage' ? ' primary' : ''}`} href="/manage/shifts">管理</Link>
            <Link className={`btn${area === 'me' ? ' primary' : ''}`} href="/me/punch">自分の打刻</Link>
          </nav>
        )}
        <div className="who"><span>{user.name}</span>
          <form action={logoutAction}><button className="btn ghost" type="submit">ログアウト</button></form>
        </div>
      </div></header>
      <div className="wrap">
        <NavLinks items={area === 'me' ? STAFF_NAV : MANAGE_NAV} className={`tabs${area === 'me' ? ' staff' : ''}`} badges={badges} />
        {children}
      </div>
      {area === 'me' && <NavLinks items={STAFF_NAV} className="botnav" bottom />}
    </>
  );
}
