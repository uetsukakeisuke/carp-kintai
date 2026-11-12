import Link from 'next/link';
import { headers } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
import { jstParts } from '@/lib/time';
import { sql } from '@/lib/db';
import { expenseSecret, formSync, lastTravelDefaults, monthData, monthList, type FormResult } from '@/lib/expenses-data';
import { expenseTotals, formNames, isYm, travelHasContent, travelTotals, ymLabel } from '@/lib/expenses';
import { gasFormsScript } from '@/lib/gas-forms';
import { ScriptBox } from '../payslips/PayslipAdmin';
import { ExpenseBoard, TravelBoard, RotateExpenseSecret } from './ExpenseAdmin';

export const dynamic = 'force-dynamic';

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const dt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const shift = (k: string, n: number) => { const [y, m] = k.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const STATUS: Record<FormResult['status'], string> = {
  created: '新しく作りました', saved: '保存し直しました', unchanged: '変わりなし（保存済み）',
  edited: 'ドライブで直されているため、上書きしていません', exists: '同じ名前のファイルが前からあるため、保存していません', error: '保存できませんでした',
};

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const u = await requireAdmin();
  const sp = await searchParams;
  const today = jstParts().date;
  const cur = today.slice(0, 7);
  const ym = isYm(sp.ym) ? sp.ym : cur;
  const [d, list, secret, sync, last, [{ pay_day }]] = await Promise.all([
    monthData(ym), monthList(), expenseSecret(), formSync(), lastTravelDefaults(),
    sql<{ pay_day: number }[]>`select pay_day from settings where id = 1`,
  ]);
  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const names = formNames(ym, pay_day);
  const cash = expenseTotals(d.items).total;
  const travel = d.travel && travelHasContent(d.travel) ? travelTotals(d.travel).net : 0;
  const months = list.filter((x) => x.items || x.travel);
  const [, m] = ym.split('-').map(Number);
  const mine = sync?.results.find((r) => r.ym === ym);

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
          <div><span>旅費精算</span><b>{yen(travel)}</b></div>
          <div><span>精算する合計</span><b>{yen(cash + travel)}</b></div>
        </div>
        <a className="btn primary" href={`/api/report?ym=${ym}`} download>{names.file} を出力</a>
        <p className="sub" style={{ margin: 0 }}>
          {m}月分（{Number(names.payYm.slice(5))}月{pay_day}日支給）の給与報告フォームです。「給与報告」「現金経費精算」「旅費精算」のシートに、この月の内容が入ります。
        </p>
        {mine ? (
          <p className={mine.status === 'error' || mine.status === 'edited' || mine.status === 'exists' ? 'warn-t' : 'ok-t'} style={{ margin: 0, fontSize: 13 }}>
            ドライブ（給与報告／{mine.folder ?? names.folder}）：{STATUS[mine.status]}{mine.error ? `（${mine.error}）` : ''}　{dt(new Date(sync!.at))}
            {mine.url && <> <a href={mine.url} target="_blank" rel="noopener noreferrer">開く</a></>}
          </p>
        ) : sync ? (
          <p className="sub" style={{ margin: 0 }}>ドライブへの保存は、今月分と（支給日までは）先月分だけです。最後に動いた時刻：{dt(new Date(sync.at))}</p>
        ) : (
          <p className="sub" style={{ margin: 0 }}>下の「ドライブに毎月自動で保存する」を設定すると、このファイルがドライブの「給与報告／{names.folder}」に自動で保存されます。</p>
        )}
      </section>

      <section className="card ex-sec" aria-labelledby="exH">
        <div className="item-h"><b id="exH">現金経費精算</b><span className="sub">{m}月度経費精算書</span></div>
        <ExpenseBoard ym={ym} today={today} items={d.items} month={d.month} defaultPerson={u.name} />
      </section>

      <section className="card ex-sec" aria-labelledby="trH">
        <div className="item-h"><b id="trH">旅費精算</b><span className="sub">1か月に1枚（その月の出張をまとめて）</span></div>
        <TravelBoard ym={ym} today={today} travel={d.travel} defaults={{ dept: last.dept, person: last.person || u.name, diem: last.diem, lodge: last.lodge }} />
      </section>

      {months.length > 0 && (
        <section className="card ex-sec">
          <b>入力のある月</b>
          <div className="mlist" style={{ marginTop: 8 }}>
            {months.map((x) => (
              <div key={x.ym} className={`mrow${x.ym === ym ? ' on' : ''}`}>
                <Link href={`/manage/expenses?ym=${x.ym}`}><b>{ymLabel(x.ym)}分</b><span className="sub">経費 {x.items}件 {yen(x.total)}{x.travel ? '・旅費精算あり' : ''}</span></Link>
                <a className="btn" href={`/api/report?ym=${x.ym}`} download>{formNames(x.ym, pay_day).yymm}</a>
              </div>
            ))}
          </div>
        </section>
      )}

      <details className="card ex-sec ex-setup">
        <summary><b>ドライブに毎月自動で保存する</b>{sync ? <span className="ok-t">（設定済み）</span> : <span className="sub">（はじめに1回だけ）</span>}</summary>
        <p className="sub" style={{ margin: '8px 0 10px' }}>
          毎月の給与報告フォームを、マイドライブの「給与報告」フォルダの中の「{names.folder}」のようなフォルダに、「{names.file}」の名前で1時間ごとに保存します（数字は支給月）。
          新しい月になると、その月のファイルとフォルダを自動で作ります。中身が変わったときだけ保存し直し、ドライブで手で直したファイルや、前からある同じ名前のファイルは上書きしません。
        </p>
        <ol className="steps">
          <li>「給与報告」フォルダがある会社の Google アカウントで <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com（新しいプロジェクト）</a> を開く</li>
          <li>最初から入っている文字をすべて消し、下のスクリプトを「コピー」して貼り付け、保存（💾）</li>
          <li>上の関数の選択欄で <b>setup</b> を選んで「実行」→ Google の許可画面で「許可」（ドライブにファイルを作るための許可です）</li>
          <li>この画面を開き直すと、上に「ドライブ：新しく作りました」と出ます。以後は1時間ごとに保存されます</li>
        </ol>
        <div style={{ marginTop: 10 }}><ScriptBox code={gasFormsScript(appUrl, secret)} /></div>
        <p className="sub" style={{ margin: '8px 0 0' }}>スクリプトの中の合言葉（SECRET）は、給与報告フォーム（給与・経費の中身）を受け取るための鍵です。他の人に見せないでください。漏れたときは作り直して、スクリプトを貼り替えてください。</p>
        <div style={{ marginTop: 8 }}><RotateExpenseSecret /></div>
      </details>
    </div>
  );
}
