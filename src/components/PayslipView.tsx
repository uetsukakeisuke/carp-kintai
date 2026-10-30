import type { Payslip } from '@/lib/payslips';

const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const fmt = (v: number | string) => (typeof v === 'number' ? v.toLocaleString('ja-JP') : v);
// 合計の行は太字、累計は「参考」に分ける
const TOTAL = /総支給額|実総支給額|総控除額|差引支給額|現金支給額/;
const CUM = /累計/;

function Block({ title, rows, unit }: { title: string; rows: [string, number | string][]; unit?: boolean }) {
  if (!rows.length) return null;
  return (
    <section className="slip-block">
      <h3>{title}</h3>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className={TOTAL.test(k) ? 'total' : ''}><dt>{k}</dt><dd className="num">{typeof v === 'number' && !unit ? yen(v) : fmt(v)}</dd></div>
        ))}
      </dl>
    </section>
  );
}

export function PayslipView({ slip }: { slip: Payslip }) {
  const ent = (x: unknown) => (Array.isArray(x) ? (x as [string, number | string][]) : Object.entries((x ?? {}) as Record<string, number | string>));
  const d = { attendance: ent(slip.data.attendance), pay: ent(slip.data.pay), deduction: ent(slip.data.deduction), unit: ent(slip.data.unit) };
  const att = d.attendance.filter(([k]) => !CUM.test(k));
  const cum = d.attendance.filter(([k]) => CUM.test(k));
  const unit = d.unit.filter(([k]) => !TOTAL.test(k));
  const pay = slip.pay_date ? `${Number(slip.pay_date.slice(5, 7))}月${Number(slip.pay_date.slice(8, 10))}日支給` : '';
  return (
    <article className="slip">
      <header className="slip-head">
        <div>
          <div className="k">{slip.work_year}年{slip.work_month}月分{pay && `（${pay}）`}</div>
          <b className="slip-name">{slip.staff_name ?? slip.slip_name}</b>
        </div>
        <div className="slip-net">
          <span className="k">差引支給額（手取り）</span>
          <b className="num">{yen(slip.net)}</b>
        </div>
      </header>
      <div className="slip-sum">
        <span>総支給 <b className="num">{yen(slip.gross)}</b></span>
        <span>控除 <b className="num">−{yen(slip.deduction)}</b></span>
      </div>
      <div className="slip-grid">
        <Block title="支給" rows={d.pay} />
        <Block title="控除" rows={d.deduction} />
        <Block title="勤怠" rows={att} unit />
        <Block title="単価" rows={unit} unit />
        <Block title="今年の累計（参考）" rows={cum} />
      </div>
      <p className="sub" style={{ margin: '10px 0 0' }}>アクトヴィジョン税理士法人から届いた給与支給明細書の内容です。正式な書類はPDFの明細書です。</p>
    </article>
  );
}
