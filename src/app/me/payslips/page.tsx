import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { payslipsOf, slipPinState, slipUnlocked } from '@/lib/payslips';
import { PayslipView } from '@/components/PayslipView';
import { SlipGate, LockButton } from './SlipGate';

export const dynamic = 'force-dynamic';
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');

export default async function MyPayslipsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const st = await slipPinState(u.id);
  if (!st.hasPin || !(await slipUnlocked(u.id))) {
    return <div className="narrow"><h1 style={{ fontSize: 20, margin: '4px 0 12px' }}>給与明細</h1><SlipGate hasPin={st.hasPin} locked={!!st.lockedUntil} /></div>;
  }
  const slips = await payslipsOf(u.id);
  const cur = slips.find((s) => s.id === Number(sp.id)) ?? slips[0];
  return (
    <div className="narrow">
      <div className="row" style={{ justifyContent: 'space-between', margin: '4px 0 12px' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>給与明細</h1>
        <LockButton />
      </div>
      {!cur ? <div className="empty"><b>まだ明細がありません</b>アクトヴィジョンから明細が届くと、ここに表示されます。</div> : (
        <>
          <PayslipView slip={cur} />
          {slips.length > 1 && (
            <>
              <h2 style={{ fontSize: 15, margin: '18px 0 8px' }}>これまでの明細</h2>
              <div className="slipmonths">
                {slips.map((s) => (
                  <Link key={s.id} href={`/me/payslips?id=${s.id}`} className="slipmonth" aria-current={s.id === cur.id ? 'page' : undefined}>
                    <span><b>{s.work_year}年{s.work_month}月分</b><br /><span className="sub">{s.pay_date ? `${Number(s.pay_date.slice(5, 7))}/${Number(s.pay_date.slice(8, 10))} 支給` : ''}</span></span>
                    <b className="num">{yen(s.net)}</b>
                  </Link>
                ))}
              </div>
            </>
          )}
          <p className="sub" style={{ marginTop: 12 }}>10分たつと自動で閉じます。人に画面を見せないよう注意してください。</p>
        </>
      )}
    </div>
  );
}
