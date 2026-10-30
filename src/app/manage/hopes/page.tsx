import Link from 'next/link';
import { listStores, monthBundle } from '@/lib/data';
import { jstParts } from '@/lib/time';
import { HopeBoard } from './HopeBoard';

export default async function HopeStatusPage({ searchParams }: { searchParams: Promise<{ ym?: string; store?: string }> }) {
  const sp = await searchParams;
  const stores = await listStores();
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  if (!store) return null;
  const now = jstParts().date;
  const [cy, cm] = now.split('-').map(Number);
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : cm === 12 ? `${cy + 1}-01` : `${cy}-${String(cm + 1).padStart(2, '0')}`;
  const [y, m] = ym.split('-').map(Number);
  const b = await monthBundle(store.id, y, m);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  // 月給の人（役員など）はシフト希望を出さないので対象外
  const staff = b.staff.filter((s) => s.pay_type !== 'monthly');
  const ids = new Set(staff.map((s) => s.id));
  return (
    <>
      <div className="ph">
        {stores.length > 1 && <div className="chips">{stores.map((s) => <Link key={s.id} className={`btn${s.id === store.id ? ' primary' : ''}`} href={`/manage/hopes?store=${s.id}&ym=${ym}`}>{s.name}</Link>)}</div>}
        <h1>{m}月分のシフト希望</h1>
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={`/manage/hopes?store=${store.id}&ym=${prev}`} aria-label="前の月">‹</Link>
          <b className="num">{y}年{m}月</b>
          <Link className="btn" href={`/manage/hopes?store=${store.id}&ym=${next}`} aria-label="次の月">›</Link>
        </div>
      </div>
      <HopeBoard
        key={`${store.id}-${ym}`}
        storeId={store.id} year={y} month={m} today={now}
        open={b.period?.hope_open ?? null} deadline={b.period?.hope_deadline ?? null}
        staff={staff.map((s) => ({ id: s.id, name: s.name }))}
        hopes={b.hopes.filter((h) => ids.has(h.staff_id))}
        subs={b.subs.filter((x) => ids.has(x.staff_id)).map((x) => ({ staff_id: x.staff_id, submitted_at: jstParts(new Date(x.submitted_at)).date }))}
      />
    </>
  );
}
