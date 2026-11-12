import Link from 'next/link';
import { headers } from 'next/headers';
import { listStaff } from '@/lib/data';
import { payslipMonths, payslipsForMonth, payslipById, recentImports, getImportSecret, slipPins } from '@/lib/payslips';
import { requireManager } from '@/lib/auth';
import { gasScript } from '@/lib/gas-script';
import { PayslipView } from '@/components/PayslipView';
import { UploadForm, ScriptBox, RotateSecret } from './PayslipAdmin';

export const dynamic = 'force-dynamic';
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const dt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

export default async function PayslipAdminPage({ searchParams }: { searchParams: Promise<{ ym?: string; id?: string }> }) {
  const me = await requireManager(); // ページでも必ず確かめる（画面の枠の確認と並行して描かれるため）
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
  // 月が決まっていれば、明細の一覧も同時に聞く
  const asked = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : null;
  const [months, imports, staff, secret, pins, askedSlips] = await Promise.all([
    payslipMonths(), recentImports(), listStaff(), getImportSecret(true), me.role === 'admin' ? slipPins() : Promise.resolve([]),
    asked ? payslipsForMonth(Number(asked.slice(0, 4)), Number(asked.slice(5, 7))) : Promise.resolve(null),
  ]);
  const sel = asked ?? (months[0] ? `${months[0].work_year}-${String(months[0].work_month).padStart(2, '0')}` : null);
  const [y, m] = sel ? sel.split('-').map(Number) : [0, 0];
  const slips = askedSlips ?? (sel ? await payslipsForMonth(y, m) : []);
  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const lastGmail = imports.find((i) => i.source === 'gmail');
  const missing = staff.filter((s) => s.pay_type === 'hourly' && !slips.some((x) => x.staff_id === s.id));

  return (
    <>
      <div className="ph">
        <span className="sub">{lastGmail ? <>Gmail から自動で取り込み中（最後に届いたのは {dt(lastGmail.created_at)}）</> : <>Gmail との連携がまだです。いちばん下の「Gmail から自動で取り込む」を設定してください</>}</span>
      </div>
      {months.length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }}>
          {months.map((x) => { const k = `${x.work_year}-${String(x.work_month).padStart(2, '0')}`; return <Link key={k} className={`btn${k === sel ? ' primary' : ''}`} href={`/manage/payslips?ym=${k}`}>{x.work_month}月分</Link>; })}
        </div>
      )}
      {sel ? (
        <div className="grid-wrap" style={{ marginBottom: 12 }}><table className="tbl stack dense">
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
      ) : <div className="empty" style={{ marginBottom: 16 }}><b>まだ明細がありません</b>下の「Gmail から自動で取り込む」を設定するか、PDFを取り込んでください。</div>}
      {sel && missing.length > 0 && <p className="sub" style={{ margin: '0 0 12px' }}>この月の明細がない人：{missing.map((s) => s.name).join('、')}（その月に勤務がなかった場合など）</p>}

      <div className="cols2">
        <section className="card">
          <b>PDFを手で取り込む</b>
          <p className="sub" style={{ margin: '4px 0 10px' }}>メールの「給与支給明細書」PDFを保存して選びます。同じ月をもう一度取り込むと上書きされます。</p>
          <UploadForm />
        </section>
        {imports.length > 0 && (
          <section className="card">
            <b>取り込みの記録</b>
            <div className="grid-wrap" style={{ marginTop: 8 }}><table className="tbl dense">
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
      </div>

      {me.role === 'admin' && (
        <details className="card ex-setup pinlist" style={{ marginTop: 12 }}>
          <summary><b>全員の明細の暗証番号</b><span className="sub">（管理者だけに表示）</span></summary>
          <div className="pins">
            {pins.map((x) => (
              <div key={x.id} className="pinrow">
                <span>{x.name}</span>
                {x.slip_pin ? <b className="num">{x.slip_pin}</b> : x.has_pin ? <span className="sub">不明（消して決め直してもらう）</span> : <span className="sub">未設定</span>}
                {x.locked && <span className="flag f-late">ロック中</span>}
              </div>
            ))}
          </div>
          <p className="sub" style={{ margin: '8px 0 0' }}>本人が初めて「明細」を開いたときに決めた番号です。消すときは「スタッフ・時給 → 編集 → 明細の暗証番号を消す」。</p>
        </details>
      )}

      <details className="card ex-setup" style={{ marginTop: 12 }} open={!lastGmail}>
        <summary><b>Gmail から自動で取り込む</b>{lastGmail ? <span className="ok-t">（連携済み）</span> : <span className="sub">（はじめに1回だけ・5分ほど）</span>}</summary>
        <ol className="steps" style={{ marginTop: 8 }}>
          <li>明細メールが届く会社の Google アカウントで <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com（新しいプロジェクト）</a> を開く</li>
          <li>最初から入っている文字をすべて消し、下のスクリプトを「コピー」して貼り付け、保存（💾）</li>
          <li>上の関数の選択欄で <b>setup</b> を選んで「実行」→ Google の許可画面で「許可」</li>
          <li>以後、1時間ごとにアクトヴィジョンの「給与明細」メールを確認し、明細PDFを自動で取り込みます</li>
        </ol>
        <div style={{ marginTop: 10 }}><ScriptBox code={gasScript(appUrl, secret ?? '')} /></div>
        <p className="sub" style={{ margin: '8px 0 0' }}>スクリプトの中の合言葉（SECRET）は、このアプリに明細を送るための鍵です。他の人に見せないでください。漏れたときは作り直してください。</p>
        <div style={{ marginTop: 8 }}><RotateSecret /></div>
      </details>
    </>
  );
}
