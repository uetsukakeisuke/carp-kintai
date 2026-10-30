'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Timeline } from '@/components/Timeline';
import { DeadlineForm } from './DeadlineForm';

type Cell = { staff_id: number; work_date: string; start_min: number; end_min: number };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
const hs = (x: number) => (x % 60 ? hm(x) : String(x / 60));
const LOW = 2; // この人数以下の日は「少ない日」

export function HopeBoard(p: {
  storeId: number; year: number; month: number; today: string;
  open: string | null; deadline: string | null;
  staff: { id: number; name: string }[];
  hopes: Cell[];
  subs: { staff_id: number; submitted_at: string }[];
}) {
  const nd = new Date(p.year, p.month, 0).getDate();
  const days = Array.from({ length: nd }, (_, i) => i + 1);
  const key = (d: number) => `${p.year}-${String(p.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const wd = (d: number) => new Date(p.year, p.month - 1, d).getDay();
  const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}（${WD[new Date(s.slice(0, 10) + 'T00:00:00').getDay()]}）`;

  const sub = useMemo(() => new Map(p.subs.map((s) => [s.staff_id, s.submitted_at])), [p.subs]);
  const hope = useMemo(() => new Map(p.hopes.map((h) => [`${h.staff_id}|${h.work_date}`, h])), [p.hopes]);
  const done = p.staff.filter((s) => sub.has(s.id));
  const notYet = p.staff.filter((s) => !sub.has(s.id));
  const perDay = days.map((d) => p.staff.filter((s) => hope.has(`${s.id}|${key(d)}`)).length);
  const lowDays = days.filter((d) => perDay[d - 1] <= LOW);
  const totalMin = p.hopes.reduce((a, h) => a + h.end_min - h.start_min, 0);
  const perStaff = (id: number) => {
    const hs2 = p.hopes.filter((h) => h.staff_id === id);
    return { n: hs2.length, min: hs2.reduce((a, h) => a + h.end_min - h.start_min, 0) };
  };

  const state = p.open && p.today < p.open ? { t: `受付前（${md(p.open)}から）`, c: 'draft' }
    : p.deadline && p.today > p.deadline ? { t: '締切済み', c: 'changed' }
    : { t: '受付中', c: 'conf' };
  const left = p.deadline && p.today <= p.deadline
    ? Math.round((new Date(p.deadline + 'T00:00:00').getTime() - new Date(p.today + 'T00:00:00').getTime()) / 86400000) : null;

  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<'month' | 'day'>('month');
  const [sel, setSel] = useState(1);
  useEffect(() => {
    let v: string | null = null;
    try { v = localStorage.getItem('kintai-hope-view'); } catch {}
    setView(v === 'day' || v === 'month' ? v : window.innerWidth < 761 ? 'day' : 'month');
  }, []);
  useEffect(() => {
    const el = document.getElementById(`hs-${sel}`), box = el?.parentElement;
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [sel, view]);
  const changeView = (v: 'month' | 'day') => { setView(v); try { localStorage.setItem('kintai-hope-view', v); } catch {} };
  const showDay = (d: number) => { setSel(d); changeView('day'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const lvl = (n: number) => (n === 0 ? 'zero' : n <= LOW ? 'low' : 'ok');

  return (
    <>
      {/* 受付期間 */}
      <div className="hp-period card">
        <div className="hp-period-main">
          <span className={`pill ${state.c}`}>{state.t}</span>
          <span className="hp-dates">
            <span className="k">受付期間</span>
            <b>{p.open ? md(p.open) : '指定なし'}</b><span className="sub">〜</span><b>{p.deadline ? md(p.deadline) : '指定なし'}</b>
          </span>
          {left !== null && state.c === 'conf' && <span className={`hp-left${left <= 2 ? ' soon' : ''}`}>{left === 0 ? '今日が締切' : `締切まであと${left}日`}</span>}
          <button type="button" className="btn" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? '閉じる' : '期間を変える'}</button>
        </div>
        {editing && (
          <div className="hp-period-edit">
            <DeadlineForm storeId={p.storeId} year={p.year} month={p.month} open={p.open} deadline={p.deadline} />
            <p className="sub" style={{ margin: '6px 0 0' }}>受付開始日より前と締切日の翌日以降は、スタッフは入力・変更できません。空欄なら制限なし。</p>
          </div>
        )}
      </div>

      {/* 数字のまとめ */}
      <section className="summary hp-sum" aria-label="提出状況">
        <div className="card">
          <div className="k">提出状況</div>
          <div className="big num">{done.length}<small>／{p.staff.length}名 提出済み</small></div>
          <div className="budgetbar ok"><i style={{ width: `${p.staff.length ? (done.length / p.staff.length) * 100 : 0}%` }} /></div>
          {notYet.length > 0
            ? <div className="hp-names"><span className="sub">未提出：</span>{notYet.map((s) => <span key={s.id} className="nchip bad">{s.name}</span>)}</div>
            : <div className="sub" style={{ marginTop: 8 }}>全員提出しました</div>}
        </div>
        <div className="card">
          <div className="k">出勤できる人が{LOW}人以下の日</div>
          <div className={`mid num ${lowDays.length ? 'warn-t' : 'ok-t'}`}>{lowDays.length}日</div>
          {lowDays.length > 0 && <div className="sub hp-lowlist">{lowDays.slice(0, 8).map((d) => <button key={d} type="button" onClick={() => showDay(d)}>{d}日</button>)}{lowDays.length > 8 ? ' ほか' : ''}</div>}
        </div>
        <div className="card">
          <div className="k">希望時間の合計</div>
          <div className="mid num">{(totalMin / 60).toFixed(1)}h</div>
          <div className="sub">{p.hopes.length}コマ ・ 1日平均 {(p.hopes.length / nd).toFixed(1)}人</div>
        </div>
      </section>

      <div className="legend">
        <span><i className="sw hope" />出勤できる（希望時間）</span>
        <span><i className="sw nohope" />希望なし</span>
        <span><i className="sw unsub" />未提出</span>
        <span className="seg viewtoggle" role="group" aria-label="表示の切り替え">
          <a href="#" onClick={(e) => { e.preventDefault(); changeView('day'); }} aria-current={view === 'day' ? 'page' : undefined}>日ごと</a>
          <a href="#" onClick={(e) => { e.preventDefault(); changeView('month'); }} aria-current={view === 'month' ? 'page' : undefined}>月の表</a>
        </span>
      </div>

      {view === 'day' ? (() => {
        const d = sel, k = key(d);
        const can = p.staff.flatMap((s) => { const h = hope.get(`${s.id}|${k}`); return h ? [{ id: s.id, name: sub.has(s.id) ? s.name : `${s.name}（未提出）`, start: h.start_min, end: h.end_min }] : []; });
        const no = p.staff.filter((s) => sub.has(s.id) && !hope.has(`${s.id}|${k}`));
        return (
          <div className="dayview">
            <div className="dstrip" role="group" aria-label="日付を選ぶ">
              {days.map((x) => (
                <button key={x} id={`hs-${x}`} type="button" className={wd(x) === 6 ? 'sat' : wd(x) === 0 ? 'sun' : ''} aria-pressed={x === d} onClick={() => setSel(x)}>
                  <b>{x}</b><small>{WD[wd(x)]}</small>
                  <i className={`hp-n ${lvl(perDay[x - 1])}`}>{perDay[x - 1]}人</i>
                </button>
              ))}
            </div>
            <div className="daycard">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <b>{p.month}月{d}日（{WD[wd(d)]}）</b>
                <span className="row">
                  <button className="btn" style={{ minWidth: 48 }} type="button" disabled={d <= 1} onClick={() => setSel(d - 1)} aria-label="前の日">‹</button>
                  <button className="btn" style={{ minWidth: 48 }} type="button" disabled={d >= nd} onClick={() => setSel(d + 1)} aria-label="次の日">›</button>
                </span>
              </div>
              <div className={`hp-daycount ${lvl(can.length)}`}>出勤できる人 <b className="num">{can.length}</b>人</div>
              {can.length > 0 ? <Timeline rows={can} /> : <p className="sub" style={{ margin: 0 }}>この日に出勤できる人はいません。</p>}
              {no.length > 0 && <div className="hp-names"><span className="sub">希望なし：</span>{no.map((s) => <span key={s.id} className="nchip">{s.name}</span>)}</div>}
              {notYet.length > 0 && <div className="hp-names"><span className="sub">未提出：</span>{notYet.map((s) => <span key={s.id} className="nchip bad">{s.name}</span>)}</div>}
            </div>
          </div>
        );
      })() : (
        <>
          <p className="sub" style={{ margin: '0 0 6px' }}>日付を押すと、その日に出勤できる人を時間帯つきで表示します。</p>
          <div className="grid-wrap" style={{ maxHeight: '70vh' }}>
            <table className="sgrid hgrid">
              <thead><tr><th className="sc">スタッフ</th>
                {days.map((d) => (
                  <th key={d} className={`dh${wd(d) === 6 ? ' sat' : wd(d) === 0 ? ' sun' : ''}`}>
                    <button type="button" className="hp-dh" onClick={() => showDay(d)} aria-label={`${p.month}月${d}日に出勤できる人`}><b>{d}</b><small>{WD[wd(d)]}</small></button>
                  </th>))}
                <th className="tot">合計</th></tr></thead>
              <tbody>
                {p.staff.map((s) => {
                  const subAt = sub.get(s.id), t = perStaff(s.id);
                  return (
                    <tr key={s.id} className={subAt ? '' : 'unsub'}>
                      <th className="sc staffc"><b>{s.name}</b><small>{subAt ? `提出 ${Number(subAt.slice(5, 7))}/${Number(subAt.slice(8, 10))}` : <span className="bad-t">未提出</span>}</small></th>
                      {days.map((d) => {
                        const h = hope.get(`${s.id}|${key(d)}`);
                        return <td key={d} className={`hc${h ? ' on' : ''}`}>{h && <span className="hv num"><span>{hs(h.start_min)}</span><span>{hs(h.end_min)}</span></span>}</td>;
                      })}
                      <td className="tot">{subAt ? <><b>{t.n}日</b><small>{(t.min / 60).toFixed(1)}h</small></> : <small>—</small>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><th className="sc">出勤できる人数</th>{days.map((d) => <td key={d} className={`f hp-f ${lvl(perDay[d - 1])}`}>{perDay[d - 1]}人</td>)}<td className="tot" /></tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <p className="sub" style={{ margin: 0 }}>未提出の人には口頭やLINEで声をかけてください。</p>
        <Link className="btn primary" href={`/manage/shifts?ym=${p.year}-${String(p.month).padStart(2, '0')}`}>この希望でシフトを作る →</Link>
      </div>
    </>
  );
}
