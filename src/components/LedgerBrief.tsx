import type { BriefItem, DayBrief } from '@/lib/brief';

const SHOW = 5;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const at = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const kgText = (kg: number) => (kg >= 10 ? Math.round(kg).toLocaleString('ja-JP') : String(Math.round(kg * 10) / 10));

function Row({ x, date }: { x: BriefItem; date: string }) {
  const when = x.late
    ? <b className="warn-t">{x.kind === 'in' ? `入荷予定 ${md(x.due)} を過ぎています` : `納品日 ${md(x.due)} を過ぎています`}</b>
    : x.kind === 'out' ? <>納品日 {md(x.due)}</> : x.due !== date ? <>入荷予定 {md(x.due)}</> : null;
  return (
    <li>
      <span className="lb-part">{x.part}</span>
      <span className="lb-qty num">{x.qty > 0 ? `${x.qty.toLocaleString('ja-JP')}個` : x.qtyText}{x.kg > 0 ? `${x.qty > 0 || x.qtyText ? '・' : ''}${kgText(x.kg)}kg` : ''}</span>
      <span className="sub lb-meta">{x.kind === 'in' ? `${x.party}から` : `${x.party}へ`}{when && <>・{when}</>}</span>
    </li>
  );
}

function Part({ kind, items, kg, date }: { kind: 'in' | 'out'; items: BriefItem[]; kg: number; date: string }) {
  if (!items.length) return null;
  const late = items.filter((x) => x.late).length;
  return (
    <div className="lb-part-sec">
      <div className="lb-h"><span className={`fc-k ${kind}`}>{kind === 'in' ? '入荷' : '出荷'}</span><b>{items.length}件</b>
        {kg > 0 && <span className="sub">約{kgText(kg)}kg</span>}{late > 0 && <span className="warn-t lb-late">うち遅れ{late}件</span>}</div>
      <ul className="lb-list">{items.slice(0, SHOW).map((x, i) => <Row key={i} x={x} date={date} />)}</ul>
      {items.length > SHOW && (
        <details className="lb-more"><summary className="sub">ほか{items.length - SHOW}件を見る</summary>
          <ul className="lb-list">{items.slice(SHOW).map((x, i) => <Row key={i} x={x} date={date} />)}</ul>
        </details>
      )}
    </div>
  );
}

/** その日の入荷・出荷（受発注台帳から。金額は出さない） */
export function LedgerBrief({ brief, date, receivedAt }: { brief: DayBrief | null; date: string; receivedAt: Date }) {
  const none = !brief || (!brief.ins.length && !brief.outs.length);
  return (
    <div className="lb">
      <div className="brief-h"><b>入荷・出荷</b><span className="sub">受発注台帳（{at(receivedAt)}時点）</span></div>
      {none ? <p className="sub" style={{ margin: 0 }}>この日の入荷・出荷の予定はありません。</p> : (
        <>
          <Part kind="in" items={brief.ins} kg={brief.inKg} date={date} />
          <Part kind="out" items={brief.outs} kg={brief.outKg} date={date} />
        </>
      )}
    </div>
  );
}
