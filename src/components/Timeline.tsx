import { hm } from '@/lib/time';
import { partsOf } from '@/lib/shift-parts';

// 1日の配置（誰が何時から何時まで）。need を渡すと時間帯ごとの人数も出す。
export function Timeline({ rows, meId, startHour = 8, endHour = 26 }: { rows: { id: number; name: string; start: number; end: number; parts?: [number, number][] | null }[]; meId?: number; startHour?: number; endHour?: number }) {
  const S = startHour * 60, E = endHour * 60, span = E - S;
  const pct = (m: number) => ((Math.min(Math.max(m, S), E) - S) / span) * 100;
  const hours: number[] = []; for (let h = startHour; h <= endHour; h += 2) hours.push(h);
  const list = [...rows].sort((a, b) => a.start - b.start);
  return (
    <div className="tl"><div className="tl-in">
      <div className="tl-row"><div /><div className="axis">{hours.map((h) => <span key={h} style={{ left: `${pct(h * 60)}%` }}>{h}:00</span>)}</div></div>
      {list.map((r) => (
        <div key={r.id} className={`tl-row${r.id === meId ? ' me' : ''}`}>
          <div className="nm">{r.name}{r.id === meId ? '（自分）' : ''}</div>
          <div className="track">{partsOf(r).map(([a, b], i, ps) => (
            <div key={a} className="seg-bar" title={`${hm(a)}–${hm(b)}`} style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }}>{ps.length > 1 ? (i === 0 ? hm(a) : '') : `${hm(a)}–${hm(b)}`}</div>
          ))}</div>
        </div>
      ))}
      {!list.length && <p className="sub">この日はまだ誰も入っていません。</p>}
    </div></div>
  );
}
