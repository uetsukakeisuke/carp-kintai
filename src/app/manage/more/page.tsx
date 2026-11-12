import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { sql } from '@/lib/db';
import { jstParts } from '@/lib/time';
import { latestSnapshot } from '@/lib/ledger';
import { buildReport } from '@/lib/kobo';

export const dynamic = 'force-dynamic';

type Item = { href: string; icon: string; title: string; desc: string; admin?: boolean; hint?: 'hopes' | 'orders' };
// 使う場面ごとにまとめる（スマホの「その他」。PCは上のタブからも開ける）
const GROUPS: { name: string; items: Item[] }[] = [
  { name: 'シフト', items: [
    { href: '/manage/hopes', icon: '✎', title: '希望の提出状況', desc: '誰が出したか・受付期間の設定', hint: 'hopes' },
    { href: '/manage/forecast', icon: '↗', title: '作業量の予測', desc: '日ごとの作業時間・自動下書きの目安' },
  ] },
  { name: 'お金', items: [
    { href: '/manage/report', icon: '⇩', title: '給与報告', desc: 'アクトヴィジョンに送る月の報告（xlsx）' },
    { href: '/manage/payslips', icon: '¥', title: '給与明細', desc: 'Gmailからの取り込み・全員の明細' },
  ] },
  { name: '京都工房', items: [
    { href: '/manage/orders', icon: '▤', title: '受発注の報告', desc: '納期の遅れ・未入荷・未請求', admin: true, hint: 'orders' },
  ] },
  { name: '設定', items: [
    { href: '/manage/settings', icon: '⚙', title: '店舗・端末', desc: '人件費予算・店舗端末' },
    { href: '/manage/api', icon: '⇄', title: '外部連携（APIキー）', desc: '公式LINEなどとの連携', admin: true },
    { href: '/me/punch', icon: '◷', title: '自分の打刻', desc: '店長・管理者の出勤・退勤' },
    { href: '/pin', icon: '＊', title: 'パスワード（4桁）を変える', desc: 'ログイン用' },
  ] },
];

/** 右側に出す「いまの状態」。取れなければ出さない */
async function hints(admin: boolean): Promise<Record<string, { text: string; tone: 'warn' | 'ok' }>> {
  const out: Record<string, { text: string; tone: 'warn' | 'ok' }> = {};
  const today = jstParts().date;
  const [y, m] = today.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  try {
    const [r] = await sql<{ total: number; done: number }[]>`
      select count(*)::int as total,
        count(h.staff_id)::int as done
      from staff s left join hope_submissions h on h.staff_id = s.id and h.year = ${ny} and h.month = ${nm}
      where s.active and s.pay_type = 'hourly'`;
    if (r && r.total) {
      const left = r.total - r.done;
      out.hopes = left ? { text: `${nm}月 未提出${left}人`, tone: 'warn' } : { text: `${nm}月 全員提出`, tone: 'ok' };
    }
  } catch { /* 出さない */ }
  if (admin) {
    try {
      const snap = await latestSnapshot();
      if (snap) {
        const rep = buildReport(snap.orders, snap.terms, today);
        const n = rep.overdue.length + rep.soon.length + rep.unbilled.length;
        out.orders = n ? { text: `要対応 ${n}件`, tone: 'warn' } : { text: '要対応なし', tone: 'ok' };
      }
    } catch { /* 出さない */ }
  }
  return out;
}

export default async function MorePage() {
  const u = await requireManager();
  const admin = u.role === 'admin';
  const h = await hints(admin);
  return (
    <div className="narrow more">
      {GROUPS.map((g) => {
        const items = g.items.filter((it) => !it.admin || admin);
        if (!items.length) return null;
        return (
          <section key={g.name} className="more-grp" aria-label={g.name}>
            <h2>{g.name}</h2>
            <div className="more-list">
              {items.map((it) => {
                const hint = it.hint ? h[it.hint] : undefined;
                return (
                  <Link key={it.href} href={it.href} className="more-row">
                    <span className="more-ic" aria-hidden="true">{it.icon}</span>
                    <span className="more-t"><b>{it.title}</b><small>{it.desc}</small></span>
                    {hint && <span className={`more-hint ${hint.tone}`}>{hint.text}</span>}
                    <span className="more-go" aria-hidden="true">›</span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
