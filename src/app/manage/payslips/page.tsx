import Link from 'next/link';
import { headers } from 'next/headers';
import { listStaff } from '@/lib/data';
import { payslipMonths, payslipsForMonth, payslipById, recentImports, getImportSecret } from '@/lib/payslips';
import { gasScript } from '@/lib/gas-script';
import { PayslipView } from '@/components/PayslipView';
import { UploadForm, ScriptBox, RotateSecret } from './PayslipAdmin';

export const dynamic = 'force-dynamic';
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const dt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

export default async function PayslipAdminPage({ searchParams }: { searchParams: Promise<{ ym?: string; id?: string }> }) {
  const sp = await searchParams;
  if (sp.id) {
    const slip = await payslipById(Number(sp.id));
    if (!slip) return <div className="empty"><b>明細が見つかりません</b><Link href="/manage/payslips">給与明細へ戻る</Link></div>;
    return (
      <div className="narrow">
        <p><Link href={`/manage/payslips?ym=${slip.work_year}-${String(slip.work_month).padStart(2, '0')}`}>‹ {slip.work_month}月分の一覧へ</Link></p>
        <PayslipView slip={slip} />
      </div>
    );
  }
  const [months, imports, staff, secret] = await Promise.all([payslipMonths(), recentImports(), listStaff(), getImportSecret(true)]);
  const sel = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : months[0] ? `${months[0].work_year}-${String(months[0].work_month).padStart(2, '0')}` : null;
  const [y, m] = sel ? sel.split('-').map(Number) : [0, 0];
  const slips = sel ? await payslipsForMonth(y, m) : [];
  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const lastGmail = imports.find((i) => i.source === 'gmail');
  const missing = staff.filter((s) => s.pay_type === 'hourly' && !slips.some((x) => x.staff_id === s.id));

  return (
    <>
      <div className="ph"><h1>給与明細</h1></div>


      <div className="chips" style={{ marginBottom: 12 }}>
        {months.map((x) => { const k = `${x.work_year}-${String(x.work_month).padStart(2, '0')}`; return <Link key={k} className={`btn${k === sel ? ' primary' : ''}`} href={`/manage/payslips?ym=${k}`}>{x.work_month}月分</Link>; })}
      </div>
      {sel ? (
        <div className="grid-wrap" style={{ marginBottom: 16 }}><table className="tbl stack dense">
          <thead><tr><th>スタッフ</th><th>総支給</th><th>控除</th><th>差引支給額</th><th /></tr></thead>
          <tbody>
            {slips.map((s) => (
              <tr key={s.id}>
                <td className="head"><b>{s.staff_name ?? s.slip_name}</b></td>
                <td data-label="総支給" className="num">{yen(s.gross)}</td>
                <td data-label="控除" className="num">{yen(s.deduction)}</td>
                <td data-label="差引" className="num amt"><b>{yen(s.net)}</b></td>
                <td className="acts" style={{ textAlign: 'right' }}><Link className="btn" href={`/manage/payslips?id=${s.id}`}>明細</Link></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : <div className="empty" style={{ marginBottom: 16 }}><b>まだ明細がありません</b>下の手順で Gmail と連携するか、PDFを取り込んでください。</div>}
      {sel && missing.length > 0 && <p className="sub" style={{ marginTop: -6 }}>この月の明細がない人：{missing.map((s) => s.name).join('、')}（その月に勤務がなかった場合など）</p>}

      <section className="card" style={{ marginBottom: 14 }}>
        <b>Gmail から自動で取り込む</b>
        <p className="sub" style={{ margin: '4px 0 10px' }}>
          {lastGmail ? `連携済み：最後に届いたのは ${dt(lastGmail.created_at)}` : 'まだ連携していません。最初に1回だけ、次の設定をしてください（5分ほど）。'}
        </p>
        <ol className="steps">
          <li>info@carpagency.net の Google アカウントで <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com（新しいプロジェクト）</a> を開く</li>
          <li>最初から入っている文字をすべて消し、下のスクリプトを「コピー」して貼り付け、保存（💾）</li>
          <li>上の関数の選択欄で <b>setup</b> を選んで「実行」→ Google の許可画面で「許可」</li>
          <li>以後、1時間ごとにアクトヴィジョンの「給与明細」メールを確認し、明細PDFを自動で取り込みます</li>
        </ol>
        <div style={{ marginTop: 10 }}><ScriptBox code={gasScript(appUrl, secret ?? '')} /></div>
        <p className="sub" style={{ margin: '8px 0 0' }}>スクリプトの中の合言葉（SECRET）は、このアプリに明細を送るための鍵です。他の人に見せないでください。漏れたときは作り直してください。</p>
        <div style={{ marginTop: 8 }}><RotateSecret /></div>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <b>PDFを手で取り込む</b>
        <p className="sub" style={{ margin: '4px 0 10px' }}>メールの「給与支給明細書」PDFを保存して選びます。同じ月をもう一度取り込むと上書きされます。</p>
        <UploadForm />
      </section>

      {imports.length > 0 && (
        <section className="card">
          <b>取り込みの記録</b>
          <div className="grid-wrap" style={{ marginTop: 8 }}><table className="tbl">
            <tbody>{imports.map((i) => (
              <tr key={i.id}>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{dt(i.created_at)}</td>
                <td>{i.source === 'gmail' ? 'Gmail' : '手動'}</td>
                <td>{i.error ? <span className="bad-t">{i.error}</span> : `${i.slips - i.unmatched}人分`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
