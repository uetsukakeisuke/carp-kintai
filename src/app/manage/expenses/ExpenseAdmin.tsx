'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addExpenseAction, updateExpenseAction, deleteExpenseAction, saveExpenseFooterAction, saveTripAction, deleteTripAction, rotateExpenseSecretAction,
} from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';
import {
  CATEGORIES, MAX_ITEMS, MAX_LINES, MAX_SCHEDULE, TRAVEL_KINDS, expenseTotals, tripTotals,
  type Category, type ExpenseItem, type ExpenseMonth, type Trip, type TripLine, type TripStop,
} from '@/lib/expenses';

type Res = { ok: true; message?: string } | { ok: false; error: string };
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const md = (d: string | null | undefined) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const num = (s: string) => { const n = Number(String(s).replace(/[,，円¥\s]/g, '')); return Number.isFinite(n) ? n : 0; };
/** その月の中の日（今日がその月なら今日、違えば1日） */
const dayIn = (ym: string, today: string) => (today.startsWith(ym) ? today : `${ym}-01`);

function useRun() {
  const [toast, node] = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Res>, after?: () => void) => start(async () => {
    const r = await call(fn);
    toast(r.ok ? r.message ?? '完了しました' : r.error);
    if (r.ok) after?.();
    router.refresh();
  });
  return { run, pending, node, toast };
}

// ===================== 現金経費精算 =====================
type ItemDraft = { day: string; category: Category; payee: string; amount: string; doc: string; subject: string };
const toDraft = (it: ExpenseItem): ItemDraft => ({ day: it.day ?? '', category: it.category, payee: it.payee, amount: String(it.amount), doc: it.doc ?? '', subject: it.subject ?? '' });

export function ExpenseBoard({ ym, today, items: initial, month, defaultPerson }: {
  ym: string; today: string; items: ExpenseItem[]; month: ExpenseMonth | null; defaultPerson: string;
}) {
  const { run, pending, node } = useRun();
  const [items, setItems] = useState(initial);
  useEffect(() => setItems(initial), [initial]);
  const [editing, setEditing] = useState<number | null>(null);
  const t = expenseTotals(items);
  const full = items.length >= MAX_ITEMS;

  return (
    <>
      {full
        ? <p className="banner warn" style={{ margin: '0 0 10px' }}>用紙の行数（{MAX_ITEMS}行）に達しました。まとめられる行をまとめてください。</p>
        : <ItemForm key={`add-${ym}`} ym={ym} busy={pending} submitLabel="追加" keepAfter
          initial={{ day: dayIn(ym, today), category: '消耗品費', payee: '', amount: '', doc: '', subject: '' }}
          onSubmit={(v, done) => run(() => addExpenseAction({ ...v, ym }), done)} />}

      {items.length > 0 ? (
        <ul className="ex-list" aria-label="この月の経費">
          {items.map((it) => (
            <li key={it.id} className="ex-row">
              <span className="ex-d num">{md(it.day) || '—'}</span>
              <span className="ex-t">
                <b>{it.payee}</b>
                <small><span className="ex-cat">{it.category === 'その他' && it.subject ? `その他（${it.subject}）` : it.category}</span>{it.doc}</small>
              </span>
              <span className="ex-amt num">{yen(it.amount)}</span>
              <button type="button" className="btn ghost tk-edit" onClick={() => setEditing(editing === it.id ? null : it.id)} aria-expanded={editing === it.id}>
                {editing === it.id ? '閉じる' : '編集'}
              </button>
              {editing === it.id && (
                <div className="tk-form">
                  <ItemForm ym={ym} busy={pending} submitLabel="保存" initial={toDraft(it)}
                    onSubmit={(v) => run(() => updateExpenseAction(it.id, { ...v, ym }), () => setEditing(null))}
                    onDelete={() => { if (window.confirm(`「${it.payee}」（${yen(it.amount)}）を消しますか？`)) run(() => deleteExpenseAction(it.id), () => setEditing(null)); }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="sub" style={{ margin: '12px 0 0' }}>この月の経費はまだありません。上の欄から1件ずつ入れてください。</p>}

      {items.length > 0 && (
        <div className="ex-sum">
          {CATEGORIES.filter((c) => t.byCat[c]).map((c) => <span key={c}>{c} <b>{yen(t.byCat[c])}</b></span>)}
          <span className="ex-total">合計 <b>{yen(t.total)}</b><small className="sub">（{items.length}/{MAX_ITEMS}行）</small></span>
        </div>
      )}

      <FooterForm key={`f-${ym}`} ym={ym} month={month} defaultPerson={defaultPerson} busy={pending}
        onSubmit={(v) => run(() => saveExpenseFooterAction({ ...v, ym }))} />
      {node}
    </>
  );
}

function ItemForm({ ym, initial, busy, submitLabel, onSubmit, onDelete, keepAfter }: {
  ym: string; initial: ItemDraft; busy: boolean; submitLabel: string; keepAfter?: boolean;
  onSubmit: (v: ItemDraft, done: () => void) => void; onDelete?: () => void;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof ItemDraft>(k: K, x: ItemDraft[K]) => setV((o) => ({ ...o, [k]: x }));
  const ok = v.payee.trim() && num(v.amount) !== 0;
  const outside = v.day && !v.day.startsWith(ym);
  const submit = () => {
    if (!ok) return;
    // 追加したら、日付と科目はそのまま（続けて入れやすく）
    onSubmit(v, () => { if (keepAfter) setV((o) => ({ ...o, payee: '', amount: '', doc: '', subject: '' })); });
  };
  return (
    <form className="ex-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="ex-grid">
        <label className="field"><span>日付</span><input className="in" type="date" value={v.day} onChange={(e) => set('day', e.target.value)} /></label>
        <label className="field"><span>金額（円）</span><input className="in num" inputMode="numeric" value={v.amount} onChange={(e) => set('amount', e.target.value)} placeholder="例：3300" /></label>
        <label className="field"><span>科目</span>
          <select className="sel" value={v.category} onChange={(e) => set('category', e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {v.category === 'その他' && <label className="field"><span>その他の科目</span><input className="in" value={v.subject} onChange={(e) => set('subject', e.target.value)} maxLength={30} placeholder="例：雑費" /></label>}
        <label className="field ex-wide"><span>支払内容／支払先</span><input className="in" value={v.payee} onChange={(e) => set('payee', e.target.value)} maxLength={100} placeholder="例：コピー用紙　アスクル" /></label>
        <label className="field"><span>資料（なくてもよい）</span><input className="in" value={v.doc} onChange={(e) => set('doc', e.target.value)} maxLength={30} placeholder="例：領収書" /></label>
      </div>
      {outside && <p className="sub" style={{ margin: 0 }}>日付が{Number(ym.slice(5))}月ではありませんが、{Number(ym.slice(5))}月分の精算として入れます。</p>}
      <div className="row" style={{ justifyContent: onDelete ? 'space-between' : 'flex-end' }}>
        {onDelete && <button type="button" className="btn ghost bad-t" onClick={onDelete} disabled={busy}>消す</button>}
        <button type="submit" className="btn primary" disabled={busy || !ok}>{submitLabel}</button>
      </div>
    </form>
  );
}

function FooterForm({ ym, month, defaultPerson, busy, onSubmit }: {
  ym: string; month: ExpenseMonth | null; defaultPerson: string; busy: boolean;
  onSubmit: (v: { settleDate: string | null; settleMethod: string | null; person: string }) => void;
}) {
  const [date, setDate] = useState(month?.settleDate ?? '');
  const [method, setMethod] = useState<string>(month?.settleMethod ?? '');
  const [person, setPerson] = useState(month?.person ?? defaultPerson);
  const dirty = (month?.settleDate ?? '') !== date || (month?.settleMethod ?? '') !== method || (month?.person ?? defaultPerson) !== person || !month;
  void ym;
  return (
    <details className="ex-foot">
      <summary>精算書の下の欄（精算日・精算方法・氏名）{month?.settleDate ? `：${md(month.settleDate)} ${month.settleMethod === 'bank' ? '銀行振込' : month.settleMethod === 'cash' ? '現金' : ''}` : ''}</summary>
      <div className="ex-grid" style={{ marginTop: 8 }}>
        <label className="field"><span>精算日</span><input className="in" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field"><span>精算方法</span>
          <select className="sel" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">（決めていない）</option><option value="bank">銀行振込</option><option value="cash">現金</option>
          </select>
        </label>
        <label className="field"><span>氏名</span><input className="in" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={30} /></label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => onSubmit({ settleDate: date || null, settleMethod: method || null, person })}>保存</button>
      </div>
    </details>
  );
}

// ===================== 旅費精算 =====================
type TripDraft = {
  appliedOn: string; dept: string; person: string; destination: string;
  schedule: TripStop[]; diemUnit: string; diemDays: string; lodgeUnit: string; lodgeNights: string;
  lines: { date: string; kind: string; memo: string; amount: string }[]; advance: string;
};
const tripDraft = (t: Trip): TripDraft => ({
  appliedOn: t.appliedOn ?? '', dept: t.dept, person: t.person, destination: t.destination,
  schedule: t.schedule.length ? t.schedule : [{ from: '', to: '', place: '', detail: '' }],
  diemUnit: String(t.diemUnit), diemDays: t.diemDays ? String(t.diemDays) : '', lodgeUnit: String(t.lodgeUnit), lodgeNights: t.lodgeNights ? String(t.lodgeNights) : '',
  lines: t.lines.length ? t.lines.map((l) => ({ ...l, amount: String(l.amount) })) : [{ date: '', kind: '', memo: '', amount: '' }],
  advance: t.advance ? String(t.advance) : '',
});
const period = (t: Trip) => {
  const ds = t.schedule.flatMap((s) => [s.from, s.to]).filter(Boolean).sort();
  return ds.length ? (ds[0] === ds[ds.length - 1] ? md(ds[0]) : `${md(ds[0])}〜${md(ds[ds.length - 1])}`) : '';
};

export function TripList({ ym, today, trips, defaults }: { ym: string; today: string; trips: Trip[]; defaults: { dept: string; person: string } }) {
  const { run, pending, node } = useRun();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const blank: Trip = {
    id: 0, ym, appliedOn: today, dept: defaults.dept, person: defaults.person, destination: '', schedule: [],
    diemUnit: 5000, diemDays: 0, lodgeUnit: 10000, lodgeNights: 0, lines: [], advance: 0,
  };
  const save = (id: number | null, v: TripDraft) => run(async () => {
    const r = await saveTripAction(id, { ...v, ym });
    return r.ok ? { ok: true, message: r.message } : r;
  }, () => setEditing(null));

  return (
    <>
      {trips.length > 0 && (
        <ul className="ex-list" aria-label="この月の旅費精算書">
          {trips.map((t, i) => {
            const tt = tripTotals(t);
            return (
              <li key={t.id} className="ex-row tr-item">
                <span className="ex-d num">{i + 1}枚目</span>
                <span className="ex-t"><b>{t.destination || '（出張先なし）'}</b><small>{[period(t), t.person].filter(Boolean).join('・')}</small></span>
                <span className="ex-amt num">{yen(tt.net)}</span>
                <button type="button" className="btn ghost tk-edit" onClick={() => setEditing(editing === t.id ? null : t.id)} aria-expanded={editing === t.id}>
                  {editing === t.id ? '閉じる' : '編集'}
                </button>
                {editing === t.id && (
                  <div className="tk-form">
                    <TripForm initial={t} busy={pending} onSave={(v) => save(t.id, v)} onCancel={() => setEditing(null)}
                      onDelete={() => { if (window.confirm(`旅費精算書（${t.destination || '出張先なし'}）を消しますか？`)) run(() => deleteTripAction(t.id), () => setEditing(null)); }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing === 'new' ? (
        <div className="tk-form" style={{ marginTop: 10 }}>
          <b>新しい旅費精算書</b>
          <TripForm initial={blank} busy={pending} onSave={(v) => save(null, v)} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        <div className="row" style={{ marginTop: trips.length ? 10 : 0 }}>
          {!trips.length && <span className="sub grow">この月の出張はまだありません。</span>}
          <button type="button" className="btn" onClick={() => setEditing('new')}>＋ 出張を追加</button>
        </div>
      )}
      {node}
    </>
  );
}

function TripForm({ initial, busy, onSave, onCancel, onDelete }: { initial: Trip; busy: boolean; onSave: (v: TripDraft) => void; onCancel: () => void; onDelete?: () => void }) {
  const [v, setV] = useState(() => tripDraft(initial));
  const set = <K extends keyof TripDraft>(k: K, x: TripDraft[K]) => setV((o) => ({ ...o, [k]: x }));
  const setStop = (i: number, k: keyof TripStop, x: string) => set('schedule', v.schedule.map((s, j) => (j === i ? { ...s, [k]: x } : s)));
  const setLine = (i: number, k: keyof TripLine, x: string) => set('lines', v.lines.map((s, j) => (j === i ? { ...s, [k]: x } : s)));
  const tt = useMemo(() => tripTotals({
    diemUnit: num(v.diemUnit), diemDays: num(v.diemDays), lodgeUnit: num(v.lodgeUnit), lodgeNights: num(v.lodgeNights),
    lines: v.lines.map((l) => ({ date: l.date, kind: l.kind, memo: l.memo, amount: num(l.amount) })), advance: num(v.advance),
  }), [v]);
  const listId = `kinds-${initial.id}`;
  return (
    <form className="tr-form" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <div className="ex-grid">
        <label className="field"><span>申請日</span><input className="in" type="date" value={v.appliedOn} onChange={(e) => set('appliedOn', e.target.value)} /></label>
        <label className="field"><span>所属</span><input className="in" value={v.dept} onChange={(e) => set('dept', e.target.value)} maxLength={50} /></label>
        <label className="field"><span>氏名</span><input className="in" value={v.person} onChange={(e) => set('person', e.target.value)} maxLength={30} /></label>
        <label className="field ex-wide"><span>出張先</span><input className="in" value={v.destination} onChange={(e) => set('destination', e.target.value)} maxLength={100} placeholder="例：東京（展示会）" /></label>
      </div>

      <h4 className="tr-h">出張スケジュール <small className="sub">{MAX_SCHEDULE}行まで</small></h4>
      <div className="tr-rows">
        {v.schedule.map((s, i) => (
          <div key={i} className="tr-row tr-stop">
            <label className="field"><span>から</span><input className="in" type="date" value={s.from} onChange={(e) => setStop(i, 'from', e.target.value)} /></label>
            <label className="field"><span>まで</span><input className="in" type="date" value={s.to} onChange={(e) => setStop(i, 'to', e.target.value)} /></label>
            <label className="field tr-wide"><span>訪問先</span><input className="in" value={s.place} onChange={(e) => setStop(i, 'place', e.target.value)} maxLength={50} /></label>
            <label className="field tr-wide2"><span>日程及び内容</span><input className="in" value={s.detail} onChange={(e) => setStop(i, 'detail', e.target.value)} maxLength={100} /></label>
            <button type="button" className="btn ghost tr-x" aria-label={`${i + 1}行目を消す`} onClick={() => set('schedule', v.schedule.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>
      {v.schedule.length < MAX_SCHEDULE && <button type="button" className="btn ghost tr-add" onClick={() => set('schedule', [...v.schedule, { from: '', to: '', place: '', detail: '' }])}>＋ 行を足す</button>}

      <h4 className="tr-h">日当</h4>
      <div className="tr-diem">
        <span className="tr-k">出張日当</span>
        <label className="field"><span>単価</span><input className="in num" inputMode="numeric" value={v.diemUnit} onChange={(e) => set('diemUnit', e.target.value)} /></label>
        <label className="field"><span>日数</span><input className="in num" inputMode="decimal" value={v.diemDays} onChange={(e) => set('diemDays', e.target.value)} placeholder="0" /></label>
        <b className="num tr-amt">{yen(tt.diem)}</b>
        <span className="tr-k">宿泊日当</span>
        <label className="field"><span>単価</span><input className="in num" inputMode="numeric" value={v.lodgeUnit} onChange={(e) => set('lodgeUnit', e.target.value)} /></label>
        <label className="field"><span>泊数</span><input className="in num" inputMode="decimal" value={v.lodgeNights} onChange={(e) => set('lodgeNights', e.target.value)} placeholder="0" /></label>
        <b className="num tr-amt">{yen(tt.lodge)}</b>
      </div>

      <h4 className="tr-h">交通費その他出張中の支出 <small className="sub">{MAX_LINES}行まで</small></h4>
      <datalist id={listId}>{TRAVEL_KINDS.map((k) => <option key={k} value={k} />)}</datalist>
      <div className="tr-rows">
        {v.lines.map((l, i) => (
          <div key={i} className="tr-row tr-line">
            <label className="field"><span>日付</span><input className="in" type="date" value={l.date} onChange={(e) => setLine(i, 'date', e.target.value)} /></label>
            <label className="field"><span>区分</span><input className="in" list={listId} value={l.kind} onChange={(e) => setLine(i, 'kind', e.target.value)} maxLength={20} placeholder="新幹線" /></label>
            <label className="field tr-wide"><span>摘要</span><input className="in" value={l.memo} onChange={(e) => setLine(i, 'memo', e.target.value)} maxLength={100} placeholder="例：京都→東京 往復" /></label>
            <label className="field tr-money"><span>金額（円）</span><input className="in num" inputMode="numeric" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} /></label>
            <button type="button" className="btn ghost tr-x" aria-label={`${i + 1}行目を消す`} onClick={() => set('lines', v.lines.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>
      {v.lines.length < MAX_LINES && <button type="button" className="btn ghost tr-add" onClick={() => set('lines', [...v.lines, { date: '', kind: '', memo: '', amount: '' }])}>＋ 行を足す</button>}

      <div className="tr-total">
        <div><span>日当・宿泊日当合計</span><b className="num">{yen(tt.allowance)}</b></div>
        <div><span>交通費その他</span><b className="num">{yen(tt.lines)}</b></div>
        <label className="field"><span>仮払金（円）</span><input className="in num" inputMode="numeric" value={v.advance} onChange={(e) => set('advance', e.target.value)} placeholder="0" /></label>
        <div className="tr-net"><span>差引支払額</span><b className="num">{yen(tt.net)}</b></div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        {onDelete ? <button type="button" className="btn ghost bad-t" onClick={onDelete} disabled={busy}>この精算書を消す</button> : <span />}
        <span className="row">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>やめる</button>
          <button type="submit" className="btn primary" disabled={busy}>保存</button>
        </span>
      </div>
    </form>
  );
}

export function RotateExpenseSecret() {
  return <ActionButton className="btn ghost" confirmText="合言葉を作り直すと、今のスクリプトは使えなくなります。作り直しますか？" action={rotateExpenseSecretAction}>合言葉を作り直す</ActionButton>;
}
