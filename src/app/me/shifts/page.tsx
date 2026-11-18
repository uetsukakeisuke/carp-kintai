import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listStaff, listStores, publishedShifts } from '@/lib/data';
import { sql } from '@/lib/db';
import { jstParts, daysInMonth, ymd, weekday, WD, hshort, dateLabel, hm } from '@/lib/time';
import { Timeline } from '@/components/Timeline';
import { partsText, isSplit } from '@/lib/shift-parts';
import { listSlots, listNotices, slotsReady, unseenNotices } from '@/lib/slots';
import { filled, inSlot } from '@/lib/slot-rules';
import { Notices, DaySlots, MyShiftEdit, SeenMarker } from './SelfShift';

export default async function AllShiftsPage({ searchParams }: { searchParams: Promise<{ ym?: string; d?: string; store?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const now = jstParts().date;
  const stores = await listStores();
  const storeId = Number(sp.store) || u.store_id || stores[0]?.id;
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : now.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const nd = daysInMonth(y, m), from = ymd(y, m, 1), to = ymd(y, m, nd);
  const own = storeId === u.store_id; // 自分の店舗だけ、入る・変える・やめるができる
  const [rows, staff, [period], ready, slots, notices, unseen, [seen]] = await Promise.all([
    publishedShifts(from, to, { storeId }),
    listStaff({ storeId }),
    sql<{ status: string }[]>`select status from shift_periods where store_id = ${storeId} and year = ${y} and month = ${m}`,
    slotsReady(),
    listSlots(storeId, from, to),
    own ? listNotices(storeId, u.id) : Promise.resolve([]),
    own ? unseenNotices(u.id, storeId) : Promise.resolve(0),
    sql<{ at: Date | null }[]>`select (to_jsonb(s)->>'notice_seen_at')::timestamptz as at from staff s where id = ${u.id}`,
  ]);
  const seenAt = seen?.at ? new Date(seen.at).getTime() : 0;
  // 同じ枠のお知らせは新しい1件だけ。埋まった・なくなった枠は、まだ見ていないときだけ出す
  const noticeView = notices
    .map((n) => ({ id: n.id, slotId: n.slot_id, date: n.work_date, start: n.start_min, end: n.end_min, label: n.label, open: n.open, mine: n.mine, isNew: !n.mine && new Date(n.created_at).getTime() > seenAt }))
    .filter((n, i, a) => a.findIndex((x) => (x.slotId ?? -x.id) === (n.slotId ?? -n.id)) === i)
    .filter((n) => (n.open ?? 0) > 0 || n.isNew)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  const open = !!period && period.status !== 'draft'; // 公開済みの月だけ、自分で変えられる
  const sel = sp.d && sp.d.startsWith(ym) ? sp.d : now.startsWith(ym) ? now : from;
  const name = (id: number) => staff.find((s) => s.id === id)?.name ?? '（他店舗）';
  const dayRows = rows.filter((r) => r.work_date === sel).map((r) => ({ id: r.staff_id, name: name(r.staff_id), start: r.start_min, end: r.end_min, parts: r.parts }));
  const mine = rows.filter((r) => r.staff_id === u.id);
  const editable = ready && own && open;
  const dayShifts = rows.filter((r) => r.work_date === sel).map((r) => ({ start: r.start_min, end: r.end_min, parts: r.parts }));
  const meSel = rows.find((r) => r.staff_id === u.id && r.work_date === sel);
  const daySlots = slots.filter((x) => x.work_date === sel).map((x) => ({
    id: x.id, start: x.start_min, end: x.end_min, label: x.label, capacity: x.capacity, filled: filled(x, dayShifts),
    meIn: !!meSel && inSlot({ start: meSel.start_min, end: meSel.end_min, parts: meSel.parts }, x),
  }));
  // 自分の出勤の日の、その日に入っている枠の名前（例：出荷）
  const labelOf = (d: string, r: { start_min: number; end_min: number; parts?: typeof rows[number]['parts'] }) =>
    [...new Set(slots.filter((x) => x.work_date === d && x.label && inSlot({ start: r.start_min, end: r.end_min, parts: r.parts }, x)).map((x) => x.label))].join('・');
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
        {own && <SeenMarker unseen={unseen} />}
        {own && <Notices myDates={mine.map((r) => r.work_date)} items={noticeView} />}
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
              <Timeline rows={dayRows} meId={u.id} />
              <DaySlots slots={daySlots} past={sel <= now} canAdd={editable && !meSel} /></div>
            <h2 className="sec">自分の{m}月の出勤（{mine.length}日）</h2>
            <div className="grid-wrap"><table className="tbl"><tbody>
              {mine.map((r) => {
                const t = isSplit(r.parts) ? partsText(r.parts) : `${hm(r.start_min)}〜${hm(r.end_min)}`, lb = labelOf(r.work_date, r);
                return (
                  <tr key={r.work_date}>
                    <td>{dateLabel(r.work_date)}{lb && <> <span className="nchip">{lb}</span></>}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{t}
                      {editable && r.work_date > now && <MyShiftEdit date={r.work_date} start={r.start_min} end={r.end_min} label={t} />}</td>
                  </tr>
                );
              })}
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
                  {Array.from({ length: nd }, (_, i) => { const k = ymd(y, m, i + 1); const r = rows.find((x) => x.staff_id === s.id && x.work_date === k); return <td key={k} className="c" style={{ height: 40 }}>{r && <span className="chip" title={isSplit(r.parts) ? partsText(r.parts) : undefined} style={{ margin: '6px 4px', background: s.id === u.id ? 'var(--ok)' : undefined, outline: isSplit(r.parts) ? '1.5px dashed var(--accent)' : undefined }}>{hshort(r.start_min)}-{hshort(r.end_min)}</span>}</td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub" style={{ marginTop: 12 }}>スタッフ画面では時給や人件費は表示されません。
        {editable ? '明日以降の自分のシフトは「変更」「やめる」で変えられます（時間は午前 → 午後の向きだけ・空きのある枠の中だけ）。当日の変更は店長に連絡してください。' : 'シフトの変更は店長に連絡してください。'}</p>
    </div>
  );
}
