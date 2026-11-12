import { requireUser } from '@/lib/auth';
import { resolveWorkDay, publishedShifts, whoIsWorking } from '@/lib/data';
import { NowWorking } from '@/components/NowWorking';
import { summarizeDay, NEXT, lastKind } from '@/lib/calc';
import { jstParts, hm } from '@/lib/time';
import { PunchPanel } from './PunchPanel';
import { PunchLog, STATE_LABEL } from '@/components/PunchLog';
import { TaskList } from '@/components/TaskList';
import { tasksForStaff, toItem } from '@/lib/tasks';
import { ledgerBrief } from '@/lib/brief-data';
import { LedgerBrief } from '@/components/LedgerBrief';

export default async function PunchPage() {
  const u = await requireUser();
  const [day, now] = await Promise.all([resolveWorkDay(u.id), whoIsWorking()]);
  const [[plan], tasks, ledger] = await Promise.all([publishedShifts(day.date, day.date, { staffId: u.id }), tasksForStaff(u.id, day.date), ledgerBrief()]);
  const s = summarizeDay(day.punches, { now: day.minute, plan: plan ? { start: plan.start_min, end: plan.end_min } : null });
  const lk = lastKind(day.punches);
  const dayWord = day.date === jstParts().date ? '今日' : '前日';
  // シフトがある日は、予定表と受発注の入荷・出荷をまとめて出す（シフト前に確認できるように）
  const brief = plan && ledger ? ledger.byDate.get(day.date) ?? null : null;
  const showLedger = !!(plan && ledger && (brief || tasks.length > 0));
  return (
    <div className="narrow">
      <div className="punchcard">
        <PunchPanel allowed={NEXT[lk]} reClockIn={lk === 'out'} serverNow={Date.now()} staffId={u.id} />
        <div className="pstate">
          <span className={`stt s-${s.state}`}>{STATE_LABEL[s.state]}</span>
          <span className="sub">{plan ? `${dayWord}のシフト ${hm(plan.start_min)}〜${hm(plan.end_min)}` : '今日のシフトはありません'}</span>
        </div>
        {day.punches.length > 0 && (
          <div className="todaylog"><PunchLog punches={day.punches} />{s.workMin > 0 && <span className="sub">実働 {Math.floor(s.workMin / 60)}時間{s.workMin % 60}分</span>}</div>
        )}
      </div>
      {(tasks.length > 0 || showLedger) && (
        <section className="card taskcard brief" aria-label={`${dayWord}のまとめ`}>
          <div className="item-h"><b>{dayWord}のまとめ</b>{plan && <span className="sub">シフト {hm(plan.start_min)}〜{hm(plan.end_min)}</span>}</div>
          {tasks.length > 0 && (
            <div className="brief-sec">
              <div className="brief-h"><b>予定表</b>{tasks.some((t) => t.kind === 'task') && <span className="sub">終わった作業はチェック</span>}</div>
              <TaskList items={tasks.map(toItem)} canCheck />
            </div>
          )}
          {showLedger && <div className="brief-sec"><LedgerBrief brief={brief} date={day.date} receivedAt={ledger!.at} /></div>}
        </section>
      )}
      <NowWorking initial={now} meId={u.id} />
      <p className="sub" style={{ marginTop: 12 }}>押し間違いや押し忘れは「カレンダー」からその日を選んで、修正を申請してください。</p>
    </div>
  );
}
