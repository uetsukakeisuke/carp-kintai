import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { jstParts, daysInMonth, ymd } from '@/lib/time';
import { HopeForm } from './HopeForm';

export default async function HopesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const now = jstParts().date;
  const [cy, cm] = now.split('-').map(Number);
  const def = cm === 12 ? `${cy + 1}-01` : `${cy}-${String(cm + 1).padStart(2, '0')}`;
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : def;
  const [y, m] = ym.split('-').map(Number);
  const from = ymd(y, m, 1), to = ymd(y, m, daysInMonth(y, m));
  const [hopes, [sub], [period]] = await Promise.all([
    sql<{ work_date: string; start_min: number; end_min: number }[]>`select work_date, start_min, end_min from shift_hopes where staff_id = ${u.id} and work_date between ${from} and ${to}`,
    sql<{ submitted_at: Date }[]>`select submitted_at from hope_submissions where staff_id = ${u.id} and year = ${y} and month = ${m}`,
    sql<{ hope_deadline: string | null; status: string }[]>`select hope_deadline, status from shift_periods where store_id = ${u.store_id ?? 0} and year = ${y} and month = ${m}`,
  ]);
  const locked = !!period?.hope_deadline && now > period.hope_deadline;
  const months = [0, 1, 2].map((i) => { const mm = ((cm - 1 + i) % 12) + 1, yy = cy + Math.floor((cm - 1 + i) / 12); return `${yy}-${String(mm).padStart(2, '0')}`; });
  return (
    <div className="narrow">
      <div className="row" style={{ marginBottom: 12 }}>
        {months.map((x) => <Link key={x} className={`btn${x === ym ? ' primary' : ''}`} href={`/me/hopes?ym=${x}`}>{Number(x.slice(5))}月分</Link>)}
      </div>
      <div className={`banner${sub ? '' : ' warn'}`}>
        <span>
          {sub ? <b>提出済み</b> : <b>{m}月のシフト希望{period?.hope_deadline ? `を ${Number(period.hope_deadline.slice(5, 7))}月${Number(period.hope_deadline.slice(8))}日までに` : 'を'}提出してください</b>}
          {sub && period?.hope_deadline && !locked && `　締切（${Number(period.hope_deadline.slice(5, 7))}/${Number(period.hope_deadline.slice(8))}）までは何度でも直せます。`}
          <br />出勤できる日だけ「＋ 時間を入れる」を押して時間を指定してください。何も入れない日は出勤しない日になります。
        </span>
      </div>
      {locked ? <div className="empty"><b>締切を過ぎました</b>変更したいときは店長に相談してください。</div>
        : <HopeForm year={y} month={m} initial={hopes.map((h) => ({ date: h.work_date, start: h.start_min, end: h.end_min }))} submitted={!!sub} />}
    </div>
  );
}
