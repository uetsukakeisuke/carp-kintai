import Link from 'next/link';
import { reportData } from '@/lib/report';
import { reportGross } from '@/lib/calc';
import { jstParts, yen, dateLabel } from '@/lib/time';
import { sql } from '@/lib/db';

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const sp = await searchParams;
  const now = jstParts().date;
  const [cy, cm] = now.split('-').map(Number);
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : now.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const { rows, warnings, header } = await reportData(y, m);
  const [{ report_email }] = await sql<{ report_email: string }[]>`select report_email from settings where id = 1`;
  const months = [-2, -1, 0].map((i) => { const t = cm - 1 + i, yy = cy + Math.floor(t / 12), mm = ((t % 12) + 12) % 12 + 1; return `${yy}-${String(mm).padStart(2, '0')}`; });
  const total = rows.reduce((a, r) => a + reportGross(r), 0);
  const hm = (x: number) => `${Math.floor(x / 60)}時間${String(x % 60).padStart(2, '0')}分`;
  return (
    <>
      <div className="banner"><span><b>税理士事務所への給与報告</b>　打刻の実績から、いつもの「給与報告フォーム」をそのままの書式で作成します。締日の翌日以降に出力し、{report_email} に送ってください。</span></div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {months.map((x) => <Link key={x} className={`btn${x === ym ? ' primary' : ''}`} href={`/manage/report?ym=${x}`}>{Number(x.slice(5))}月分</Link>)}
      </div>
      <div className="card" style={{ marginBottom: 14, display: 'grid', gap: 10 }}>
        <div className="kv">
          <div><span>対象</span><b>{m}月{header.last}日締</b></div>
          <div><span>支給日</span><b>{header.payM}月{header.payD}日</b></div>
          <div><span>行数</span><b>{rows.length}行</b></div>
          <div><span>総支給額の見込み</span><b>{yen(total)}</b></div>
        </div>
        {rows.length ? <a className="btn primary" href={`/api/report?ym=${ym}`}>給与報告フォーム（Excel）を出力</a> : <span className="btn" aria-disabled="true">この月の勤務実績はまだありません</span>}
      </div>
      {warnings.length > 0 && <div className="banner warn"><span><b>退勤の打刻がない勤務が{warnings.length}件あり、報告から除いています。</b>　「勤怠実績」で修正申請を承認してから出力してください：{warnings.slice(0, 6).map((w) => `${w.name} ${dateLabel(w.date)}`).join('、')}{warnings.length > 6 ? ' ほか' : ''}</span></div>}
      <div className="grid-wrap"><table className="tbl stack dense" style={{ minWidth: 820 }}>
        <thead><tr><th>所属</th><th>氏名</th><th>出勤日数</th><th>勤務時間</th><th>残業時間</th><th>時給</th><th>深夜手当</th><th>通勤手当日額</th><th>総支給額（見込み）</th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}><td data-label="所属" className="pc-only">{r.store}</td><td className="head"><b>{r.name}</b></td><td data-label="出勤日数" className="num">{r.days}日</td><td data-label="勤務時間" className="num">{hm(r.regularMin)}</td><td data-label="残業時間" className={`num${r.overtimeMin ? '' : ' hide-sp'}`}>{r.overtimeMin ? hm(r.overtimeMin) : '—'}</td><td data-label="時給" className="num">{yen(r.hourly)}</td><td data-label="深夜手当" className={`num${r.nightPay ? '' : ' hide-sp'}`}>{r.nightPay ? yen(r.nightPay) : '—'}</td><td data-label="通勤手当日額" className={`num${r.transport ? '' : ' hide-sp'}`}>{r.transport ? yen(r.transport) : '—'}</td><td data-label="総支給額（見込み）" className="num amt"><b>{yen(reportGross(r))}</b></td></tr>)}
          {!rows.length && <tr><td colSpan={9} className="sub">この月の勤務実績はまだありません</td></tr>}
        </tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 12 }}>勤務時間は1日8時間までを「勤務時間」、超えた分を「残業時間」に入れます。深夜手当は22時以降の実働×時給×25%です。月の途中で時給が変わった人は時給ごとに行を分けます。基本給・時間外手当・総支給額はフォームの計算式で計算されます。社員欄（上塚社長：社会保険「無」）はひな形のままです。</p>
    </>
  );
}
