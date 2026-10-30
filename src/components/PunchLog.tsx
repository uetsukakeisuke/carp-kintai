import type { PunchKind } from '@/lib/calc';
import { hm } from '@/lib/time';

export const PUNCH_LABEL: Record<PunchKind, string> = { in: '出勤', break_start: '休憩開始', break_end: '休憩終了', out: '退勤' };
export const STATE_LABEL: Record<string, string> = { none: '—', before: '出勤前', working: '勤務中', break: '休憩中', done: '退勤済み', missing: '退勤の打刻なし', absent: '未出勤' };

export function PunchLog({ punches }: { punches: { kind: PunchKind; minute: number; original_minute?: number | null; correction_reason?: string | null; face?: string | null }[] }) {
  if (!punches.length) return <span className="sub">打刻なし</span>;
  return (
    <>
      {punches.map((p, i) => (
        <span className="lg" key={i}>
          <span className="lk">{PUNCH_LABEL[p.kind]}</span><span className="num">{hm(p.minute)}</span>
          {p.face === 'mismatch' ? <span className="flag f-late" title="顔が登録と一致しませんでした">顔 要確認</span>
            : p.face === 'skipped' ? <span className="flag f-ot" title="顔の確認なしで打刻されました">顔なし</span>
            : p.face === 'reregistered' ? <span className="flag f-ot" title="打刻した端末で顔を登録し直しました">顔を再登録</span>
            : p.face === 'registered' ? <span className="flag" title="打刻した端末ではじめて顔を登録しました">顔を登録</span> : null}
          {p.correction_reason ? <span className="ed" title={`修正前：${p.original_minute != null ? hm(p.original_minute) : '記録なし'}／理由：${p.correction_reason}`}>修正済み</span> : null}
        </span>
      ))}
    </>
  );
}
