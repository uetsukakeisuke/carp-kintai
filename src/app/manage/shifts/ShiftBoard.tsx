'use client';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveShiftAction, deleteShiftAction, publishAction } from '@/app/actions';
import { planCost, wageAt, minWageAt, type WageRate, type MinWage } from '@/lib/calc';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';

type Cell = { staff_id: number; work_date: string; start_min: number; end_min: number };
type Staff = { id: number; name: string; employment: string; transport: number; monthly?: boolean };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const PATTERNS = [{ n: '早番', s: 540, e: 900 }, { n: '中番', s: 660, e: 1020 }, { n: '遅番', s: 1020, e: 1320 }, { n: 'ラスト', s: 1080, e: 1440 }, { n: '通し', s: 600, e: 1140 }, { n: 'ランチ', s: 660, e: 900 }];
const TIMES: number[] = []; for (let x = 360; x <= 1740; x += 15) TIMES.push(x);
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const hs = (x: number) => (x % 60 ? hm(x) : String(x / 60));
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
const man = (n: number) => Math.round(n).toLocaleString('ja-JP');
const man1 = (n: number) => (n / 10000).toFixed(1); // 万円（小数1桁）
const TL_S = 8 * 60, TL_E = 26 * 60; // 日ごとのバーの範囲（8時〜翌2時）
const pct = (m: number) => ((Math.min(Math.max(m, TL_S), TL_E) - TL_S) / (TL_E - TL_S)) * 100;
type View = 'day' | 'week' | 'month';

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
  const [view, setView] = useState<View>('month');
  const [sel, setSel] = useState(1);
  useEffect(() => {
    // スマホは「日ごと」表示から始める（前回の選択を覚えておく）
    let v: string | null = null;
    try { v = localStorage.getItem('kintai-shift-view'); } catch {}
    setView(v === 'day' || v === 'week' || v === 'month' ? v : window.innerWidth < 761 ? 'week' : 'month');
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
  const changeView = (v: View) => { setView(v); try { localStorage.setItem('kintai-shift-view', v); } catch {} };
  const showDay = (d: number) => { setSel(d); changeView('day'); };
  const days = Array.from({ length: nd }, (_, i) => i + 1);

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
  const lowWage = p.staff.filter((st) => !st.monthly && (rate(st.id, key(1)) < minWageAt(p.minWages, key(1)) || rate(st.id, key(nd)) < minWageAt(p.minWages, key(nd))));

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
  const publishBtn = status !== 'published'
    ? <button className="btn primary" onClick={() => setConfirm(true)} disabled={pending}>{status === 'draft' ? 'シフトを確定・公開' : '変更を公開'}</button>
    : <button className="btn" disabled>公開済み</button>;
  const pill = status === 'draft' ? <span className="pill draft">下書き（スタッフには非公開）</span> : status === 'published' ? <span className="pill conf">確定・公開済み</span> : <span className="pill changed">変更あり（未公開）</span>;

  return (
    <>
      {lowWage.length > 0 && <div className="banner warn"><span><b>{lowWage.map((s) => s.name).join('、')} の時給が最低賃金を下回っています。</b>　予定人件費もこの時給で計算しています。</span><a className="btn" href="/manage/staff">時給を見直す</a></div>}
      {/* PC：数字のまとめ */}
      <section className="summary ssum only-pc" style={{ gridTemplateColumns: 'minmax(0,2.2fr) repeat(3,minmax(0,1fr)) auto' }} aria-label="人件費のサマリー">
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
          {publishBtn}</div>
      </section>
      {/* スマホ：1枚にまとめる */}
      <section className="card ssum-sp only-sp" aria-label="人件費のサマリー">
        <div className="row" style={{ justifyContent: 'space-between' }}>{pill}<span className={`savestate${pending ? '' : ' ok'}`} aria-live="polite">{pending ? '保存中…' : '✓ 保存済み'}</span></div>
        <div className="ssum-cost"><b className="num">{yen(totals.cost)}</b><span className="sub">／予算 {yen(budget)}</span><b className={`num ssum-pct ${ratio > 1 ? 'bad-t' : 'ok-t'}`}>{(ratio * 100).toFixed(0)}%</b></div>
        <div className={`budgetbar${ratio > 1 ? ' over' : ''}`} style={{ marginTop: 0 }}><i style={{ width: `${Math.min(ratio, 1) * 100}%` }} /></div>
        <div className="ssum-meta"><span>予算超過 <b className={overDays ? 'bad-t' : ''}>{overDays}日</b></span><span>労働 <b>{(totals.work / 60).toFixed(0)}h</b></span><span>希望外 <b className={mis ? 'warn-t' : ''}>{mis}件</b></span><span>入力 <b>{filled}/{nd}日</b></span></div>
        {publishBtn}
      </section>

      <div className="legend">
        <span><i className="sw hope" />出勤希望</span><span><i className="sw shift" />シフト</span><span><i className="sw warnb" />希望とずれている</span>
        <span className="seg viewtoggle" role="group" aria-label="表示の切り替え">
          {(['day', 'week', 'month'] as const).map((v) => <a key={v} href="#" onClick={(e) => { e.preventDefault(); changeView(v); }} aria-current={view === v ? 'page' : undefined}>{{ day: '日', week: '週', month: '月' }[v]}</a>)}
        </span>
      </div>

      {view === 'day' && (() => {
        const d = sel, w = wd(d);
        const people = p.staff.map((st) => ({ st, sh: get(st.id, d), h: hopes[`${st.id}|${key(d)}`] }))
          .sort((a, b) => Number(!!b.sh) - Number(!!a.sh) || Number(!!b.h) - Number(!!a.h) || (a.sh?.s ?? a.h?.s ?? 9999) - (b.sh?.s ?? b.h?.s ?? 9999));
        const c = totals.dayCost[d], bd = budgetOf(d);
        const ticks: number[] = []; for (let h = TL_S / 60; h <= TL_E / 60; h += 3) ticks.push(h);
        return (
          <div className="dayview">
            <div className="dstrip" role="group" aria-label="日付を選ぶ">
              {days.map((x) => (
                <button key={x} type="button" className={wd(x) === 6 ? 'sat' : wd(x) === 0 ? 'sun' : ''} aria-pressed={x === d} onClick={() => setSel(x)} id={`ds-${x}`}>
                  <b>{x}</b><small>{WD[wd(x)]}</small>
                  <i className={totals.dayCost[x] > budgetOf(x) ? 'over' : ''}>{totals.dayN[x] ? `${totals.dayN[x]}人` : '—'}</i>
                </button>
              ))}
            </div>
            <div className="daycard">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{p.month}/{d}（{WD[w]}）<span className="sub" style={{ fontWeight: 400, fontSize: 13, marginLeft: 6 }}>{totals.dayN[d]}人</span></b>
                <span className="row">
                  <button className="btn" style={{ minWidth: 48 }} type="button" disabled={d <= 1} onClick={() => setSel(d - 1)} aria-label="前の日">‹</button>
                  <button className="btn" style={{ minWidth: 48 }} type="button" disabled={d >= nd} onClick={() => setSel(d + 1)} aria-label="次の日">›</button>
                </span>
              </div>
              <div className="daymoney"><span>人件費 <b className={`num${c > bd ? ' bad-t' : ''}`}>{yen(c)}</b></span><span>予算 <b className="num">{yen(bd)}</b></span><span className={c > bd ? 'bad-t' : 'ok-t'}>{c > bd ? '超過' : '残り'} <b className="num">{yen(Math.abs(bd - c))}</b></span></div>
              <div className="bars" role="list">
                <div className="bars-axis" aria-hidden><span />{<div>{ticks.map((h) => <i key={h} style={{ left: `${pct(h * 60)}%` }}>{h}</i>)}</div>}</div>
                {people.map(({ st, sh, h }) => (
                  <button key={st.id} type="button" role="listitem" className={`barrow${sh ? ' on' : ''}${mismatch(st.id, d) ? ' mis' : ''}`} onClick={() => open(st.id, d)} aria-label={`${st.name} ${p.month}月${d}日`}>
                    <span className="bn"><b>{st.name}</b><small>{sh ? `${hm(sh.s)}〜${hm(sh.e)}` : h ? `希望 ${hs(h.s)}-${hs(h.e)}` : submittedSet.has(st.id) ? '希望なし' : '希望未提出'}</small></span>
                    <span className="bt">
                      {ticks.map((x) => <i key={x} className="grid" style={{ left: `${pct(x * 60)}%` }} />)}
                      {h && <i className="hb" style={{ left: `${pct(h.s)}%`, width: `${pct(h.e) - pct(h.s)}%` }} />}
                      {sh ? <i className="sb" style={{ left: `${pct(sh.s)}%`, width: `${pct(sh.e) - pct(sh.s)}%` }} /> : <i className="plus">＋</i>}
                    </span>
                  </button>
                ))}
              </div>
              <p className="sub" style={{ margin: 0 }}>名前の行を押すと、その人のこの日のシフトを入力できます。</p>
            </div>
          </div>
        );
      })()}

      {view === 'week' && (() => {
        const first = sel - wd(sel); // 日曜はじまり
        const wk = Array.from({ length: 7 }, (_, i) => first + i);
        const inM = (d: number) => d >= 1 && d <= nd;
        const md = (d: number) => { const t = new Date(p.year, p.month - 1, d); return `${t.getMonth() + 1}/${t.getDate()}`; };
        return (
          <div className="weekview">
            <div className="weeknav">
              <button className="btn" type="button" disabled={first <= 1} onClick={() => setSel(Math.max(1, first - 7))} aria-label="前の週">‹</button>
              <b className="num">{md(first)}（日）〜 {md(first + 6)}（土）</b>
              <button className="btn" type="button" disabled={first + 7 > nd} onClick={() => setSel(Math.min(nd, first + 7))} aria-label="次の週">›</button>
            </div>
            <table className="wgrid">
              <thead><tr><th className="wn" />
                {wk.map((d) => <th key={d} className={`${wd(d) === 6 ? 'sat' : wd(d) === 0 ? 'sun' : ''}${inM(d) ? '' : ' out'}`}>
                  {inM(d) ? <button type="button" onClick={() => showDay(d)} aria-label={`${p.month}月${d}日の配置`}><b className="num">{d}</b><small>{WD[wd(d)]}</small></button> : <span><b className="num">{new Date(p.year, p.month - 1, d).getDate()}</b><small>{WD[(wd(d) + 7) % 7]}</small></span>}
                </th>)}
              </tr></thead>
              <tbody>
                {p.staff.map((st) => {
                  const [last, given] = st.name.split(/\s+/);
                  return (
                    <tr key={st.id}>
                      <th className="wn"><b>{last}</b>{given && <small>{given}</small>}</th>
                      {wk.map((d) => {
                        if (!inM(d)) return <td key={d} className="out" />;
                        const sh = get(st.id, d), h = hopes[`${st.id}|${key(d)}`];
                        return (
                          <td key={d} className={`${h ? 'hope' : ''}${mismatch(st.id, d) ? ' mis' : ''}`}>
                            <button type="button" onClick={() => open(st.id, d)} aria-label={`${st.name} ${p.month}月${d}日`}>
                              {sh ? <span className="wchip num"><span>{hs(sh.s)}</span><span>{hs(sh.e)}</span></span> : h ? <span className="whope num">{hs(h.s)}<br />{hs(h.e)}</span> : null}
                            </button>
                          </td>);
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><th className="wn">人数</th>{wk.map((d) => <td key={d} className={inM(d) ? '' : 'out'}>{inM(d) ? `${totals.dayN[d]}人` : ''}</td>)}</tr>
                <tr><th className="wn">人件費</th>{wk.map((d) => <td key={d} className={inM(d) ? (totals.dayCost[d] > budgetOf(d) ? 'over' : totals.dayCost[d] ? 'under' : '') : 'out'}>{inM(d) ? (totals.dayCost[d] ? man1(totals.dayCost[d]) : '—') : ''}</td>)}</tr>
              </tfoot>
            </table>
            <p className="sub" style={{ margin: '6px 0 0' }}>人件費は万円。赤は日予算超過。日付を押すとその日の配置を表示します。</p>
          </div>
        );
      })()}

      {view === 'month' && <>
        {/* スマホ：月のカレンダーで全日を一目で */}
        <div className="only-sp">
          <div className="mcal">
            {WD.map((x, i) => <div key={x} className={`mh${i === 6 ? ' sat' : i === 0 ? ' sun' : ''}`}>{x}</div>)}
            {Array.from({ length: wd(1) }, (_, i) => <div key={`b${i}`} />)}
            {days.map((d) => {
              const c = totals.dayCost[d], b = budgetOf(d);
              return (
                <button key={d} type="button" className={`mc${c > b ? ' over' : c ? ' under' : ''}${wd(d) === 6 ? ' sat' : wd(d) === 0 ? ' sun' : ''}`} onClick={() => showDay(d)} aria-label={`${p.month}月${d}日 ${totals.dayN[d]}人`}>
                  <b className="num">{d}</b>
                  <span className="mn">{totals.dayN[d] ? `${totals.dayN[d]}人` : '—'}</span>
                  <span className="mm num">{c ? man1(c) : ''}</span>
                </button>
              );
            })}
          </div>
          <p className="sub" style={{ margin: '8px 0 0' }}>各日の人数と予定人件費（万円）。赤は日予算超過、緑は予算内。日付を押すとその日の配置を表示します。</p>
        </div>
        {/* PC：スタッフ×日の表（全日が入る幅に） */}
        <div className="only-pc">
          <p className="sub" style={{ margin: '0 0 6px' }}>マスを押して入力。日付を押すと1日の配置を表示</p>
          <div className="grid-wrap" style={{ maxHeight: '70vh' }}>
            <table className="sgrid mgrid">
              <thead><tr><th className="sc">スタッフ（時給）</th>
                {days.map((d) => (
                  <th key={d} className={`dh${wd(d) === 6 ? ' sat' : wd(d) === 0 ? ' sun' : ''}`}>
                    <button style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => showDay(d)} aria-label={`${p.month}月${d}日の配置`}><b>{d}</b><small>{WD[wd(d)]}</small></button>
                  </th>))}
                <th className="tot">月計</th></tr></thead>
              <tbody>
                {p.staff.map((st) => (
                  <tr key={st.id}>
                    <th className="sc staffc"><b>{st.name}</b><small>{st.monthly ? '月給' : yen(rate(st.id, key(1)))}{!submittedSet.has(st.id) && !st.monthly && <span style={{ color: 'var(--bad)' }}> ・ 希望未提出</span>}</small></th>
                    {days.map((d) => {
                      const sh = get(st.id, d), h = hopes[`${st.id}|${key(d)}`];
                      return (
                        <td key={d} className={`c${h ? ' hope' : ''}${mismatch(st.id, d) ? ' mis' : ''}`}>
                          <button onClick={() => open(st.id, d)} aria-label={`${st.name} ${p.month}月${d}日`}>
                            {sh ? <span className="mchip num"><span>{hs(sh.s)}</span><span>{hs(sh.e)}</span></span> : h ? <span className="mhope num">{hs(h.s)}<br />{hs(h.e)}</span> : null}
                          </button>
                        </td>);
                    })}
                    <td className="tot"><b>{(totals.staffCost[st.id].w / 60).toFixed(1)}h</b><small>{yen(totals.staffCost[st.id].c)}</small></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th className="sc">人数</th>{days.map((d) => <td key={d} className={`f${totals.dayN[d] ? '' : ' zero'}`}>{totals.dayN[d]}人</td>)}<td className="tot" /></tr>
                <tr><th className="sc">予定人件費（万）</th>{days.map((d) => <td key={d} className={`f${totals.dayCost[d] > budgetOf(d) ? ' over' : totals.dayCost[d] ? '' : ' zero'}`}>{totals.dayCost[d] ? man1(totals.dayCost[d]) : '—'}</td>)}<td className="tot"><b>{yen(totals.cost)}</b></td></tr>
                <tr><th className="sc">日予算との差（万）</th>{days.map((d) => { const c = totals.dayCost[d], b = budgetOf(d), df = b - c; return <td key={d} className={`f${c === 0 ? ' zero' : df < 0 ? ' over' : ' under'}`}>{c === 0 ? man1(b) : (df < 0 ? '−' : '+') + man1(Math.abs(df))}</td>; })}<td className="tot"><small>{yen(budget - totals.cost)}</small></td></tr>
              </tfoot>
            </table>
          </div>
        </div>
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
