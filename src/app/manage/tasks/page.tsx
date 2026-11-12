import Link from 'next/link';
import { listStores, listStaff, publishedShifts } from '@/lib/data';
import { requireManager } from '@/lib/auth';
import { tasksForDay, leftovers, taskCounts, toItem, isDate } from '@/lib/tasks';
import { jstParts, addDays, weekday, WD, hm } from '@/lib/time';
import { TaskBoard } from './TaskBoard';

export const dynamic = 'force-dynamic';
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ d?: string; store?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const stores = await listStores();
  if (!stores.length) return <div className="empty"><b>店舗が登録されていません</b><Link href="/manage/settings">店舗・端末</Link>で店舗を登録してください。</div>;
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const today = jstParts().date;
  const date = isDate(sp.d) ? sp.d : today;
  const mon = addDays(date, -((weekday(date) + 6) % 7));
  const sun = addDays(mon, 6);
  const [tasks, shifts, staff, left, counts] = await Promise.all([
    tasksForDay(store.id, date), publishedShifts(date, date, { storeId: store.id }), listStaff({ storeId: store.id }),
    leftovers(store.id, date), taskCounts(store.id, mon, sun),
  ]);
  const name = new Map(staff.map((s) => [s.id, s.name]));
  // その日のシフトの人（開始が早い順）＋シフトはないが作業が入っている人
  const people: { id: number; name: string; shift: string | null }[] = shifts.map((s) => ({ id: s.staff_id, name: name.get(s.staff_id) ?? '（退職）', shift: `${hm(s.start_min)}〜${hm(s.end_min)}` }));
  for (const t of tasks) {
    if (t.staff_id !== null && !people.some((x) => x.id === t.staff_id)) people.push({ id: t.staff_id, name: t.staff_name ?? '（退職）', shift: null });
  }
  const q = (d: string) => `/manage/tasks?${stores.length > 1 ? `store=${store.id}&` : ''}d=${d}`;
  const week = Array.from({ length: 7 }, (_, i) => addDays(mon, i));

  return (
    <>
      <div className="ph">
        {stores.length > 1 && <div className="chips">{stores.map((s) => <Link key={s.id} className={`btn${s.id === store.id ? ' primary' : ''}`} href={`/manage/tasks?store=${s.id}&d=${date}`}>{s.name}</Link>)}</div>}
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={q(addDays(date, -1))} aria-label="前の日">‹</Link>
          <b className="num">{md(date)}（{WD[weekday(date)]}）</b>
          <Link className="btn" href={q(addDays(date, 1))} aria-label="次の日">›</Link>
          {date !== today && <Link className="btn" href={q(today)}>今日</Link>}
        </div>
      </div>
      <nav className="tk-week" aria-label="週の日付">
        <Link className="btn ghost" href={q(addDays(mon, -7))} aria-label="前の週">‹</Link>
        {week.map((d) => {
          const c = counts.find((x) => x.work_date === d), w = weekday(d);
          return (
            <Link key={d} href={q(d)} aria-current={d === date ? 'page' : undefined} className={`tk-day${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}${d === today ? ' today' : ''}`}>
              <small>{WD[w]}</small><b className="num">{Number(d.slice(8, 10))}</b>
              <i>{c ? (c.open ? `残${c.open}` : `${c.n}件`) : ''}</i>
            </Link>
          );
        })}
        <Link className="btn ghost" href={q(addDays(mon, 7))} aria-label="次の週">›</Link>
      </nav>
      {!shifts.length && <p className="sub" style={{ margin: '0 0 10px' }}>この日の公開済みのシフトはありません。「全体」や「ほかの人に作業を入れる」から入れられます。</p>}
      <TaskBoard key={`${store.id}-${date}`} storeId={store.id} date={date} today={today}
        items={tasks.map(toItem)} people={people} staff={staff.map((s) => ({ id: s.id, name: s.name }))} leftovers={left.map(toItem)} />
    </>
  );
}
