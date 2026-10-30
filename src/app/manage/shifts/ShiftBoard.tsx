'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveShiftAction, deleteShiftAction, publishAction } from '@/app/actions';
import { planCost, wageAt, minWageAt, type WageRate, type MinWage } from '@/lib/calc';
import { useToast } from '@/components/Toast';
import { Timeline } from '@/components/Timeline';
import { call } from '@/lib/call';

type Cell = { staff_id: number; work_date: string; start_min: number; end_min: number };
type Staff = { id: number; name: string; employment: string; transport: number };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const PATTERNS = [{ n: '早番', s: 540, e: 900 }, { n: '中番', s: 660, e: 1020 }, { n: '遅番', s: 1020, e: 1320 }, { n: 'ラスト', s: 1080, e: 1440 }, { n: '通し', s: 600, e: 1140 }, { n: 'ランチ', s: 660, e: 900 }];
const TIMES: number[] = []; for (let x = 360; x <= 1740; x += 15) TIMES.push(x);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const hs = (x: number) => (x % 60 ? hm(x) : String(x / 60));
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const man = (n: number) => Math.round(n).toLocaleString('ja-JP');

export function ShiftBoard(p: {
  store: { id: number; name: string; budget: number[] }; year: number; month: number; status: string;
  staff: Staff[]; rates: Record<string, WageRate[]>; minWages: MinWage[]; drafts: Cell[]; published: Cell[]; hopes: Cell[]; submitted: number[]; budgets: { work_date: string; amount: number }[];
}) {
  const router = useRouter();
  const [toast, toastNode] = useToast();
  const [pending, start] = useTransition();
  const nd = new Date(p.year, p.month, 0).getDate();
  const key = (d: number) => `${p.year}-${String(p.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const wd = (d: number) => new Date(p.year, p.month - 1, d).getDay();
  const [shifts, setShifts] = useState<Record<string, { s: number; e: number }>>(() => Object.fromEntries(p.drafts.map((c) => [`${c.staff_id}|${c.work_date}`, { s: c.start_min, e: c.end_min }])));
  const [status, setStatus] = useState(p.status);
  const hopes = useMemo(() => Object.fromEntries(p.hopes.map((c) => [`${c.staff_id}|${c.work_date}`, { s: c.start_min, e: c.end_min }])), [p.hopes]);
  const [ed, setEd] = useState<{ staffId: number; d: number; s: number; e: number; had: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [day, setDay] = useState<number | null>(null);
  const [view, setView] = useState<'month' | 'day'>('month');
  const [sel, setSel] = useState(1);
  useEffect(() => {
    // スマホは「日ごと」表示から始める（前回の選択を覚えておく）
    let v: string | null = null;
    try { v = localStorage.getItem('kintai-shift-view'); } catch {}
    setView(v === 'day' || v === 'month' ? v : window.innerWidth < 761 ? 'day' : 'month');
    const t = new Date(); if (t.getFullYear() === p.year && t.getMonth() + 1 === p.month) setSel(t.getDate());
  }, [p.year, p.month]);
  useEffect(() => {
    // 選んだ日を日付の帯の中央に寄せる（ページ全体はスクロールさせない）
    const el = document.getElementById(`ds-${sel}`), box = el?.parentElement;
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [sel, view]);
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  const changeView = (v: 'month' | 'day') => { setView(v); try { localStorage.setItem('kintai-shift-view', v); } catch {} };

  const rate = (id: number, date: string) => wageAt(p.rates[id] ?? [], date) ?? 0;
  const budgetOf = (d: number) => { const o = p.budgets.find((b) => b.work_date === key(d)); if (o) return o.amount; const w = wd(d); return w === 0 || w === 6 ? p.store.budget[2] : w === 5 ? p.store.budget[1] : p.store.budget[0]; };
  const costOf = (st: Staff, d: number, sh: { s: number; e: number }) => planCost({ start: sh.s, end: sh.e }, rate(st.id, key(d)), st.transport);
  const get = (id: number, d: number) => shifts[`${id}|${key(d)}`];
  const submittedSet = new Set(p.submitted);
  const mismatch = (id: number, d: number) => { const sh = get(id, d); if (!sh) return false; const h = hopes[`${id}|${key(d)}`]; if (!h) return submittedSet.has(id); return sh.s < h.s || sh.e > h.e; };

  const totals = useMemo(() => {
    const dayCost = Array(nd + 1).fill(0), dayN = Array(nd + 1).fill(0), staffCost: Record<number, { c: number; w: number }> = {};
    let cost = 0, work = 0;
    for (const st of p.staff) {
      staffCost[st.id] = { c: 0, w: 0 };
      for (let d = 1; d <= nd; d++) {
        const sh = get(st.id, d); if (!sh) continue;
        const r = costOf(st, d, sh);
        dayCost[d] += r.total; dayN[d]++; staffCost[st.id].c += r.total; staffCost[st.id].w += r.workMin; cost += r.total; work += r.workMin;
      }
    }
    return { dayCost, dayN, staffCost, cost, work };
  }, [shifts]); // eslint-disable-line
  let budget = 0, filledBudget = 0, overDays = 0, mis = 0, filled = 0;
  for (let d = 1; d <= nd; d++) { budget += budgetOf(d); if (totals.dayCost[d] > 0) { filled++; filledBudget += budgetOf(d); } if (totals.dayCost[d] > budgetOf(d)) overDays++; }
  for (const st of p.staff) for (let d = 1; d <= nd; d++) if (mismatch(st.id, d)) mis++;
  const pace = filledBudget ? totals.cost / filledBudget : 0;
  const lowWage = p.staff.filter((st) => rate(st.id, key(1)) < minWageAt(p.minWages, key(1)) || rate(st.id, key(nd)) < minWageAt(p.minWages, key(nd)));

  const open = (staffId: number, d: number) => {
    const cur = get(staffId, d), h = hopes[`${staffId}|${key(d)}`];
    setEd({ staffId, d, s: cur?.s ?? h?.s ?? 600, e: cur?.e ?? h?.e ?? 1020, had: !!cur });
  };
  const save = (del = false) => {
    if (!ed) return;
    const { staffId, d, s, e } = ed;
    const k = `${staffId}|${key(d)}`, before = shifts[k];
    setShifts((x) => { const n = { ...x }; if (del) delete n[k]; else n[k] = { s, e }; return n; });
    if (status === 'published') setStatus('changed');
    setEd(null);
    start(async () => {
      const r = await call(() => (del ? deleteShiftAction(p.store.id, staffId, key(d)) : saveShiftAction(p.store.id, staffId, key(d), s, e)));
      if (!r.ok) { toast(r.error); setShifts((x) => { const n = { ...x }; if (before) n[k] = before; else delete n[k]; return n; }); }
    });
  };
  const publish = () => start(async () => {
    const r = await call(() => publishAction(p.store.id, p.year, p.month));
    setConfirm(false);
    if (r.ok) { setStatus('published'); toast(r.message ?? '公開しました'); router.refresh(); } else toast(r.error);
  });

  const ratio = budget ? totals.cost / budget : 0;
  const pill = status === 'draft' ? <span className="pill draft">下書き（スタッフには非公開）</span> : status === 'published' ? <span className="pill conf">確定・公開済み</span> : <span className="pill changed">変更あり（未公開）</span>;

  return (
    <>
      {lowWage.length > 0 && <div className="banner warn"><span><b>{lowWage.map((s) => s.name).join('、')} の時給が最低賃金を下回っています。</b>　予定人件費もこの時給で計算しています。</span><a className="btn" href="/manage/staff">時給を見直す</a></div>}
      <section className="summary ssum" style={{ gridTemplateColumns: 'minmax(0,2.2fr) repeat(3,minmax(0,1fr)) auto' }} aria-label="人件費のサマリー">
        <div className="card">
          <div className="k">{p.month}月の予定人件費（下書き含む・リアルタイム）</div>
          <div className="big num">{yen(totals.cost)}<small>／予算 {yen(budget)}</small></div>
          <div className={`budgetbar${ratio > 1 ? ' over' : ''}`}><i style={{ width: `${Math.min(ratio, 1) * 100}%` }} /></div>
          <div className="row sub" style={{ justifyContent: 'space-between', marginTop: 4 }}><span>入力済み {filled}日／{nd}日</span><span>予算残 <b className="num">{yen(budget - totals.cost)}</b></span></div>
        </div>
        <div className="card"><div className="k">入力済の日の予算比</div><div className={`mid num ${pace > 1 ? 'bad-t' : pace > .95 ? 'warn-t' : 'ok-t'}`}>{(pace * 100).toFixed(1)}%</div><div className="sub">月予算比 {(ratio * 100).toFixed(1)}%</div></div>
        <div className="card"><div className="k">予算超過の日</div><div className={`mid num ${overDays ? 'bad-t' : 'ok-t'}`}>{overDays}日</div></div>
        <div className="card"><div className="k">総労働時間</div><div className="mid num">{(totals.work / 60).toFixed(1)}h</div><div className="sub">希望外 {mis}件</div></div>
        <div className="card" style={{ display: 'grid', gap: 8, alignContent: 'center' }}>{pill}
          <span className={`savestate${pending ? '' : ' ok'}`} aria-live="polite">{pending ? '保存中…' : '✓ 入力はすべて保存済み'}</span>
          {status !== 'published' ? <button className="btn primary" onClick={() => setConfirm(true)} disabled={pending}>{status === 'draft' ? 'シフトを確定・公開' : '変更を公開'}</button> : <button className="btn" disabled>公開済み</button>}</div>
      </section>
      <div className="legend">
        <span><i className="sw hope" />出勤希望</span><span><i className="sw shift" />シフト</span><span><i className="sw warnb" />希望とずれている</span>
        <span className="seg viewtoggle" role="group" aria-label="表示の切り替え">
          <a href="#" onClick={(e) => { e.preventDefault(); changeView('day'); }} aria-current={view === 'day' ? 'page' : undefined}>日ごと</a>
          <a href="#" onClick={(e) => { e.preventDefault(); changeView('month'); }} aria-current={view === 'month' ? 'page' : undefined}>月の表</a>
        </span>
      </div>
      {view === 'day' && (() => {
        const d = sel, w = wd(d);
        const people = p.staff.map((st) => ({ st, sh: get(st.id, d), h: hopes[`${st.id}|${key(d)}`] }))
          .sort((a, b) => Number(!!b.sh) - Number(!!a.sh) || Number(!!b.h) - Number(!!a.h) || (a.sh?.s ?? a.h?.s ?? 9999) - (b.sh?.s ?? b.h?.s ?? 9999));
        const c = totals.dayCost[d], bd = budgetOf(d);
        return (
          <div className="dayview">
            <div className="dstrip" role="group" aria-label="日付を選ぶ">
              {Array.from({ length: nd }, (_, i) => i + 1).map((x) => (
                <button key={x} type="button" className={wd(x) === 6 ? 'sat' : wd(x) === 0 ? 'sun' : ''} aria-pressed={x === d} onClick={() => setSel(x)}
                  id={`ds-${x}`}>
                  <b>{x}</b><small>{WD[wd(x)]}</small>
                  <i className={totals.dayCost[x] > budgetOf(x) ? 'over' : ''}>{totals.dayN[x] ? `${totals.dayN[x]}人` : '—'}</i>
                </button>
              ))}
            </div>
            <div className="daycard">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{p.month}/{d}（{WD[w]}）</b>
                <span className="row">
                  <button className="btn" style={{ minWidth: 48 }} type="button" disabled={d <= 1} onClick={() => setSel(d - 1)} aria-label="前の日">‹</button>
                  <button className="btn" style={{ minWidth: 48 }} type="button" disabled={d >= nd} onClick={() => setSel(d + 1)} aria-label="次の日">›</button>
                </span>
              </div>
              <div className="kv">
                <div><span>予定人件費</span><b className={c > bd ? 'bad-t' : ''}>{yen(c)}</b></div>
                <div><span>日予算</span><b>{yen(bd)}</b></div>
                <div><span>{c > bd ? '予算超過' : '残り'}</span><b className={c > bd ? 'bad-t' : 'ok-t'}>{yen(Math.abs(bd - c))}</b></div>
                <div><span>人数</span><b>{totals.dayN[d]}人</b></div>
              </div>
              {totals.dayN[d] > 0 && <Timeline rows={p.staff.filter((st) => get(st.id, d)).map((st) => ({ id: st.id, name: st.name, start: get(st.id, d)!.s, end: get(st.id, d)!.e }))} />}
            </div>
            <div className="list">
              {people.map(({ st, sh, h }) => (
                <button key={st.id} type="button" className={`prow${h ? ' hope' : ''}${mismatch(st.id, d) ? ' mis' : ''}${!sh && !h ? ' off' : ''}`} onClick={() => open(st.id, d)}>
                  <span>
                    <span className="nm">{st.name}</span><br />
                    <span className={`meta2${h ? ' ok' : ''}`}>{h ? `希望 ${hm(h.s)}〜${hm(h.e)}` : submittedSet.has(st.id) ? '希望なし' : '希望未提出'}{mismatch(st.id, d) ? ' ・ 希望とずれています' : ''}</span>
                  </span>
                  {sh ? <span className="shiftv">{hm(sh.s)}〜{hm(sh.e)}</span> : <span className="addv">＋ 入れる</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })()}
      {view === 'month' && <>
      <p className="sub" style={{ margin: '0 0 6px' }}>マスを押して入力。日付を押すと1日の配置を表示</p>
      <div className="grid-wrap" style={{ maxHeight: '68vh' }}>
        <table className="sgrid">
          <thead><tr><th className="sc">スタッフ（時給）</th>
            {Array.from({ length: nd }, (_, i) => i + 1).map((d) => (
              <th key={d} className={`dh${wd(d) === 6 ? ' sat' : wd(d) === 0 ? ' sun' : ''}`} style={day === d ? { background: 'var(--accent-soft)' } : undefined}>
                <button style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => setDay(day === d ? null : d)} aria-label={`${p.month}月${d}日の配置`}><b>{d}</b><small>{WD[wd(d)]}</small></button>
              </th>))}
            <th className="tot">月計</th></tr></thead>
          <tbody>
            {p.staff.map((st) => (
              <tr key={st.id}>
                <th className="sc staffc"><b>{st.name}</b><small>{yen(rate(st.id, key(1)))}{!submittedSet.has(st.id) && <span style={{ color: 'var(--bad)' }}> ・ 希望未提出</span>}</small></th>
                {Array.from({ length: nd }, (_, i) => i + 1).map((d) => {
                  const sh = get(st.id, d), h = hopes[`${st.id}|${key(d)}`];
                  return (
                    <td key={d} className={`c${h ? ' hope' : ''}${mismatch(st.id, d) ? ' mis' : ''}`}>
                      <button onClick={() => open(st.id, d)} aria-label={`${st.name} ${p.month}月${d}日`}>
                        {h && <span className="hl">希 {hs(h.s)}-{hs(h.e)}</span>}
                        {sh && <span className="chip">{hs(sh.s)}-{hs(sh.e)}</span>}
                      </button>
                    </td>);
                })}
                <td className="tot"><b>{(totals.staffCost[st.id].w / 60).toFixed(1)}h</b><small>{yen(totals.staffCost[st.id].c)}</small></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th className="sc">人数</th>{Array.from({ length: nd }, (_, i) => i + 1).map((d) => <td key={d} className={`f${totals.dayN[d] ? '' : ' zero'}`}>{totals.dayN[d]}人</td>)}<td className="tot" /></tr>
            <tr><th className="sc">予定人件費</th>{Array.from({ length: nd }, (_, i) => i + 1).map((d) => <td key={d} className={`f${totals.dayCost[d] > budgetOf(d) ? ' over' : totals.dayCost[d] ? '' : ' zero'}`}>{totals.dayCost[d] ? man(totals.dayCost[d]) : '—'}</td>)}<td className="tot"><b>{yen(totals.cost)}</b></td></tr>
            <tr><th className="sc">日予算との差</th>{Array.from({ length: nd }, (_, i) => i + 1).map((d) => { const c = totals.dayCost[d], b = budgetOf(d), df = b - c; return <td key={d} className={`f${c === 0 ? ' zero' : df < 0 ? ' over' : ' under'}`}>{c === 0 ? man(b) : (df < 0 ? '−' : '+') + man(Math.abs(df))}</td>; })}<td className="tot"><small>{yen(budget - totals.cost)}</small></td></tr>
          </tfoot>
        </table>
      </div>
      {day && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: 16 }}>{p.month}/{day}（{WD[wd(day)]}）の配置</b>
            <span className="num">予定人件費 <b>{yen(totals.dayCost[day])}</b> ／ 日予算 {yen(budgetOf(day))}</span>
            <span className={`num ${totals.dayCost[day] > budgetOf(day) ? 'bad-t' : 'ok-t'}`}>{totals.dayCost[day] > budgetOf(day) ? `予算超過 ${yen(totals.dayCost[day] - budgetOf(day))}` : `予算内（残 ${yen(budgetOf(day) - totals.dayCost[day])}）`}</span>
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setDay(null)}>閉じる</button>
          </div>
          <Timeline rows={p.staff.filter((st) => get(st.id, day)).map((st) => ({ id: st.id, name: st.name, start: get(st.id, day)!.s, end: get(st.id, day)!.e }))} />
        </div>
      )}
      </>}
      <p className="sub" style={{ marginTop: 12 }}>人件費＝時給×実働時間＋深夜割増（22時以降25%）＋1日8時間超の残業割増（25%）＋交通費。6時間超で45分、8時間超で60分の休憩を自動で差し引いています。</p>

      {ed && (() => {
        const st = p.staff.find((x) => x.id === ed.staffId)!;
        const h = hopes[`${ed.staffId}|${key(ed.d)}`];
        const valid = ed.e > ed.s;
        const r = valid ? costOf(st, ed.d, { s: ed.s, e: ed.e }) : null;
        const old = get(ed.staffId, ed.d), oldC = old ? costOf(st, ed.d, old).total : 0;
        const after = totals.cost - oldC + (r?.total ?? 0), dayAfter = totals.dayCost[ed.d] - oldC + (r?.total ?? 0);
        const outside = valid && (h ? ed.s < h.s || ed.e > h.e : submittedSet.has(st.id));
        return (
          <div className="scrim" onClick={(e) => e.target === e.currentTarget && setEd(null)}>
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="edT">
              <h3 id="edT">{st.name}　{p.month}/{ed.d}（{WD[wd(ed.d)]}）</h3>
              <div className="meta">時給 {yen(rate(st.id, key(ed.d)))} ・ 交通費 {yen(st.transport)}/日</div>
              <div className={`hopebox ${h ? 'ok' : 'ng'}`}>{h ? `出勤希望：${hm(h.s)}〜${hm(h.e)}` : submittedSet.has(st.id) ? 'この日は出勤希望がありません' : '希望が未提出です'}</div>
              <div className="pats">
                {h && <button onClick={() => setEd({ ...ed, s: h.s, e: h.e })}><b>希望どおり</b><span className="num">{hs(h.s)}-{hs(h.e)}</span></button>}
                {PATTERNS.map((pt) => <button key={pt.n} onClick={() => setEd({ ...ed, s: pt.s, e: pt.e })}><b>{pt.n}</b><span className="num">{hs(pt.s)}-{hs(pt.e)}</span></button>)}
              </div>
              <div className="row">
                <label htmlFor="es" className="sub">開始</label>
                <select id="es" className="sel" value={ed.s} onChange={(e) => setEd({ ...ed, s: Number(e.target.value) })}>{TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}</select>
                <label htmlFor="ee" className="sub">終了</label>
                <select id="ee" className="sel" value={ed.e} onChange={(e) => setEd({ ...ed, e: Number(e.target.value) })}>{TIMES.map((x) => <option key={x} value={x}>{hm(x)}</option>)}</select>
              </div>
              {!valid && <p className="err">終了時刻を開始時刻より後にしてください。</p>}
              {outside && <p className="err" style={{ color: 'var(--warn)' }}>出勤希望の日・時間帯から外れています。本人に確認してから確定してください。</p>}
              {r && (
                <div className="calc">
                  <span>実働（休憩{r.breakMin}分を控除）</span><span className="r">{(r.workMin / 60).toFixed(2).replace(/\.?0+$/, '')}時間</span>
                  <span>基本給</span><span className="r">{yen(r.base)}</span>
                  {r.night > 0 && <><span>深夜割増</span><span className="r">{yen(r.night)}</span></>}
                  {r.overtime > 0 && <><span>時間外</span><span className="r">{yen(r.overtime)}</span></>}
                  <span>交通費</span><span className="r">{yen(r.transport)}</span>
                  <b>このシフトの人件費</b><b className="r">{yen(r.total)}</b>
                </div>
              )}
              <div className={`delta${after > budget || dayAfter > budgetOf(ed.d) ? ' over' : ''}`}>
                月の予定人件費 <b className="num">{yen(totals.cost)}</b> → <b className="num">{yen(after)}</b>（{after >= totals.cost ? '+' : '−'}{man(Math.abs(after - totals.cost))}円）<br />
                この日の人件費 <b className="num">{yen(dayAfter)}</b>／日予算 <span className="num">{yen(budgetOf(ed.d))}</span>{dayAfter > budgetOf(ed.d) && '（超過）'}
              </div>
              <div className="actions">
                {ed.had && <button className="btn danger left" onClick={() => save(true)}>シフトを外す</button>}
                <button className="btn" onClick={() => setEd(null)}>キャンセル</button>
                <button className="btn primary" disabled={!valid} onClick={() => save(false)}>保存する</button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirm && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cfT">
            <h3 id="cfT">{status === 'draft' ? `${p.month}月のシフトを確定して公開します` : '変更を公開します'}</h3>
            <p className="meta">公開すると、{p.store.name}のスタッフ全員が全員分のシフトを見られるようになります。</p>
            <div className="grid-wrap"><table className="tbl"><tbody>
              <tr><td>予定人件費</td><td className="num">{yen(totals.cost)}（予算比 {(ratio * 100).toFixed(1)}%）</td></tr>
              <tr><td className={overDays ? 'bad-t' : ''}>日予算を超えた日</td><td className="num">{overDays}日</td></tr>
              <tr><td className={mis ? 'warn-t' : ''}>希望とずれているシフト</td><td className="num">{mis}件</td></tr>
              <tr><td>誰も入っていない日</td><td className="num">{nd - filled}日</td></tr>
            </tbody></table></div>
            <p className="sub">注意事項があっても公開できます。公開後も編集でき、変更は改めて公開します。</p>
            <div className="actions"><button className="btn" onClick={() => setConfirm(false)}>戻って調整する</button><button className="btn primary" onClick={publish} disabled={pending}>{status === 'draft' ? '確定して公開する' : '変更を公開する'}</button></div>
          </div>
        </div>
      )}
      {toastNode}
    </>
  );
}
