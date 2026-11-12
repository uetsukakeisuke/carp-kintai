import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { jstParts } from '@/lib/time';
import { sql } from '@/lib/db';
import { lastTravelDefaults, monthData, monthList } from '@/lib/expenses-data';
import { MAX_ITEMS, expenseTotals, formNames, isYm, travelHasContent, travelTotals, ymLabel } from '@/lib/expenses';
import { ExpenseBoard, TravelBoard } from './ExpenseAdmin';

export const dynamic = 'force-dynamic';

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const shift = (k: string, n: number) => { const [y, m] = k.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const u = await requireAdmin();
  const sp = await searchParams;
  const today = jstParts().date;
  const cur = today.slice(0, 7);
  const ym = isYm(sp.ym) ? sp.ym : cur;
  const [d, list, last, [{ pay_day }]] = await Promise.all([
    monthData(ym), monthList(), lastTravelDefaults(), sql<{ pay_day: number }[]>`select pay_day from settings where id = 1`,
  ]);
  const names = formNames(ym, pay_day);
  const cash = expenseTotals(d.items).total;
  const travel = d.travel && travelHasContent(d.travel) ? travelTotals(d.travel).net : 0;
  const others = list.filter((x) => (x.items || x.travel) && x.ym !== ym).slice(0, 8);
  const [, m] = ym.split('-').map(Number);

  return (
    <>
      <div className="ph">
        <span className="sub">立て替えた経費と出張の精算。{names.file} の「現金経費精算」「旅費精算」のシートに入ります</span>
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={`/manage/expenses?ym=${shift(ym, -1)}`} aria-label="前の月">‹</Link>
          <b className="num">{ymLabel(ym)}分</b>
          {ym <= cur ? <Link className="btn" href={`/manage/expenses?ym=${shift(ym, 1)}`} aria-label="次の月">›</Link> : <span className="btn" aria-disabled="true" style={{ opacity: .4 }}>›</span>}
        </div>
      </div>

      <section className="ex-sum-bar" aria-label="この月の精算額">
        <div><span>現金経費精算</span><b className="num">{yen(cash)}</b><small>{d.items.length}/{MAX_ITEMS}行</small></div>
        <div><span>旅費精算</span><b className="num">{yen(travel)}</b><small>{d.travel ? '1枚' : 'なし'}</small></div>
        <div className="tot"><span>{m}月分の精算額</span><b className="num">{yen(cash + travel)}</b></div>
        <Link className="btn" href={`/manage/report?ym=${ym}`}>給与報告フォームへ ›</Link>
      </section>

      <div className="ex-cols">
        <section className="card ex-sec" aria-labelledby="exH">
          <div className="item-h"><b id="exH">現金経費精算</b><span className="sub">{m}月度経費精算書</span></div>
          <ExpenseBoard ym={ym} today={today} items={d.items} month={d.month} defaultPerson={u.name} />
        </section>

        <section className="card ex-sec" aria-labelledby="trH">
          <div className="item-h"><b id="trH">旅費精算</b><span className="sub">1か月に1枚（その月の出張をまとめて）</span></div>
          <TravelBoard ym={ym} today={today} travel={d.travel} defaults={{ dept: last.dept, person: last.person || u.name, diem: last.diem, lodge: last.lodge }} />
        </section>
      </div>

      {others.length > 0 && (
        <nav className="ex-months" aria-label="入力のあるほかの月">
          <span className="sub">入力のあるほかの月：</span>
          {others.map((x) => (
            <Link key={x.ym} className="btn sm" href={`/manage/expenses?ym=${x.ym}`}>{ymLabel(x.ym)}<small className="num">{yen(x.total)}</small></Link>
          ))}
        </nav>
      )}
    </>
  );
}
