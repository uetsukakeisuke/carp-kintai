'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { editPunchesAction } from '@/app/actions';
import { summarizeDay, NEXT, type PunchKind } from '@/lib/calc';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';

const LABEL: Record<PunchKind, string> = { in: '出勤', break_start: '休憩開始', break_end: '休憩終了', out: '退勤' };
const KINDS: PunchKind[] = ['in', 'break_start', 'break_end', 'out'];
const HOURS = Array.from({ length: 30 }, (_, i) => i); // 0〜29時（24時以降は翌日）
const MINS = Array.from({ length: 60 }, (_, i) => i);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
type Row = { key: number; id?: number; kind: PunchKind; minute: number };

function Editor({ staffId, name, date, dateText, punches, plan, onClose, onSaved }: {
  staffId: number; name: string; date: string; dateText: string; punches: { id: number; kind: PunchKind; minute: number }[]; plan: { start: number; end: number } | null; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<Row[]>(() => punches.map((p, i) => ({ key: i, id: p.id, kind: p.kind, minute: p.minute })));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  let seq = 100;
  const sorted = [...rows].sort((a, b) => a.minute - b.minute);
  // 順番のチェック（出勤 →（休憩開始 → 休憩終了）→ 退勤）
  let bad = '';
  { let last: PunchKind | 'none' = 'none'; for (const r of sorted) { if (!NEXT[last].includes(r.kind)) { bad = `${LABEL[r.kind]} ${hm(r.minute)} の順番が正しくありません`; break; } last = r.kind; } }
  const sum = summarizeDay(sorted, { isPast: true });
  const upd = (key: number, v: Partial<Row>) => setRows((x) => x.map((r) => (r.key === key ? { ...r, ...v } : r)));
  const add = () => {
    const last = sorted[sorted.length - 1];
    const kind: PunchKind = last ? NEXT[last.kind][NEXT[last.kind].length - 1] : 'in';
    const minute = last ? Math.min(last.minute + 60, 29 * 60 + 59) : plan?.start ?? 600;
    setRows((x) => [...x, { key: Date.now() + seq++, kind, minute }]);
  };
  const fillPlan = () => plan && setRows((x) => [...x.filter((r) => r.id).map((r) => r), ...(x.some((r) => r.kind === 'in') ? [] : [{ key: Date.now(), kind: 'in' as PunchKind, minute: plan.start }]), ...(x.some((r) => r.kind === 'out') ? [] : [{ key: Date.now() + 1, kind: 'out' as PunchKind, minute: plan.end }])]);
  const save = () => {
    setErr('');
    start(async () => {
      const r = await call(() => editPunchesAction(staffId, date, sorted.map((x) => ({ id: x.id ?? null, kind: x.kind, minute: x.minute })), reason));
      if (!r.ok) { setErr(r.error); return; }
      onSaved(r.message ?? '直しました'); onClose(); router.refresh();
    });
  };
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="peT">
        <h3 id="peT">{name}　{dateText}の勤怠を直す</h3>
        <div className="meta">{plan ? `予定 ${hm(plan.start)}〜${hm(plan.end)}` : '予定なし'}・24時以降は翌日（例 25:30＝翌1:30）</div>
        <div className="pe-rows">
          {sorted.map((r) => (
            <div key={r.key} className="pe-row">
              <select className="sel" value={r.kind} onChange={(e) => upd(r.key, { kind: e.target.value as PunchKind })} aria-label="種類">
                {KINDS.map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
              </select>
              <select className="sel num" value={Math.floor(r.minute / 60)} onChange={(e) => upd(r.key, { minute: Number(e.target.value) * 60 + (r.minute % 60) })} aria-label="時">
                {HOURS.map((h) => <option key={h} value={h}>{h}時{h >= 24 ? '(翌)' : ''}</option>)}
              </select>
              <select className="sel num" value={r.minute % 60} onChange={(e) => upd(r.key, { minute: Math.floor(r.minute / 60) * 60 + Number(e.target.value) })} aria-label="分">
                {MINS.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}分</option>)}
              </select>
              <button type="button" className="btn ghost pe-del" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} aria-label={`${LABEL[r.kind]}を消す`}>×</button>
            </div>
          ))}
          {!sorted.length && <p className="sub" style={{ margin: 0 }}>打刻がありません。「＋ 打刻を足す」で入れてください。</p>}
        </div>
        <div className="row" style={{ gap: 8, margin: '8px 0' }}>
          <button type="button" className="btn" onClick={add}>＋ 打刻を足す</button>
          {plan && !rows.some((r) => r.kind === 'in' || r.kind === 'out') && <button type="button" className="btn" onClick={fillPlan}>予定どおり入れる</button>}
          {plan && rows.some((r) => r.kind === 'in') && !rows.some((r) => r.kind === 'out') && <button type="button" className="btn" onClick={() => setRows((x) => [...x, { key: Date.now(), kind: 'out', minute: plan.end }])}>退勤を予定の{hm(plan.end)}で入れる</button>}
        </div>
        {bad ? <p className="err">{bad}。出勤 →（休憩開始 → 休憩終了）→ 退勤 の順にしてください。</p>
          : sorted.length > 0 && <div className="delta">実働 <b className="num">{(sum.workMin / 60).toFixed(2).replace(/\.?0+$/, '')}時間</b>（休憩 {sum.breakMin}分）{sum.state === 'missing' && '・退勤がまだありません'}</div>}
        <label className="sub" htmlFor="peR" style={{ display: 'block', marginTop: 10 }}>理由（任意）</label>
        <input id="peR" className="in" style={{ width: '100%' }} value={reason} maxLength={200} placeholder="例：退勤の押し忘れ" onChange={(e) => setReason(e.target.value)} />
        {err && <p className="err" role="alert">{err}</p>}
        <p className="sub" style={{ margin: '8px 0 0' }}>直した打刻は「修正済み」と表示され、修正前の時刻と理由が記録に残ります。</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>キャンセル</button>
          <button className="btn primary" disabled={pending || !!bad} onClick={save}>{pending ? '保存中…' : '保存する'}</button>
        </div>
      </div>
    </div>
  );
}

/** 勤怠実績の各行の「直す」ボタン */
export function EditPunchesButton(p: { staffId: number; name: string; date: string; dateText: string; punches: { id: number; kind: PunchKind; minute: number }[]; plan: { start: number; end: number } | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const [toast, node] = useToast();
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>{p.label ?? '直す'}</button>
      {open && <Editor {...p} onClose={() => setOpen(false)} onSaved={toast} />}
      {node}
    </>
  );
}

/** 予定にない人の勤務を入れる */
export function AddAttendance({ staff, date, dateText }: { staff: { id: number; name: string }[]; date: string; dateText: string }) {
  const [sel, setSel] = useState(0);
  const st = staff.find((s) => s.id === sel);
  return (
    <div className="row" style={{ gap: 8 }}>
      <select className="sel" value={sel} onChange={(e) => setSel(Number(e.target.value))} aria-label="勤務を入れるスタッフ">
        <option value={0}>スタッフを選ぶ</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {st ? <EditPunchesButton staffId={st.id} name={st.name} date={date} dateText={dateText} punches={[]} plan={null} label="勤務を入れる" /> : <button className="btn" disabled>勤務を入れる</button>}
    </div>
  );
}
