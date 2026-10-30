import Link from 'next/link';
import { listStores, monthBundle } from '@/lib/data';
import { jstParts } from '@/lib/time';
import { DeadlineForm } from './DeadlineForm';

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
  const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8))}`;
  const state = b.period?.hope_open && now < b.period.hope_open ? `受付前（${md(b.period.hope_open)}から）`
    : b.period?.hope_deadline && now > b.period.hope_deadline ? '締切済み' : '受付中';
  const notYet = b.staff.filter((s) => !b.subs.some((x) => x.staff_id === s.id));
  return (
    <>
      <div className="ph">
        <div className="chips">{stores.length > 1 && stores.map((s) => <Link key={s.id} className={`btn${s.id === store.id ? ' primary' : ''}`} href={`/manage/hopes?store=${s.id}&ym=${ym}`}>{s.name}</Link>)}</div>
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={`/manage/hopes?store=${store.id}&ym=${prev}`} aria-label="前の月">‹</Link>
          <b style={{ fontSize: 16 }}>{y}年{m}月分</b>
          <Link className="btn" href={`/manage/hopes?store=${store.id}&ym=${next}`} aria-label="次の月">›</Link>
        </div>
      </div>
      <div className="banner">
        <span><b>{m}月分のシフト希望</b>　<span className="stt">{state}</span>　提出 {b.staff.length - notYet.length}／{b.staff.length}名{notYet.length ? `（未提出：${notYet.map((s) => s.name).join('、')}）` : ''}</span>
        <DeadlineForm storeId={store.id} year={y} month={m} open={b.period?.hope_open ?? null} deadline={b.period?.hope_deadline ?? null} />
      </div>
      <div className="grid-wrap"><table className="tbl stack">
        <thead><tr><th>スタッフ・状況</th><th>出勤できる日</th><th>希望時間の合計</th></tr></thead>
        <tbody>
          {b.staff.map((s) => {
            const sub = b.subs.find((x) => x.staff_id === s.id);
            const hs = b.hopes.filter((h) => h.staff_id === s.id);
            const min = hs.reduce((a, h) => a + h.end_min - h.start_min, 0);
            return <tr key={s.id}><td className="head"><b>{s.name}</b>{" "}<span style={{ marginLeft: 'auto' }}>{sub ? <span className="stt s-done">提出済み</span> : <span className="stt s-missing">未提出</span>}</span></td><td data-label="出勤できる日" className="num">{sub ? `${hs.length}日` : '—'}</td><td data-label="希望時間の合計" className="num">{sub ? `${(min / 60).toFixed(1)}h` : '—'}</td></tr>;
          })}
        </tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 12 }}>受付開始日より前と締切日の翌日以降は、スタッフは希望を入力・変更できません（空欄なら制限なし）。未提出の人には口頭やLINEで声をかけてください（自動のお知らせは今後追加予定）。</p>
    </>
  );
}
