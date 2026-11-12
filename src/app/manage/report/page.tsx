import Link from 'next/link';
import { headers } from 'next/headers';
import { requireManager } from '@/lib/auth';
import { reportData } from '@/lib/report';
import { reportGross } from '@/lib/calc';
import { jstParts, yen, dateLabel } from '@/lib/time';
import { sql } from '@/lib/db';
import { expenseTotals, formNames, travelHasContent, travelTotals } from '@/lib/expenses';
import { expenseSecret, formSync, monthData, type FormResult } from '@/lib/expenses-data';
import { gasFormsScript } from '@/lib/gas-forms';
import { ScriptBox } from '../payslips/PayslipAdmin';
import { RotateExpenseSecret } from '../expenses/ExpenseAdmin';

const dt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const STATUS: Record<FormResult['status'], string> = {
  created: '新しく作りました', saved: '保存し直しました', unchanged: '保存済み（変わりなし）',
  edited: 'ドライブで直されているため、上書きしていません', exists: '同じ名前のファイルが前からあるため、保存していません', error: '保存できませんでした',
};

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const u = await requireManager();
  const admin = u.role === 'admin';
  const sp = await searchParams;
  const now = jstParts().date;
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : now.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const [{ rows, warnings, header }, [{ report_email }], exp, sync] = await Promise.all([
    reportData(y, m),
    sql<{ report_email: string }[]>`select report_email from settings where id = 1`,
    admin ? monthData(ym).catch(() => null) : Promise.resolve(null),
    admin ? formSync().catch(() => null) : Promise.resolve(null),
  ]);
  const shift = (k: string, n: number) => { const [yy, mm] = k.split('-').map(Number); const t = yy * 12 + (mm - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const cur = now.slice(0, 7);
  // 打刻がある月（＝報告を出せる月）の一覧。新しい順。
  const hist = await sql<{ ym: string; n: number }[]>`
    select to_char(work_date, 'YYYY-MM') as ym, count(distinct p.staff_id)::int as n
    from punches p join staff s on s.id = p.staff_id
    where not p.voided and s.pay_type = 'hourly' and work_date < ${now}
    group by 1 order by 1 desc limit 12`;
  const total = rows.reduce((a, r) => a + reportGross(r), 0);
  const hm = (x: number) => `${Math.floor(x / 60)}時間${String(x % 60).padStart(2, '0')}分`;
  const names = formNames(ym, header.payD);
  const cash = exp ? expenseTotals(exp.items).total : 0;
  const travel = exp?.travel && travelHasContent(exp.travel) ? travelTotals(exp.travel).net : 0;
  const mine = sync?.results.find((r) => r.ym === ym);
  const setup = admin ? { secret: await expenseSecret(), appUrl: await appUrlOf() } : null;

  return (
    <>
      <div className="ph">
        <span className="sub">税理士事務所に送る毎月の報告。数字は支給月です（{m}月分 → {names.yymm}）</span>
        <span className="grow" />
        <div className="monthnav">
          <Link className="btn" href={`/manage/report?ym=${shift(ym, -1)}`} aria-label="前の月">‹</Link>
          <b className="num">{y}年{m}月分</b>
          {ym < cur ? <Link className="btn" href={`/manage/report?ym=${shift(ym, 1)}`} aria-label="次の月">›</Link> : <span className="btn" aria-disabled="true" style={{ opacity: .4 }}>›</span>}
        </div>
      </div>

      <section className="card rp-main">
        <div className="rp-head">
          <div className="rp-file">
            <span className="rp-ic" aria-hidden="true">⇩</span>
            <div><b>{names.file}</b><span className="sub">{m}月{header.last}日締・{header.payM}月{header.payD}日支給　送り先：{report_email}</span></div>
          </div>
          <a className="btn primary rp-dl" href={`/api/report?ym=${ym}`} download>Excel を出力</a>
        </div>
        <div className="kv rp-kv">
          <div><span>給与（アルバイト）</span><b>{new Set(rows.map((r) => r.name)).size}人・{yen(total)}</b></div>
          {admin && <div><span>現金経費精算</span><b>{yen(cash)}</b></div>}
          {admin && <div><span>旅費精算</span><b>{yen(travel)}</b></div>}
          <div><span>入っているシート</span><b className="rp-sheets">給与報告・現金経費精算・旅費精算</b></div>
        </div>
        {admin ? (
          <p className="sub" style={{ margin: 0 }}>
            経費・旅費は <Link href={`/manage/expenses?ym=${ym}`}>経費・旅費精算</Link> で入れた内容が入ります。
            {mine
              ? <span className={mine.status === 'error' || mine.status === 'edited' || mine.status === 'exists' ? 'warn-t' : 'ok-t'}>　ドライブ（給与報告／{mine.folder ?? names.folder}）：{STATUS[mine.status]}（{dt(new Date(sync!.at))}）{mine.url && <> <a href={mine.url} target="_blank" rel="noopener noreferrer">開く</a></>}</span>
              : sync ? <>　ドライブへの保存は、今月分と（支給日までは）先月分です。</> : <>　下の「ドライブに毎月自動で保存する」を設定すると、ドライブにも自動で保存されます。</>}
          </p>
        ) : <p className="sub" style={{ margin: 0 }}>経費精算・旅費精算のシートは、上塚さんが出力したときだけ中身が入ります。</p>}
      </section>

      {warnings.length > 0 && <div className="banner warn"><span><b>退勤の打刻がない勤務が{warnings.length}件あり、報告から除いています。</b>　「勤怠実績」で修正申請を承認してから出力してください：{warnings.slice(0, 6).map((w) => `${w.name} ${dateLabel(w.date)}`).join('、')}{warnings.length > 6 ? ' ほか' : ''}</span></div>}

      <h2 className="sec">給与報告の中身<span className="sub">　{rows.length}行</span></h2>
      <div className="grid-wrap"><table className="tbl stack dense" style={{ minWidth: 820 }}>
        <thead><tr><th>所属</th><th>氏名</th><th>出勤日数</th><th>勤務時間</th><th>残業時間</th><th>時給</th><th>深夜手当</th><th>通勤手当日額</th><th>総支給額（見込み）</th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}><td data-label="所属" className="pc-only">{r.store}</td><td className="head"><b>{r.name}</b></td><td data-label="出勤日数" className="num">{r.days}日</td><td data-label="勤務時間" className="num">{hm(r.regularMin)}</td><td data-label="残業時間" className={`num${r.overtimeMin ? '' : ' hide-sp'}`}>{r.overtimeMin ? hm(r.overtimeMin) : '—'}</td><td data-label="時給" className="num">{yen(r.hourly)}</td><td data-label="深夜手当" className={`num${r.nightPay ? '' : ' hide-sp'}`}>{r.nightPay ? yen(r.nightPay) : '—'}</td><td data-label="通勤手当日額" className={`num${r.transport ? '' : ' hide-sp'}`}>{r.transport ? yen(r.transport) : '—'}</td><td data-label="総支給額（見込み）" className="num amt"><b>{yen(reportGross(r))}</b></td></tr>)}
          {!rows.length && <tr><td colSpan={9} className="sub">この月の勤務実績はまだありません</td></tr>}
        </tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 8 }}>勤務時間は1日8時間までを「勤務時間」、超えた分を「残業時間」に入れます。深夜手当は22時以降の実働×時給×25%です。月の途中で時給が変わった人は時給ごとに行を分けます。基本給・時間外手当・総支給額はフォームの計算式で計算されます。社員欄（上塚社長：社会保険「無」）はひな形のままです。</p>

      <div className="rp-bottom">
        {hist.length > 0 && (
          <section className="card">
            <b>月ごとの給与報告フォーム</b>
            <p className="sub" style={{ margin: '2px 0 8px' }}>修正申請を承認したあとに出し直すと、修正後の内容になります。</p>
            <div className="mlist">
              {hist.map((h) => {
                const [hy, hmm] = h.ym.split('-').map(Number);
                const n = formNames(h.ym, header.payD);
                return (
                  <div key={h.ym} className={`mrow${h.ym === ym ? ' on' : ''}`}>
                    <Link href={`/manage/report?ym=${h.ym}`}><b>{hy}年{hmm}月分</b><span className="sub">{n.file}・{h.n}人</span></Link>
                    <a className="btn" href={`/api/report?ym=${h.ym}`} download aria-label={`${n.file}を出力`}>⇩</a>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {setup && (
          <details className="card ex-setup">
            <summary><b>ドライブに毎月自動で保存する</b>{sync ? <span className="ok-t">（設定済み）</span> : <span className="sub">（はじめに1回だけ）</span>}</summary>
            <p className="sub" style={{ margin: '8px 0 10px' }}>
              マイドライブの「給与報告」フォルダの中の「{names.folder}」のようなフォルダに、「{names.file}」の名前で1時間ごとに保存します。
              新しい月になると、その月のフォルダとファイルを自動で作ります。中身が変わったときだけ保存し直し、ドライブで手で直したファイルや、前からある同じ名前のファイルは上書きしません。
            </p>
            <ol className="steps">
              <li>「給与報告」フォルダがある会社の Google アカウントで <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com（新しいプロジェクト）</a> を開く</li>
              <li>最初から入っている文字をすべて消し、下のスクリプトを「コピー」して貼り付け、保存（💾）</li>
              <li>上の関数の選択欄で <b>setup</b> を選んで「実行」→ Google の許可画面で「許可」（ドライブにファイルを作るための許可です）</li>
              <li>この画面を開き直すと「ドライブ：新しく作りました」と出ます。以後は1時間ごとに保存されます</li>
            </ol>
            <div style={{ marginTop: 10 }}><ScriptBox code={gasFormsScript(setup.appUrl, setup.secret)} /></div>
            <p className="sub" style={{ margin: '8px 0 0' }}>スクリプトの中の合言葉（SECRET）は、給与報告フォーム（給与・経費の中身）を受け取るための鍵です。他の人に見せないでください。漏れたときは作り直して、スクリプトを貼り替えてください。</p>
            <div style={{ marginTop: 8 }}><RotateExpenseSecret /></div>
          </details>
        )}
      </div>
    </>
  );
}

async function appUrlOf() {
  const h = await headers();
  return `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
}
