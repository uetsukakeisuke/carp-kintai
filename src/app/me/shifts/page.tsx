import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listStaff, listStores, publishedShifts } from '@/lib/data';
import { sql } from '@/lib/db';
import { jstParts, daysInMonth, ymd, weekday, WD, hshort, dateLabel, hm } from '@/lib/time';
import { Timeline } from '@/components/Timeline';

export default async function AllShiftsPage({ searchParams }: { searchParams: Promise<{ ym?: string; d?: string; store?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const now = jstParts().date;
  const stores = await listStores();
  const storeId = Number(sp.store) || u.store_id || stores[0]?.id;
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : now.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const nd = daysInMonth(y, m), from = ymd(y, m, 1), to = ymd(y, m, nd);
  const [rows, staff, [period]] = await Promise.all([
    publishedShifts(from, to, { storeId }),
    listStaff({ storeId }),
    sql<{ status: string }[]>`select status from shift_periods where store_id = ${storeId} and year = ${y} and month = ${m}`,
  ]);
  const sel = sp.d && sp.d.startsWith(ym) ? sp.d : now.startsWith(ym) ? now : from;
  const name = (id: number) => staff.find((s) => s.id === id)?.name ?? '（他店舗）';
  const dayRows = rows.filter((r) => r.work_date === sel).map((r) => ({ id: r.staff_id, name: name(r.staff_id), start: r.start_min, end: r.end_min }));
  const mine = rows.filter((r) => r.staff_id === u.id);
  const q = (o: Record<string, string>) => '?' + new URLSearchParams({ ym, store: String(storeId), ...o }).toString();
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

  return (
    <div>
      <div className="narrow">
        <div className="calnav">
          <Link className="btn" href={`/me/shifts${q({ ym: prev })}`} aria-label="前の月">‹ 前月</Link>
          <h2>{y}年{m}月</h2>
          <Link className="btn" href={`/me/shifts${q({ ym: next })}`} aria-label="次の月">翌月 ›</Link>
        </div>
        {stores.length > 1 && <div className="chips" style={{ marginBottom: 10 }}>{stores.map((s) => <Link key={s.id} className={`btn${s.id === storeId ? ' primary' : ''}`} href={`/me/shifts?ym=${ym}&store=${s.id}`}>{s.name}</Link>)}</div>}
        {!rows.length ? (
          <div className="empty"><b>{m}月のシフトはまだ公開されていません</b>店長がシフトを確定すると、ここで全員のシフトを見られます。</div>
        ) : (
          <>
            {period?.status === 'changed' && <div className="banner warn"><span>店長がシフトを調整中です。公開されるとここに反映されます。</span></div>}
            <div className="daystrip">
              {Array.from({ length: nd }, (_, i) => ymd(y, m, i + 1)).map((k) => (
                <Link key={k} href={`/me/shifts${q({ d: k })}`} scroll={false} aria-current={k === sel ? 'true' : undefined}>
                  <b style={{ color: weekday(k) === 0 ? 'var(--sun)' : weekday(k) === 6 ? 'var(--sat)' : undefined }}>{Number(k.slice(8))}</b>
                  <small>{WD[weekday(k)]}</small>
                  <small style={{ color: 'var(--ok)', height: 14 }}>{mine.some((r) => r.work_date === k) ? '出勤' : ''}</small>
                </Link>
              ))}
            </div>
            <div className="card"><div className="row" style={{ marginBottom: 8 }}><b>{dateLabel(sel)} に出勤する人</b><span className="sub">{dayRows.length}人</span></div>
              <Timeline rows={dayRows} meId={u.id} /></div>
            <h2 className="sec">自分の{m}月の出勤（{mine.length}日）</h2>
            <div className="grid-wrap"><table className="tbl"><tbody>
              {mine.map((r) => <tr key={r.work_date}><td>{dateLabel(r.work_date)}</td><td className="num" style={{ textAlign: 'right' }}>{hm(r.start_min)}〜{hm(r.end_min)}</td></tr>)}
              {!mine.length && <tr><td className="sub">出勤予定はありません</td></tr>}
            </tbody></table></div>
            <h2 className="sec">月間一覧</h2>
          </>
        )}
      </div>
      {rows.length > 0 && (
        <div className="grid-wrap" style={{ maxHeight: '70vh' }}>
          <table className="sgrid">
            <thead><tr><th className="sc">スタッフ</th>{Array.from({ length: nd }, (_, i) => { const k = ymd(y, m, i + 1), w = weekday(k); return <th key={k} className={`dh${w === 6 ? ' sat' : w === 0 ? ' sun' : ''}`}><b>{i + 1}</b><small>{WD[w]}</small></th>; })}</tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} style={s.id === u.id ? { outline: '2px solid var(--ok)', outlineOffset: -2 } : undefined}>
                  <th className="sc staffc"><b>{s.name}{s.id === u.id ? '（自分）' : ''}</b></th>
                  {Array.from({ length: nd }, (_, i) => { const k = ymd(y, m, i + 1); const r = rows.find((x) => x.staff_id === s.id && x.work_date === k); return <td key={k} className="c" style={{ height: 40 }}>{r && <span className="chip" style={{ margin: '6px 4px', background: s.id === u.id ? 'var(--ok)' : undefined }}>{hshort(r.start_min)}-{hshort(r.end_min)}</span>}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub" style={{ marginTop: 12 }}>スタッフ画面では時給や人件費は表示されません。シフトの変更は店長だけができます。</p>
    </div>
  );
}
