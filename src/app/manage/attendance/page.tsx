import Link from 'next/link';
import { listStores, listStaff, punchesBetween, publishedShifts, listCorrections, ratesFor } from '@/lib/data';
import { summarizeDay, laborCost, wageAt, planCost } from '@/lib/calc';
import { jstParts, addDays, dateLabel, hm, yen, WD, weekday } from '@/lib/time';
import { PunchLog, STATE_LABEL, PUNCH_LABEL } from '@/components/PunchLog';
import { ActionButton } from '@/components/ActionButton';
import { decideCorrectionAction } from '@/app/actions';

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ d?: string; store?: string }> }) {
  const sp = await searchParams;
  const now = jstParts();
  const stores = await listStores();
  const store = stores.find((s) => s.id === Number(sp.store)) ?? stores[0];
  const d = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? '') ? sp.d! : now.date;
  const from = addDays(d, -13 + Math.min(0, 0));
  const staff = await listStaff({ storeId: store?.id });
  const [punches, shifts, pending, rates, weekPunches] = await Promise.all([
    punchesBetween(d, d), publishedShifts(d, d, { storeId: store?.id }), listCorrections({ status: 'pending' }), ratesFor(staff.map((s) => s.id)),
    punchesBetween(addDays(now.date, -13), now.date),
  ]);
  const rows = staff.map((s) => {
    const ps = punches.filter((p) => p.staff_id === s.id);
    const sh = shifts.find((x) => x.staff_id === s.id);
    const sum = summarizeDay(ps, { isPast: d < now.date, now: d === now.date ? now.minute : null, plan: sh ? { start: sh.start_min, end: sh.end_min } : null });
    const w = wageAt(rates.get(s.id) ?? [], d) ?? 0;
    const cost = sum.firstIn !== null ? laborCost({ regularMin: sum.regularMin, overtimeMin: sum.overtimeMin, nightMin: sum.nightMin, hourly: w, transport: s.transport_per_day }).total : 0;
    const plan = sh ? planCost({ start: sh.start_min, end: sh.end_min }, w, s.transport_per_day).total : 0;
    const flags: [string, string][] = [];
    if (sh && sum.firstIn !== null && sum.firstIn > sh.start_min) flags.push(['late', `遅刻 ${sum.firstIn - sh.start_min}分`]);
    if (sh && sum.lastOut !== null && sum.lastOut < sh.end_min - 5) flags.push(['early', `早退 ${sh.end_min - sum.lastOut}分`]);
    if (sh && sum.lastOut !== null && sum.lastOut > sh.end_min + 14) flags.push(['ot', `残業 ${sum.lastOut - sh.end_min}分`]);
    if (sum.segments.length > 1) flags.push(['re', `${sum.segments.length}回に分けて勤務`]);
    return { s, ps, sh, sum, cost, plan, flags };
  }).filter((r) => r.ps.length || r.sh);
  // 直近2週間の退勤漏れ
  const missing: { name: string; date: string }[] = [];
  for (const s of staff) for (let i = 1; i <= 13; i++) {
    const k = addDays(now.date, -i);
    const ps = weekPunches.filter((p) => p.staff_id === s.id && p.work_date === k);
    if (ps.length && summarizeDay(ps, { isPast: true }).state === 'missing') missing.push({ name: s.name, date: k });
  }
  const totalCost = rows.reduce((a, r) => a + r.cost, 0), totalPlan = rows.reduce((a, r) => a + r.plan, 0);
  const strip = Array.from({ length: 14 }, (_, i) => addDays(now.date, i - 13));

  return (
    <>
      {pending.length > 0 && (
        <>
          <h2 className="sec" style={{ marginTop: 0 }}>打刻修正の申請（{pending.length}件）</h2>
          <div className="grid-wrap" style={{ marginBottom: 16 }}><table className="tbl"><tbody>
            {pending.map((q) => (
              <tr key={q.id}>
                <td><b>{q.staff_name}</b><div className="sub">{dateLabel(q.work_date)}</div></td>
                <td><b>{PUNCH_LABEL[q.kind]}</b> を <span className="num">{hm(q.minute)}</span> に<div className="sub">理由：{q.reason}</div></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <ActionButton action={decideCorrectionAction.bind(null, q.id, false)}>却下</ActionButton>{' '}
                  <ActionButton className="btn primary" action={decideCorrectionAction.bind(null, q.id, true)}>承認する</ActionButton>
                </td>
              </tr>
            ))}
          </tbody></table></div>
        </>
      )}
      {missing.length > 0 && <div className="banner bad"><span><b>退勤の打刻がない勤務が{missing.length}件あります。</b>　本人に修正申請をしてもらうか、確認してください：{missing.slice(0, 6).map((x) => `${x.name} ${dateLabel(x.date)}`).join('、')}{missing.length > 6 ? ' ほか' : ''}</span></div>}
      <div className="row" style={{ marginBottom: 10 }}>
        {stores.map((s) => <Link key={s.id} className={`btn${s.id === store?.id ? ' primary' : ''}`} href={`/manage/attendance?store=${s.id}&d=${d}`}>{s.name}</Link>)}
      </div>
      <div className="daystrip">
        {strip.map((k) => <Link key={k} href={`/manage/attendance?store=${store?.id}&d=${k}`} aria-current={k === d ? 'true' : undefined}><b>{Number(k.slice(8))}</b><small>{k === now.date ? '今日' : WD[weekday(k)]}</small></Link>)}
      </div>
      <section className="summary">
        <div className="card"><div className="k">{dateLabel(d)}の実績人件費{d === now.date ? '（現在まで）' : ''}</div><div className="big num">{yen(totalCost)}<small>／予定 {yen(totalPlan)}</small></div></div>
        <div className="card"><div className="k">勤務中・休憩中</div><div className="mid num">{rows.filter((r) => r.sum.state === 'working' || r.sum.state === 'break').length}人</div></div>
        <div className="card"><div className="k">退勤の打刻なし</div><div className={`mid num ${rows.some((r) => r.sum.state === 'missing') ? 'bad-t' : 'ok-t'}`}>{rows.filter((r) => r.sum.state === 'missing').length}件</div></div>
        <div className="card"><div className="k">未出勤</div><div className={`mid num ${rows.some((r) => r.sum.state === 'absent') ? 'warn-t' : 'ok-t'}`}>{rows.filter((r) => r.sum.state === 'absent').length}人</div></div>
      </section>
      <div className="grid-wrap"><table className="tbl" style={{ minWidth: 760 }}>
        <thead><tr><th>スタッフ</th><th>予定</th><th>打刻</th><th>休憩</th><th>実働</th><th>状態</th><th>人件費</th></tr></thead>
        <tbody>
          {rows.map(({ s, ps, sh, sum, cost, flags }) => (
            <tr key={s.id}>
              <td><b>{s.name}</b></td>
              <td className="num">{sh ? `${hm(sh.start_min)}〜${hm(sh.end_min)}` : '—'}</td>
              <td><PunchLog punches={ps} /></td>
              <td className="num">{sum.breakMin ? `${sum.breakMin}分` : '—'}</td>
              <td className="num">{sum.firstIn !== null ? `${(sum.workMin / 60).toFixed(1)}h` : '—'}</td>
              <td><span className={`stt s-${sum.state}`}>{STATE_LABEL[sum.state]}</span>{flags.map(([c, t]) => <span key={t} className={`flag f-${c}`}>{t}</span>)}</td>
              <td className="num">{cost ? yen(cost) : '—'}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="sub">この日の予定・打刻はありません</td></tr>}
        </tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 12 }}>打刻の記録は直接書き換えず、修正申請の承認で直します。修正前の時刻は「修正済み」に触れると確認できます。</p>
    </>
  );
}
