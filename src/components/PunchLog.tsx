import type { PunchKind } from '@/lib/calc';
import { hm } from '@/lib/time';

export const PUNCH_LABEL: Record<PunchKind, string> = { in: '出勤', break_start: '休憩開始', break_end: '休憩終了', out: '退勤' };
export const STATE_LABEL: Record<string, string> = { none: '—', before: '出勤前', working: '勤務中', break: '休憩中', done: '退勤済み', missing: '退勤の打刻なし', absent: '未出勤' };

export function PunchLog({ punches }: { punches: { kind: PunchKind; minute: number; original_minute?: number | null; correction_reason?: string | null }[] }) {
  if (!punches.length) return <span className="sub">打刻なし</span>;
  return (
    <>
      {punches.map((p, i) => (
        <span className="lg" key={i}>
          <span className="lk">{PUNCH_LABEL[p.kind]}</span><span className="num">{hm(p.minute)}</span>
          {p.correction_reason ? <span className="ed" title={`修正前：${p.original_minute != null ? hm(p.original_minute) : '記録なし'}／理由：${p.correction_reason}`}>修正済み</span> : null}
        </span>
      ))}
    </>
  );
}
