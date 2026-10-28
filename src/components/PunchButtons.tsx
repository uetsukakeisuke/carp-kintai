'use client';
import type { PunchKind } from '@/lib/calc';
import { PUNCH_LABEL } from './PunchLog';

export function PunchButtons({ allowed, reClockIn, disabled, onPunch }: { allowed: PunchKind[]; reClockIn: boolean; disabled?: boolean; onPunch: (k: PunchKind) => void }) {
  const kinds: PunchKind[] = ['in', 'break_start', 'break_end', 'out'];
  return (
    <div className="pbtns">
      {kinds.map((k) => (
        <button key={k} type="button" className={`pbtn p-${k}`} disabled={disabled || !allowed.includes(k)} onClick={() => onPunch(k)}>
          <b>{k === 'in' && reClockIn ? 'もう一度出勤' : PUNCH_LABEL[k]}</b>
          {k === 'in' && reClockIn && <small>間違えて退勤したとき</small>}
        </button>
      ))}
    </div>
  );
}
