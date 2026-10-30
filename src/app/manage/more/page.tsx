import Link from 'next/link';

const ITEMS = [
  { href: '/manage/hopes', title: '希望の提出状況', desc: '誰がシフト希望を出したか、提出締切の設定' },
  { href: '/manage/settings', title: '店舗・端末', desc: '店舗ごとの人件費予算、休憩室のタブレットを店舗端末にする' },
  { href: '/me/punch', title: '自分の打刻', desc: '店長・管理者自身の出勤・退勤' },
  { href: '/pin', title: '自分のパスワード（4桁）を変える', desc: '店長・管理者のログイン用' },
];
export default function MorePage() {
  return (
    <div className="narrow list">
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} className="item" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="item-h"><b>{it.title}</b><span className="end sub" aria-hidden="true">›</span></div>
          {it.desc && <span className="sub">{it.desc}</span>}
        </Link>
      ))}
    </div>
  );
}
