'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

type Item = { href: string; label: string; short?: string; icon?: string; also?: string[] };

export function NavLinks({ items, className, bottom, badges }: { items: Item[]; className: string; bottom?: boolean; badges?: Record<string, number> }) {
  const path = usePathname();
  useEffect(() => {
    if (!bottom) return;
    document.body.classList.add('has-botnav');
    return () => document.body.classList.remove('has-botnav');
  }, [bottom]);
  // メニューを閉じる（ページ移動時）
  useEffect(() => { document.querySelectorAll('details.usermenu[open]').forEach((d) => d.removeAttribute('open')); }, [path]);
  const active = (it: Item) => path.startsWith(it.href) || (it.also ?? []).some((a) => path.startsWith(a));
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
