import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { listStores, listStaff, publishedShifts } from '@/lib/data';
import { listSlots, recentChanges, slotsReady } from '@/lib/slots';
import { filled, inSlot } from '@/lib/slot-rules';
import { jstParts, daysInMonth, ymd, dateLabel, hm } from '@/lib/time';
import { sql } from '@/lib/db';
import { SlotBoard, type DayInfo } from './SlotBoard';
import { ledgerBrief } from '@/lib/brief-data';
import { tasksOfStore } from '@/lib/tasks';

export default async function SlotsPage({ searchParams }: { searchParams: Promise<{ ym?: string; store?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const stores = await listStores();
  if (!stores.length) return <div className="empty"><b>店舗が登録されていません</b><Link href="/manage/settings">店舗・端末</Link>で店舗を登録してください。</div>;
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const now = jstParts().date;
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : now.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const from = ymd(y, m, 1), to = ymd(y, m, daysInMonth(y, m));
  const [ready, slots, shifts, staff, changes, [period], ledger, tasks] = await Promise.all([
    slotsReady(), listSlots(store.id, from, to), publishedShifts(from, to, { storeId: store.id }), listStaff({ storeId: store.id }), recentChanges(store.id, 60),
    sql<{ status: string }[]>`select status from shift_periods where store_id = ${store.id} and year = ${y} and month = ${m}`,
    ledgerBrief(), tasksOfStore(store.id, from, to),
  ]);
  // 日ごとの入荷・出荷（受発注台帳。今日以降）と予定表のやること（枠を作るときに見る）
  const info: Record<string, DayInfo> = {};
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const k = ymd(y, m, d);
    const b = k >= now ? ledger?.byDate.get(k) : undefined;
    const ts = tasks.filter((t) => t.work_date === k).map((t) => ({ title: t.title, at: t.at_min, who: t.staff_name, note: t.kind === 'note', done: !!t.done_at }));
    if ((b && (b.ins.length || b.outs.length)) || ts.length) info[k] = { brief: b && (b.ins.length || b.outs.length) ? b : null, tasks: ts };
  }
  const name = (id: number) => staff.find((s) => s.id === id)?.name ?? '（他店舗）';
  const view = slots.map((s) => {
    const day = shifts.filter((r) => r.work_date === s.work_date);
    const inn = day.filter((r) => inSlot({ start: r.start_min, end: r.end_min, parts: r.parts }, s));
    return { id: s.id, date: s.work_date, start: s.start_min, end: s.end_min, capacity: s.capacity, label: s.label,
      filled: filled(s, day.map((r) => ({ start: r.start_min, end: r.end_min, parts: r.parts }))), names: inn.map((r) => name(r.staff_id)) };
  });
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const t = (c: { start: number; end: number } | null) => (c ? `${hm(c.start)}〜${hm(c.end)}` : '');
  return (
    <>
      <div className="ph">
        <div className="chips">{stores.length > 1 && stores.map((s) => <Link key={s.id} className={`btn${s.id === store.id ? ' primary' : ''}`} href={`/manage/slots?store=${s.id}&ym=${ym}`}>{s.name}</Link>)}</div>
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={`/manage/slots?store=${store.id}&ym=${prev}`} aria-label="前の月">‹</Link>
          <b className="num">{y}年{m}月</b>
          <Link className="btn" href={`/manage/slots?store=${store.id}&ym=${next}`} aria-label="次の月">›</Link>
        </div>
      </div>
      {!ready ? (
        <div className="banner warn"><span><b>データベースの準備がまだです。</b>　Supabase の SQL Editor で <code>db/update-2026-11-18-slots.sql</code> を実行すると、この画面が使えるようになります。</span></div>
      ) : (
        <>
          <p className="sub" style={{ marginTop: 0 }}>
            日ごと・時間帯ごとに「何人まで」の枠を作ると、スタッフはシフトが公開された月の明日以降について、自分で <b>空きのある枠に入る・時間を後ろへ変える（午前 → 午後）・やめる</b> ができます。
            やめて空きが出ると、スタッフ全員のシフト表に「空きが出ました」と出ます。変更はすぐシフト（公開済み・下書きの両方）に入り、下の「スタッフによる変更」に残ります。
          </p>
          {(!period || period.status === 'draft') && <div className="banner warn"><span>{m}月のシフトはまだ公開されていません。公開するまで、スタッフは自分で変えられません（枠は先に作っておけます）。</span></div>}
          <SlotBoard storeId={store.id} year={y} month={m} slots={view} info={info} ledgerAt={ledger ? ledger.at.toISOString() : null} today={now} />
        </>
      )}
      {ready && (
        <>
          <h2 className="sec">スタッフによる変更（新しい順）</h2>
          <div className="grid-wrap"><table className="tbl stack"><tbody>
            {changes.map((c) => (
              <tr key={c.id}>
                <td className="head"><b>{c.staff_name}</b> <span className="sub">{dateLabel(c.work_date)} のシフト</span></td>
                <td data-label="内容"><span>
                  {c.action === 'add' ? <><b className="ok-t">入った</b> <span className="num">{t(c.after)}</span></>
                    : c.action === 'delete' ? <><b className="bad-t">やめた</b> <span className="num">{t(c.before)}</span></>
                    : <><b>変更</b> <span className="num">{t(c.before)} → {t(c.after)}</span></>}
                </span></td>
                <td data-label="日時" className="sub num" style={{ textAlign: 'right' }}>{new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(c.created_at))}</td>
              </tr>
            ))}
            {!changes.length && <tr><td className="sub">まだありません</td></tr>}
          </tbody></table></div>
        </>
      )}
    </>
  );
}
