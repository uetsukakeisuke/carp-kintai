import Link from 'next/link';
import { headers } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
import { jstParts } from '@/lib/time';
import { expenseSecret, lastPull, lastTripDefaults, monthData, monthList } from '@/lib/expenses-data';
import { expenseTotals, isYm, tripTotals, ymLabel } from '@/lib/expenses';
import { gasExpenseScript } from '@/lib/gas-expense';
import { ScriptBox } from '../payslips/PayslipAdmin';
import { ExpenseBoard, TripList, RotateExpenseSecret } from './ExpenseAdmin';

export const dynamic = 'force-dynamic';

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const dt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const shift = (k: string, n: number) => { const [y, m] = k.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const u = await requireAdmin();
  const sp = await searchParams;
  const today = jstParts().date;
  const cur = today.slice(0, 7);
  const ym = isYm(sp.ym) ? sp.ym : cur;
  const [d, list, secret, pulled, last] = await Promise.all([monthData(ym), monthList(), expenseSecret(), lastPull(), lastTripDefaults()]);
  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const cash = expenseTotals(d.items).total;
  const travel = d.trips.reduce((a, t) => a + tripTotals(t).net, 0);
  const months = list.filter((x) => x.items || x.trips);
  const [, m] = ym.split('-').map(Number);

  return (
    <div className="narrow ex-page">
      <div className="ph" style={{ marginBottom: 10 }}>
        <h1>経費精算・旅費精算</h1>
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={`/manage/expenses?ym=${shift(ym, -1)}`} aria-label="前の月">‹</Link>
          <b className="num">{ymLabel(ym)}分</b>
          {ym <= cur ? <Link className="btn" href={`/manage/expenses?ym=${shift(ym, 1)}`} aria-label="次の月">›</Link> : <span className="btn" aria-disabled="true" style={{ opacity: .4 }}>›</span>}
        </div>
      </div>

      <section className="card ex-top">
        <div className="kv">
          <div><span>現金経費精算</span><b>{yen(cash)}</b></div>
          <div><span>旅費精算（{d.trips.length}枚）</span><b>{yen(travel)}</b></div>
          <div><span>精算する合計</span><b>{yen(cash + travel)}</b></div>
        </div>
        <a className="btn primary" href={`/api/report?ym=${ym}`} download>給与報告フォーム（Excel）に入れて出力</a>
        <p className="sub" style={{ margin: 0 }}>
          Excel の「現金経費精算」「旅費精算」のシートに、この月の内容が入ります（旅費精算が2枚以上ならシートも増えます）。
          {pulled ? <> 専用スプレッドシート：最後に反映 {dt(pulled)}（10分ごと）</> : <> 専用スプレッドシートには、下の「スプレッドシートとつなぐ」から反映できます。</>}
        </p>
      </section>

      <section className="card ex-sec" aria-labelledby="exH">
        <div className="item-h"><b id="exH">現金経費精算</b><span className="sub">{m}月度経費精算書</span></div>
        <ExpenseBoard ym={ym} today={today} items={d.items} month={d.month} defaultPerson={u.name} />
      </section>

      <section className="card ex-sec" aria-labelledby="trH">
        <div className="item-h"><b id="trH">旅費精算</b><span className="sub">出張1回で1枚</span></div>
        <TripList ym={ym} today={today} trips={d.trips} defaults={{ dept: last.dept, person: last.person || u.name }} />
      </section>

      {months.length > 0 && (
        <section className="card ex-sec">
          <b>入力のある月</b>
          <div className="mlist" style={{ marginTop: 8 }}>
            {months.map((x) => (
              <div key={x.ym} className={`mrow${x.ym === ym ? ' on' : ''}`}>
                <Link href={`/manage/expenses?ym=${x.ym}`}><b>{ymLabel(x.ym)}分</b><span className="sub">経費 {x.items}件 {yen(x.total)}{x.trips ? `・旅費精算 ${x.trips}枚` : ''}</span></Link>
                <a className="btn" href={`/api/report?ym=${x.ym}`} download>Excel</a>
              </div>
            ))}
          </div>
        </section>
      )}

      <details className="card ex-sec ex-setup">
        <summary><b>スプレッドシートとつなぐ</b>{pulled ? <span className="ok-t">（つないであります）</span> : <span className="sub">（はじめに1回だけ）</span>}</summary>
        <p className="sub" style={{ margin: '8px 0 10px' }}>
          経費精算・旅費精算の専用スプレッドシートを作り、アプリで入れた内容を10分ごとに書き込みます。月ごとにタブができます（例：2026年11月 現金経費精算）。
          スプレッドシートはアプリの内容で上書きされるので、直すときはアプリで直してください。
        </p>
        <ol className="steps">
          <li>Google ドライブで、新しいスプレッドシートを作る（名前の例：経費精算（カープ勤怠））</li>
          <li>いま使っている「給与報告フォーム」のスプレッドシートを開き、下の「現金経費精算」タブを右クリック →「コピー先」→「既存のスプレッドシート」→ 1 で作ったものを選ぶ。「旅費精算」タブも同じようにコピー（これが書式のひな形になります）</li>
          <li>1 のスプレッドシートで「拡張機能」→「Apps Script」を開き、最初から入っている文字をすべて消して、下のスクリプトを「コピー」して貼り付け、保存（💾）</li>
          <li>上の関数の選択欄で <b>setup</b> を選んで「実行」→ Google の許可画面で「許可」</li>
          <li>スプレッドシートに戻ると、入力のある月のタブができています。上のメニュー「カープ勤怠」→「今すぐ反映」で、すぐに反映することもできます</li>
        </ol>
        <div style={{ marginTop: 10 }}><ScriptBox code={gasExpenseScript(appUrl, secret)} /></div>
        <p className="sub" style={{ margin: '8px 0 0' }}>スクリプトの中の合言葉（SECRET）は、経費精算・旅費精算を読むための鍵です。このスプレッドシートを編集できる人には見えるので、編集の共有は必要な人だけにしてください。漏れたときは作り直して、スクリプトを貼り替えてください。</p>
        <div style={{ marginTop: 8 }}><RotateExpenseSecret /></div>
      </details>
    </div>
  );
}
