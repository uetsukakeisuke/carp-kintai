'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

type Item = { href: string; label: string; short?: string; icon?: string; also?: string[] };
export type NavPage = { href: string; label: string; admin?: boolean };
export type NavGroup = { href: string; label: string; pages?: NavPage[] };

const under = (path: string, href: string) => path === href || path.startsWith(href + '/');

export function NavLinks({ items, className, bottom, badges }: { items: Item[]; className: string; bottom?: boolean; badges?: Record<string, number> }) {
  const path = usePathname();
  useEffect(() => {
    if (!bottom) return;
    document.body.classList.add('has-botnav');
    return () => document.body.classList.remove('has-botnav');
  }, [bottom]);
  // メニューを閉じる（ページ移動時）
  useEffect(() => { document.querySelectorAll('details.usermenu[open]').forEach((d) => d.removeAttribute('open')); }, [path]);
  const active = (it: Item) => under(path, it.href) || (it.also ?? []).some((a) => under(path, a));
  return (
    <nav className={className} aria-label="メニュー">
      {items.map((it) => {
        const n = badges?.[it.href] ?? 0;
        return (
          <Link key={it.href} href={it.href} aria-current={active(it) ? 'page' : undefined}>
            {bottom && <b aria-hidden="true">{it.icon}</b>}
            {bottom ? it.short ?? it.label : it.label}
            {n > 0 && (bottom ? <span className="dot">{n}</span> : <span className="cnt">{n}</span>)}
          </Link>
        );
      })}
    </nav>
  );
}

/** ページの見出し。まとまり（例：給与・経費）の中の画面を並べ、いまの画面を大きく出す。月（?ym=）は引き継ぐ */
export function SubNav({ groups, badges }: { groups: NavGroup[]; badges?: Record<string, number> }) {
  const path = usePathname();
  const sp = useSearchParams();
  const group = groups.find((g) => g.pages?.some((p) => under(path, p.href)));
  if (!group?.pages) return null;
  const ym = sp.get('ym');
  return (
    <nav className="subnav" aria-label={`${group.label}の画面`}>
      {group.pages.map((p) => {
        const on = under(path, p.href);
        const n = badges?.[p.href] ?? 0;
        return (
          <Link key={p.href} href={ym && /^\d{4}-\d{2}$/.test(ym) ? `${p.href}?ym=${ym}` : p.href} aria-current={on ? 'page' : undefined}>
            {on ? <h1>{p.label}</h1> : p.label}
            {n > 0 && <span className="cnt">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
