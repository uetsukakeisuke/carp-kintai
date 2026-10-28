import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { punchesBetween, publishedShifts, listCorrections } from '@/lib/data';
import { summarizeDay, planCost, type PunchKind } from '@/lib/calc';
import { jstParts, daysInMonth, ymd, weekday, WD, hm, hshort, dateLabel, hoursLabel } from '@/lib/time';
import { PunchLog, STATE_LABEL, PUNCH_LABEL } from '@/components/PunchLog';
import { CorrectionForm } from './CorrectionForm';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ ym?: string; d?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const now = jstParts();
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : now.date.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const nd = daysInMonth(y, m), from = ymd(y, m, 1), to = ymd(y, m, nd);
  const [punches, shifts, reqs] = await Promise.all([punchesBetween(from, to, u.id), publishedShifts(from, to, { staffId: u.id }), listCorrections({ staffId: u.id })]);
  const sel = sp.d && sp.d.startsWith(ym) ? sp.d : now.date.startsWith(ym) ? now.date : from;
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

  let planDays = 0, planMin = 0, workDays = 0, workMin = 0, issues = 0;
  const cells = [];
  for (let i = 0; i < weekday(from); i++) cells.push(<div key={`b${i}`} className="cc blank" />);
  for (let d = 1; d <= nd; d++) {
    const k = ymd(y, m, d), w = weekday(k);
    const sh = shifts.find((s) => s.work_date === k);
    const ps = punches.filter((p) => p.work_date === k);
    const s = summarizeDay(ps, { isPast: k < now.date, now: k === now.date ? now.minute : null, plan: sh ? { start: sh.start_min, end: sh.end_min } : null });
    if (sh) { planDays++; planMin += planCost({ start: sh.start_min, end: sh.end_min }, 0, 0).workMin; }
    if (s.firstIn !== null) { workDays++; workMin += s.workMin; }
    let badge = null;
    if (s.state === 'done') badge = <span className="cs ok">出勤済</span>;
    else if (s.state === 'working' || s.state === 'break') badge = <span className="cs now">{s.state === 'break' ? '休憩中' : '勤務中'}</span>;
    else if (s.state === 'missing' || s.state === 'absent') { badge = <span className="cs bad">{s.state === 'missing' ? '退勤なし' : '未出勤'}</span>; issues++; }
    const cls = ['cc', w === 0 ? 'sun' : w === 6 ? 'sat' : '', k === now.date ? 'today' : '', k === sel ? 'sel' : '', sh ? 'has' : ''].filter(Boolean).join(' ');
    cells.push(
      <Link key={k} className={cls} href={`/me/calendar?ym=${ym}&d=${k}`} scroll={false} aria-label={`${m}月${d}日${sh ? ' シフトあり' : ''}`}>
        <span className="cn">{d}</span>
        {sh && <span className="csh">{hshort(sh.start_min)}-{hshort(sh.end_min)}</span>}
        {badge}
      </Link>,
    );
  }
  const sh = shifts.find((s) => s.work_date === sel);
  const ps = punches.filter((p) => p.work_date === sel);
  const s = summarizeDay(ps, { isPast: sel < now.date, now: sel === now.date ? now.minute : null, plan: sh ? { start: sh.start_min, end: sh.end_min } : null });
  const myReqs = reqs.filter((r) => r.work_date === sel);

  return (
    <div className="narrow">
      <div className="summary" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        <div className="card"><div className="k">シフト</div><div className="mid num">{planDays}日</div><div className="sub num">{(planMin / 60).toFixed(1)}h</div></div>
        <div className="card"><div className="k">出勤した日</div><div className="mid num">{workDays}日</div><div className="sub num">{(workMin / 60).toFixed(1)}h</div></div>
        <div className="card"><div className="k">要確認</div><div className={`mid num${issues ? ' bad-t' : ''}`}>{issues}件</div><div className="sub">打刻漏れなど</div></div>
      </div>
      <div className="calnav">
        <Link className="btn ghost" href={`/me/calendar?ym=${prev}`}>‹ 前の月</Link>
        <h2>{y}年{m}月</h2>
        <Link className="btn ghost" href={`/me/calendar?ym=${next}`}>次の月 ›</Link>
      </div>
      <div className="calgrid">
        {WD.map((x, i) => <div key={x} className={`cw${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{x}</div>)}
        {cells}
      </div>
      <div className="caldet">
        <div className="row"><b>{dateLabel(sel)}</b>{s.state !== 'none' && <span className={`stt s-${s.state}`}>{STATE_LABEL[s.state]}</span>}
          {s.segments.length > 1 && <span className="flag f-re">{s.segments.length}回に分けて勤務</span>}</div>
        <div className="cdrow"><span className="sub">シフト</span><span className="num">{sh ? `${hm(sh.start_min)}〜${hm(sh.end_min)}` : 'なし'}</span></div>
        <div className="cdrow"><span className="sub">打刻</span><span><PunchLog punches={ps} /></span></div>
        {s.firstIn !== null && <div className="cdrow"><span className="sub">実働</span><span className="num">{hoursLabel(s.workMin)}{s.breakMin ? `（休憩 ${s.breakMin}分）` : ''}</span></div>}
        {myReqs.map((q) => (
          <div key={q.id} className={`reqst q-${q.status}`}>{PUNCH_LABEL[q.kind]}を {hm(q.minute)} に修正 ・ {q.status === 'pending' ? '承認待ち' : q.status === 'approved' ? '承認されました' : '却下されました'}</div>
        ))}
        {sel <= now.date && (s.firstIn !== null || sh) && (
          <CorrectionForm date={sel} current={(['in', 'break_start', 'break_end', 'out'] as PunchKind[]).map((k) => ({ kind: k, minute: ps.find((p) => p.kind === k)?.minute ?? null }))}
            suggested={s.state === 'missing' ? 'out' : s.state === 'absent' ? 'in' : 'in'} planStart={sh?.start_min ?? null} planEnd={sh?.end_min ?? null} />
        )}
        {!sh && s.firstIn === null && <div className="sub">この日は予定も出勤もありません。</div>}
      </div>
    </div>
  );
}
