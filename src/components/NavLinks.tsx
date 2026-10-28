'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function NavLinks({ items, className, bottom, badges }: {
  items: { href: string; label: string; short?: string; icon?: string }[]; className: string; bottom?: boolean; badges?: Record<string, number>;
}) {
  const path = usePathname();
  useEffect(() => {
    if (!bottom) return;
    document.body.classList.add('has-botnav');
    return () => document.body.classList.remove('has-botnav');
  }, [bottom]);
  return (
    <nav className={className} aria-label="メニュー">
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={path.startsWith(it.href) ? 'page' : undefined}>
          {bottom && <b aria-hidden="true">{it.icon}</b>}
          {bottom ? it.short ?? it.label : it.label}
          {!bottom && badges?.[it.href] ? <span className="cnt">{badges[it.href]}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
