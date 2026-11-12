import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { punchesBetween, publishedShifts, listCorrections } from '@/lib/data';
import { summarizeDay, planCost, type PunchKind } from '@/lib/calc';
import { jstParts, daysInMonth, ymd, weekday, WD, hm, hshort, dateLabel, hoursLabel, addDays } from '@/lib/time';
import { PunchLog, STATE_LABEL, PUNCH_LABEL } from '@/components/PunchLog';
import { CorrectionForm } from './CorrectionForm';
import { TaskList } from '@/components/TaskList';
import { tasksOfStore, storeOf, toItem } from '@/lib/tasks';
import { sql } from '@/lib/db';
import { ledgerBrief } from '@/lib/brief-data';
import { LedgerBrief } from '@/components/LedgerBrief';

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ ym?: string; d?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const now = jstParts();
  const ym = /^\d{4}-\d{2}$/.test(sp.ym ?? '') ? sp.ym! : now.date.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const nd = daysInMonth(y, m), from = ymd(y, m, 1), to = ymd(y, m, nd);
  const sel = sp.d && sp.d.startsWith(ym) ? sp.d : now.date.startsWith(ym) ? now.date : from;
  const storeId = await storeOf(u.id);
  const [punches, shifts, reqs, tasks, ledger, crew] = await Promise.all([
    punchesBetween(from, to, u.id), publishedShifts(from, to, { staffId: u.id }), listCorrections({ staffId: u.id }),
    storeId ? tasksOfStore(storeId, from, to) : Promise.resolve([]), ledgerBrief(),
    // 選んだ日に出勤する人（みんなのシフトと同じ内容。時給などは出さない）
    storeId ? sql<{ staff_id: number; name: string; start_min: number; end_min: number }[]>`
      select p.staff_id, s.name, p.start_min, p.end_min from published_shifts p join staff s on s.id = p.staff_id
      where p.store_id = ${storeId} and p.work_date = ${sel} order by p.start_min, p.end_min, s.sort, s.id` : Promise.resolve([]),
  ]);
  // 予定表は「全体 → 自分 → ほかの人」の順に並べる（カレンダーのマスには先頭の1件を出す）
  const rank = (t: { staff_id: number | null }) => (t.staff_id === null ? 0 : t.staff_id === u.id ? 1 : 2);
  const dayTasks = (k: string) => tasks.filter((t) => t.work_date === k).sort((a, b) => rank(a) - rank(b));
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
    if (sh) { planDays++; planMin += planCost({ start: sh.start_min, end: sh.end_min }, 0).workMin; }
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
        {(() => {
          // 受発注の入荷・出荷（今日以降。全員に出す）
          const lb = k >= now.date ? ledger?.byDate.get(k) : undefined;
          if (!lb || (!lb.ins.length && !lb.outs.length)) return null;
          const late = [...lb.ins, ...lb.outs].some((x) => x.late);
          return (
            <span className={`clb${late ? ' late' : ''}`} title={`入荷${lb.ins.length}件・出荷${lb.outs.length}件${late ? '（遅れあり）' : ''}`}>
              {lb.ins.length > 0 && <i className="in">入<span className="w">荷</span>{lb.ins.length}</i>}
              {lb.outs.length > 0 && <i className="out">出<span className="w">荷</span>{lb.outs.length}</i>}
            </span>
          );
        })()}
        {(() => { const dt = dayTasks(k); return dt.length > 0 && <span className="ctk" title={dt.map((t) => t.title).join('\n')}><span className="ctk-n">予定{dt.length}</span><span className="ctk-t">{dt[0].title}</span>{dt.length > 1 && <span className="ctk-more">ほか{dt.length - 1}件</span>}</span>; })()}
        {badge}
      </Link>,
    );
  }
  const sh = shifts.find((s) => s.work_date === sel);
  const ps = punches.filter((p) => p.work_date === sel);
  const s = summarizeDay(ps, { isPast: sel < now.date, now: sel === now.date ? now.minute : null, plan: sh ? { start: sh.start_min, end: sh.end_min } : null });
  const myReqs = reqs.filter((r) => r.work_date === sel);
  // 今日からあとの日は、受発注の入荷・出荷の予定も出す
  const showLedger = !!(ledger && sel >= now.date);
  const selTasks = dayTasks(sel);

  return (
    <div className="narrow">
      <div className="summary three">
        <div className="card"><div className="k">シフト</div><div className="mid num">{planDays}日</div><div className="sub num">{(planMin / 60).toFixed(1)}h</div></div>
        <div className="card"><div className="k">出勤した日</div><div className="mid num">{workDays}日</div><div className="sub num">{(workMin / 60).toFixed(1)}h</div></div>
        <div className="card"><div className="k">要確認</div><div className={`mid num${issues ? ' bad-t' : ''}`}>{issues}件</div><div className="sub">打刻漏れなど</div></div>
      </div>
      <div className="calnav">
        <Link className="btn" href={`/me/calendar?ym=${prev}`} aria-label="前の月">‹ 前月</Link>
        <h2>{y}年{m}月</h2>
        <Link className="btn" href={`/me/calendar?ym=${next}`} aria-label="次の月">翌月 ›</Link>
      </div>
      <div className="calgrid">
        {WD.map((x, i) => <div key={x} className={`cw${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{x}</div>)}
        {cells}
      </div>
      {ledger && <p className="sub cal-legend"><i className="clb-k in">入</i>入荷・<i className="clb-k out">出</i>出荷の件数（受発注台帳 {new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ledger.at)}時点）。日を押すと品名が出ます。</p>}
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
        <div className="cdday">
          <div className="brief-h"><b>この日の予定</b></div>
          <div className="cdsec">
            <div className="cdsec-h">予定表</div>
            <TaskList key={sel} items={selTasks.map(toItem)} meId={u.id} canCheck={sel <= now.date && sel >= addDays(now.date, -1)} empty="予定表に書かれた予定はありません。" />
          </div>
          <div className="cdsec">
            <div className="cdsec-h">出勤する人</div>
            {crew.length
              ? <div className="cdcrew">{crew.map((c) => <span key={c.staff_id} className={`nchip${c.staff_id === u.id ? ' me' : ''}`}><b>{c.name}</b> <span className="num">{hm(c.start_min)}〜{hm(c.end_min)}</span></span>)}</div>
              : <p className="sub" style={{ margin: 0 }}>公開されたシフトはまだありません。</p>}
          </div>
          {showLedger && <div className="cdsec"><LedgerBrief brief={ledger!.byDate.get(sel) ?? null} date={sel} receivedAt={ledger!.at} /></div>}
        </div>
      </div>
      <p className="sub" style={{ marginTop: 12 }}>シフトと予定表は、Googleカレンダーやスマホのカレンダーにも自動で入れられます → <Link href="/me/settings">設定</Link></p>
    </div>
  );
}
