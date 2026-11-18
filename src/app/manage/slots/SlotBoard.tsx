'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createSlotsAction, updateSlotAction, deleteSlotsAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { call, timedOut } from '@/lib/call';
import { LedgerBrief } from '@/components/LedgerBrief';
import type { DayBrief } from '@/lib/brief';

const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const STEPS: number[] = []; for (let x = 300; x <= 1740; x += 15) STEPS.push(x);
const PRESETS = [
  { name: '午前', start: 540, end: 720 },
  { name: '午後', start: 780, end: 1080 },
  { name: '1日', start: 540, end: 1080 },
];
type R = { ok: true; message?: string } | { ok: false; error: string };
export type DayInfo = { brief: DayBrief | null; tasks: { title: string; at: number | null; who: string | null; note: boolean; done: boolean }[] };
export type SlotRow = { id: number; date: string; start: number; end: number; capacity: number; label: string; filled: number; names: string[] };

function TimeSel({ value, onChange, label, min }: { value: number; onChange: (v: number) => void; label: string; min?: number }) {
  return <select className="sel" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
    {STEPS.filter((x) => min === undefined || x > min).map((x) => <option key={x} value={x}>{hm(x)}</option>)}
  </select>;
}

export function SlotBoard({ storeId, year, month, slots, info, ledgerAt, today }: { storeId: number; year: number; month: number; slots: SlotRow[]; info: Record<string, DayInfo>; ledgerAt: string | null; today: string }) {
  const nd = new Date(year, month, 0).getDate();
  const key = (d: number) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const wd = (d: number) => new Date(year, month - 1, d).getDay();
  const [label, setLabel] = useState('出荷');
  const [start, setStart] = useState(780);
  const [end, setEnd] = useState(1080);
  const [cap, setCap] = useState(3);
  const [days, setDays] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<SlotRow | null>(null);
  const [look, setLook] = useState<string | null>(null); // 中身を見ている日（最後に押した日）
  const [pending, startT] = useTransition();
  const [toast] = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<R>, after?: () => void) => startT(async () => {
    const r = await call(fn);
    toast(r.ok ? r.message ?? '完了しました' : r.error);
    if (r.ok) after?.();
    if (!timedOut(r)) router.refresh();
  });
  const pick = (f: (d: number) => boolean) => setDays(new Set(Array.from({ length: nd }, (_, i) => i + 1).filter(f).map(key)));
  const toggle = (k: string) => { setLook(k); setDays((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }); };
  const byDay = useMemo(() => {
    const m = new Map<string, SlotRow[]>();
    for (const s of slots) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return m;
  }, [slots]);
  const lead = wd(1);

  return (
    <>
      <div className="card slot-make">
        <h2 className="sec" style={{ marginTop: 0 }}>枠を作る</h2>
        <div className="slot-form">
          <label htmlFor="sl-label">作業</label>
          <input id="sl-label" className="in" value={label} maxLength={20} onChange={(e) => setLabel(e.target.value)} placeholder="例：出荷" />
          <label>時間</label>
          <div className="htimes">
            <TimeSel label="始まり" value={start} onChange={(v) => { setStart(v); if (end <= v) setEnd(Math.min(1740, v + 60)); }} />〜
            <TimeSel label="終わり" value={end} min={start} onChange={setEnd} />
            <span className="chips">{PRESETS.map((p) => <button key={p.name} type="button" className={`btn ghost${start === p.start && end === p.end ? ' on' : ''}`} onClick={() => { setStart(p.start); setEnd(p.end); }}>{p.name} {hm(p.start)}〜{hm(p.end)}</button>)}</span>
          </div>
          <label htmlFor="sl-cap">人数</label>
          <div className="htimes"><input id="sl-cap" className="in num" type="number" min={1} max={99} value={cap} onChange={(e) => setCap(Math.max(1, Math.min(99, Number(e.target.value) || 1)))} style={{ width: 80 }} /> 人まで</div>
        </div>
        <div className="row" style={{ margin: '14px 0 6px', flexWrap: 'wrap', gap: 6 }}>
          <b>日</b><span className="sub">押して選ぶ（{days.size}日）</span><span className="grow" />
          <button type="button" className="btn ghost" onClick={() => pick((d) => wd(d) >= 1 && wd(d) <= 5)}>平日</button>
          <button type="button" className="btn ghost" onClick={() => pick((d) => wd(d) === 0 || wd(d) === 6)}>土日</button>
          <button type="button" className="btn ghost" onClick={() => pick(() => true)}>すべて</button>
          <button type="button" className="btn ghost" onClick={() => setDays(new Set())}>クリア</button>
        </div>
        <div className="slot-cal">
          {WD.map((w, i) => <div key={w} className={`slc-h${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={'b' + i} />)}
          {Array.from({ length: nd }, (_, i) => i + 1).map((d) => {
            const k = key(d), on = days.has(k), n = byDay.get(k)?.length ?? 0, it = info[k], b = it?.brief;
            const late = !!b && [...b.ins, ...b.outs].some((x) => x.late);
            return <button key={k} type="button" className={`slc-d${on ? ' on' : ''}${look === k ? ' look' : ''}${wd(d) === 0 ? ' sun' : wd(d) === 6 ? ' sat' : ''}`} aria-pressed={on} onClick={() => toggle(k)}
              title={[b ? `入荷${b.ins.length}件・出荷${b.outs.length}件${late ? '（遅れあり）' : ''}` : '', ...(it?.tasks ?? []).map((t) => t.title)].filter(Boolean).join('\n') || undefined}>
              <b>{d}</b>
              {b && <span className={`slc-lb${late ? ' late' : ''}`}>{b.ins.length > 0 && <i className="in">入{b.ins.length}</i>}{b.outs.length > 0 && <i className="out">出{b.outs.length}</i>}</span>}
              {(it?.tasks.length ?? 0) > 0 && <span className="slc-tk">予定{it!.tasks.length}</span>}
              {n > 0 && <small>{n}枠</small>}
            </button>;
          })}
        </div>
        <p className="sub cal-legend" style={{ margin: '6px 0 0' }}>
          <span><i className="clb-k in">入</i>入荷・</span><span><i className="clb-k out">出</i>出荷の件数（受発注台帳・今日以降）</span>・<span className="slc-tk">予定</span>予定表のやること。日を押すと、下に中身が出ます。
        </p>
        {look && <DayDetail date={look} info={info[look]} ledgerAt={ledgerAt} today={today} slots={byDay.get(look) ?? []} onClose={() => setLook(null)} />}
        <div className="actions">
          <button className="btn primary" disabled={pending || !days.size} onClick={() => run(() => createSlotsAction(storeId, [...days].sort(), start, end, cap, label), () => setDays(new Set()))}>
            {days.size ? `${days.size}日分に「${label || '枠'} ${hm(start)}〜${hm(end)}・${cap}人」を作る` : '日を選んでください'}
          </button>
        </div>
      </div>

      <h2 className="sec">{month}月の枠</h2>
      {!slots.length ? <div className="empty"><b>まだ枠がありません</b>上の「枠を作る」で作ってください。</div> : (
        <div className="grid-wrap"><table className="tbl stack slot-list"><tbody>
          {[...byDay.entries()].map(([d, xs]) => xs.map((s, i) => {
            const open = s.capacity - s.filled, dd = Number(d.slice(8));
            return (
              <tr key={s.id}>
                <td className="head">{i === 0 ? <b>{month}/{dd}({WD[wd(dd)]})</b> : <span />}</td>
                <td data-label="枠">
                  {edit?.id === s.id ? (
                    <span className="htimes">
                      <input className="in" aria-label="作業" value={edit.label} maxLength={20} style={{ width: 90 }} onChange={(e) => setEdit({ ...edit, label: e.target.value })} />
                      <TimeSel label="始まり" value={edit.start} onChange={(v) => setEdit({ ...edit, start: v, end: edit.end <= v ? v + 60 : edit.end })} />〜
                      <TimeSel label="終わり" value={edit.end} min={edit.start} onChange={(v) => setEdit({ ...edit, end: v })} />
                      <input className="in num" aria-label="人数" type="number" min={1} max={99} value={edit.capacity} style={{ width: 64 }} onChange={(e) => setEdit({ ...edit, capacity: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />人
                    </span>
                  ) : <span>{s.label && <b>{s.label} </b>}<span className="num">{hm(s.start)}〜{hm(s.end)}</span></span>}
                </td>
                <td data-label="人数"><span className={`num ${open > 0 ? 'ok-t' : 'sub'}`}>{s.filled}/{s.capacity}人{open > 0 ? `（空き${open}）` : open < 0 ? `（${-open}人多い）` : '（満員）'}</span></td>
                <td data-label="入っている人" className="wrap"><span className="sub">{s.names.join('、') || 'なし'}</span></td>
                <td className="acts" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {edit?.id === s.id ? <>
                    <button className="btn" onClick={() => setEdit(null)}>戻る</button>{' '}
                    <button className="btn primary" disabled={pending} onClick={() => run(() => updateSlotAction(s.id, edit.start, edit.end, edit.capacity, edit.label), () => setEdit(null))}>保存</button>
                  </> : <>
                    <button className="btn" onClick={() => setEdit(s)}>直す</button>{' '}
                    <button className="btn ghost danger" disabled={pending} onClick={() => run(() => deleteSlotsAction([s.id]))}>消す</button>
                  </>}
                </td>
              </tr>
            );
          }))}
        </tbody></table></div>
      )}
    </>
  );
}

/** 押した日の入荷・出荷とやること（枠を作るときの参考） */
function DayDetail({ date, info, ledgerAt, today, slots, onClose }: { date: string; info?: DayInfo; ledgerAt: string | null; today: string; slots: SlotRow[]; onClose: () => void }) {
  const [y, m, d] = date.split('-').map(Number);
  const tasks = info?.tasks ?? [];
  return (
    <div className="slot-day">
      <div className="row"><b>{m}/{d}({WD[new Date(y, m - 1, d).getDay()]}) の中身</b><span className="grow" /><button type="button" className="btn ghost" onClick={onClose}>閉じる</button></div>
      {slots.length > 0 && <div className="sub">作ってある枠：{slots.map((s) => `${s.label ? s.label + ' ' : ''}${hm(s.start)}〜${hm(s.end)}（${s.filled}/${s.capacity}人）`).join('、')}</div>}
      <div className="slot-day-g">
        <div>
          {!ledgerAt ? <p className="sub" style={{ margin: 0 }}>受発注台帳がまだ届いていないため、入荷・出荷は出せません。</p>
            : date < today ? <p className="sub" style={{ margin: 0 }}>過ぎた日の入荷・出荷は出しません。</p>
            : <LedgerBrief brief={info?.brief ?? null} date={date} receivedAt={new Date(ledgerAt)} />}
        </div>
        <div>
          <div className="brief-h"><b>やること</b><span className="sub">予定表</span></div>
          {!tasks.length ? <p className="sub" style={{ margin: 0 }}>予定表に書かれた予定はありません。</p> : (
            <ul className="slot-tasks">
              {tasks.map((t, i) => (
                <li key={i} className={t.done ? 'done' : ''}>
                  {t.at !== null && <span className="num">{hm(t.at)} </span>}<span>{t.title}</span>
                  {(t.who || t.note || t.done) && <span className="sub">{[t.who && `${t.who}さん`, t.note && 'メモ', t.done && '済'].filter(Boolean).join('・')}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
