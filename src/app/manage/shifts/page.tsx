import Link from 'next/link';
import { listStores, monthBundle } from '@/lib/data';
import { jstParts } from '@/lib/time';
import { ShiftBoard } from './ShiftBoard';

export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ ym?: string; store?: string }> }) {
  const sp = await searchParams;
  const stores = await listStores();
  if (!stores.length) return <div className="empty"><b>店舗が登録されていません</b><Link href="/manage/settings">店舗・端末</Link>で店舗を登録してください。</div>;
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const now = jstParts().date;
  const [cy, cm] = now.split('-').map(Number);
  const def = cm === 12 ? `${cy + 1}-01` : `${cy}-${String(cm + 1).padStart(2, '0')}`;
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : def;
  const [y, m] = ym.split('-').map(Number);
  const b = await monthBundle(store.id, y, m);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return (
    <>
      <div className="ph">
        <div className="chips">
          {stores.length > 1 && stores.map((s) => <Link key={s.id} className={`btn${s.id === store.id ? ' primary' : ''}`} href={`/manage/shifts?store=${s.id}&ym=${ym}`}>{s.name}</Link>)}
        </div>
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={`/manage/shifts?store=${store.id}&ym=${prev}`} aria-label="前の月">‹</Link>
          <b className="num">{y}年{m}月</b>
          <Link className="btn" href={`/manage/shifts?store=${store.id}&ym=${next}`} aria-label="次の月">›</Link>
        </div>
      </div>
      <ShiftBoard
        key={`${store.id}-${ym}`}
        store={{ id: store.id, name: store.name, budget: [store.budget_weekday, store.budget_friday, store.budget_weekend] }}
        year={y} month={m}
        status={b.period?.status ?? 'draft'}
        staff={b.staff.map((s) => ({ id: s.id, name: s.name, employment: s.employment, transport: s.transport_per_day }))}
        rates={b.rates}
        minWages={b.minWages}
        drafts={b.drafts}
        published={b.published}
        hopes={b.hopes}
        submitted={b.subs.map((x) => x.staff_id)}
        budgets={b.budgets}
      />
    </>
  );
}
