import Link from 'next/link';
import { Suspense } from 'react';
import { logoutAction } from '@/app/actions';
import { NavLinks, SubNav, type NavGroup } from './NavLinks';

type NavItem = NavGroup & { short?: string; icon?: string; bottom?: boolean; tab?: boolean; also?: string[]; admin?: boolean };
export const STAFF_NAV: NavItem[] = [
  { href: '/me/punch', label: '打刻', icon: '◷' },
  { href: '/me/calendar', label: 'カレンダー', icon: '▦' },
  { href: '/me/hopes', label: 'シフト希望', short: '希望', icon: '✎' },
  { href: '/me/shifts', label: 'みんなのシフト', short: 'シフト表', icon: '☰' },
  { href: '/me/payslips', label: '給与明細', short: '明細', icon: '¥' },
  { href: '/me/settings', label: '設定', icon: '⚙' },
];
// 管理：使う場面ごとにまとめる。PC は上のタブ、スマホは下のバー（よく使う4つ＋その他）。
// まとまりの中の画面は、ページの上の見出し（SubNav）で切り替える
export const MANAGE_NAV: NavItem[] = [
  { href: '/manage/shifts', label: 'シフト', icon: '▦', pages: [
    { href: '/manage/shifts', label: 'シフト作成' },
    { href: '/manage/hopes', label: '希望の提出状況' },
    { href: '/manage/forecast', label: '作業量の予測' },
  ] },
  { href: '/manage/tasks', label: '予定表', short: '予定', icon: '✓', pages: [{ href: '/manage/tasks', label: '予定表' }] },
  { href: '/manage/attendance', label: '勤怠実績', short: '勤怠', icon: '◷', pages: [{ href: '/manage/attendance', label: '勤怠実績' }] },
  { href: '/manage/staff', label: 'スタッフ・時給', short: 'スタッフ', icon: '☺', pages: [{ href: '/manage/staff', label: 'スタッフ・時給' }] },
  { href: '/manage/report', label: '給与・経費', bottom: false, pages: [
    { href: '/manage/report', label: '給与報告フォーム' },
    { href: '/manage/expenses', label: '経費・旅費精算', admin: true },
    { href: '/manage/payslips', label: '給与明細' },
  ] },
  { href: '/manage/orders', label: '京都工房', bottom: false, admin: true, pages: [{ href: '/manage/orders', label: '受発注の報告' }] },
  { href: '/manage/settings', label: '設定', bottom: false, pages: [
    { href: '/manage/settings', label: '店舗・端末' },
    { href: '/manage/api', label: '外部連携（APIキー）', admin: true },
  ] },
  { href: '/manage/more', label: 'その他', icon: '⋯', tab: false, also: ['/manage/report', '/manage/expenses', '/manage/payslips', '/manage/orders', '/manage/settings', '/manage/api'] },
];

export function Shell({ user, manager, area, badges, children }: {
  user: { name: string; role?: string }; manager: boolean; area: 'me' | 'manage'; badges?: Record<string, number>; children: React.ReactNode;
}) {
  const admin = user.role === 'admin';
  const nav = (area === 'me' ? STAFF_NAV : MANAGE_NAV)
    .filter((n) => !n.admin || admin)
    .map((n) => ({ ...n, pages: n.pages?.filter((p) => !p.admin || admin), also: n.also ?? n.pages?.map((p) => p.href) }));
  return (
    <div className={`area-${area}`}>
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
        {area === 'manage' && <Suspense fallback={null}><SubNav groups={nav.filter((n) => n.pages?.length)} badges={badges} /></Suspense>}
        {children}
      </div>
      <NavLinks items={nav.filter((n) => n.bottom !== false)} className="botnav" bottom badges={badges} />
    </div>
  );
}
