'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addTaskAction, updateTaskAction, deleteTaskAction, moveTasksAction, toggleTaskAction } from '@/app/actions';
import { TaskLine, type TaskItem } from '@/components/TaskList';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';

type Person = { id: number; name: string; shift: string | null };
type Opt = { id: number; name: string };
const toMin = (v: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const toHm = (m: number | null) => (m === null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export function TaskBoard(p: { storeId: number; date: string; today: string; items: TaskItem[]; people: Person[]; staff: Opt[]; leftovers: TaskItem[] }) {
  const [toast, node] = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [items, setItems] = useState(p.items);
  useEffect(() => setItems(p.items), [p.items]);
  const [editing, setEditing] = useState<number | null>(null);

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) => start(async () => {
    const r = await call(fn);
    toast(r.ok ? r.message ?? '完了しました' : r.error);
    if (r.ok) after?.();
    router.refresh();
  });
  const toggle = (t: TaskItem, done: boolean) => {
    setItems((l) => l.map((x) => (x.id === t.id ? { ...x, doneAt: done ? new Date().toISOString() : null, doneBy: done ? 'あなた' : null } : x)));
    start(async () => { const r = await call(() => toggleTaskAction(t.id, done)); if (!r.ok) { toast(r.error); setItems(p.items); } router.refresh(); });
  };

  const list = (staffId: number | null) => items.filter((t) => t.staffId === staffId);
  const lines = (ts: TaskItem[]) => ts.length > 0 && (
    <ul className="tks">
      {ts.map((t) => (
        <TaskLine key={t.id} t={t} canCheck onToggle={(d) => toggle(t, d)}>
          <button type="button" className="btn ghost tk-edit" onClick={() => setEditing(editing === t.id ? null : t.id)} aria-expanded={editing === t.id}>
            {editing === t.id ? '閉じる' : '編集'}
          </button>
          {editing === t.id && (
            <EditForm t={t} staff={p.staff} busy={pending}
              onSave={(v) => run(() => updateTaskAction(t.id, { ...v, storeId: p.storeId }), () => setEditing(null))}
              onDelete={() => { if (window.confirm(`「${t.title}」を消しますか？`)) run(() => deleteTaskAction(t.id), () => setEditing(null)); }} />
          )}
        </TaskLine>
      ))}
    </ul>
  );
  const add = (staffId: number | null, v: { title: string; kind: 'task' | 'note'; at: string }, done: () => void) =>
    run(() => addTaskAction({ storeId: p.storeId, date: p.date, staffId, kind: v.kind, title: v.title, note: null, atMin: toMin(v.at) }), done);

  const onShift = new Set(p.people.map((x) => x.id));
  const others = p.staff.filter((s) => !onShift.has(s.id));
  const open = p.leftovers;

  return (
    <>
      {open.length > 0 && p.date >= p.today && (
        <section className="card tk-left">
          <div className="item-h"><b>終わっていない作業</b><span className="sub">（前の日まで・14日分）</span>
            <span className="end"><button className="btn" disabled={pending} onClick={() => run(() => moveTasksAction(open.map((t) => t.id), p.date))}>全部{md(p.date)}に回す</button></span>
          </div>
          <ul className="tks">
            {open.map((t) => (
              <TaskLine key={t.id} t={t} canCheck onToggle={(d) => toggle(t, d)}>
                <span className="tk-who">{md(t.date)}・{t.staffName ?? '全体'}</span>
                <button type="button" className="btn ghost tk-edit" disabled={pending} onClick={() => run(() => moveTasksAction([t.id], p.date))}>{md(p.date)}に回す</button>
              </TaskLine>
            ))}
          </ul>
        </section>
      )}

      <section className="card tk-sec">
        <div className="tk-sh"><b>全体</b><span className="sub">その日に出勤する人みんなに見えます</span></div>
        {lines(list(null))}
        <AddRow placeholder="例：FedEx集荷 15時／石山さん来社" onAdd={(v, done) => add(null, v, done)} busy={pending} />
      </section>

      <div className="tk-people">
        {p.people.map((x) => (
          <section key={x.id} className="card tk-sec">
            <div className="tk-sh"><b>{x.name}</b><span className="sub num">{x.shift ?? 'シフトなし'}</span></div>
            {lines(list(x.id))}
            <AddRow placeholder="この人の作業を追加" onAdd={(v, done) => add(x.id, v, done)} busy={pending} />
          </section>
        ))}
      </div>

      <section className="card tk-sec">
        <div className="tk-sh"><b>ほかの人に作業を入れる</b><span className="sub">シフトが入っていない人にも入れられます</span></div>
        <OtherAdd staff={others} busy={pending} onAdd={(sid, v, done) => add(sid, v, done)} />
      </section>
      {node}
    </>
  );
}

/** 追加の1行：内容を入れると種類・時刻が出る。Enterでも追加 */
function AddRow({ placeholder, onAdd, busy, extra }: {
  placeholder: string; busy: boolean; extra?: React.ReactNode;
  onAdd: (v: { title: string; kind: 'task' | 'note'; at: string }, done: () => void) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'task' | 'note'>('task');
  const [at, setAt] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const submit = () => { if (title.trim()) onAdd({ title, kind, at }, () => { setTitle(''); setAt(''); setKind('task'); ref.current?.focus(); }); };
  return (
    <form className="tk-add" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {extra}
      <div className="tk-add-line">
        <input ref={ref} className="in tk-add-t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label="追加する内容" maxLength={200} />
        <button className="btn primary" type="submit" disabled={busy || !title.trim()}>追加</button>
      </div>
      {title.trim() && (
        <div className="tk-add-more">
          <select className="sel" value={kind} onChange={(e) => setKind(e.target.value as 'task' | 'note')} aria-label="種類">
            <option value="task">作業（終わったらチェック）</option><option value="note">予定・連絡（チェックなし）</option>
          </select>
          <input className="in tk-add-at" type="time" value={at} onChange={(e) => setAt(e.target.value)} aria-label="時刻（なくてもよい）" step={300} />
        </div>
      )}
    </form>
  );
}

function OtherAdd({ staff, busy, onAdd }: { staff: Opt[]; busy: boolean; onAdd: (sid: number, v: { title: string; kind: 'task' | 'note'; at: string }, done: () => void) => void }) {
  const [sid, setSid] = useState(0);
  if (!staff.length) return <p className="sub" style={{ margin: 0 }}>全員この日のシフトに入っています。</p>;
  return (
    <AddRow placeholder="作業を追加" busy={busy || !sid}
      extra={<select className="sel tk-add-who" value={sid} onChange={(e) => setSid(Number(e.target.value))} aria-label="担当"><option value={0}>担当を選ぶ</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      onAdd={(v, done) => { if (sid) onAdd(sid, v, done); }} />
  );
}

function EditForm({ t, staff, busy, onSave, onDelete }: {
  t: TaskItem; staff: Opt[]; busy: boolean; onDelete: () => void;
  onSave: (v: { date: string; staffId: number | null; kind: 'task' | 'note'; title: string; note: string | null; atMin: number | null }) => void;
}) {
  const [title, setTitle] = useState(t.title);
  const [note, setNote] = useState(t.note ?? '');
  const [at, setAt] = useState(toHm(t.atMin));
  const [kind, setKind] = useState(t.kind);
  const [sid, setSid] = useState(t.staffId ?? 0);
  const [date, setDate] = useState(t.date);
  return (
    <div className="tk-form">
      <label className="field"><span>内容</span><input className="in" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></label>
      <label className="field"><span>メモ（くわしく）</span><textarea className="in" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
      <div className="tk-form-row">
        <label className="field"><span>担当</span><select className="sel" value={sid} onChange={(e) => setSid(Number(e.target.value))}>
          <option value={0}>全体</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="field"><span>種類</span><select className="sel" value={kind} onChange={(e) => setKind(e.target.value as 'task' | 'note')}>
          <option value="task">作業</option><option value="note">予定・連絡</option></select></label>
        <label className="field"><span>時刻</span><input className="in" type="time" value={at} onChange={(e) => setAt(e.target.value)} step={300} /></label>
        <label className="field"><span>日付</span><input className="in" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn ghost bad-t" onClick={onDelete} disabled={busy}>消す</button>
        <button type="button" className="btn primary" disabled={busy || !title.trim()}
          onClick={() => onSave({ date, staffId: sid || null, kind, title, note: note.trim() || null, atMin: toMin(at) })}>保存</button>
      </div>
    </div>
  );
}
