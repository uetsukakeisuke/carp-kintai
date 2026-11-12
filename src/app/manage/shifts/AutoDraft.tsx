'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { autoDraftAction, undoAutoDraftAction, type AutoDraftReply } from '@/app/actions';
import type { Window } from '@/lib/forecast';
import { call } from '@/lib/call';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WD[new Date(d + 'T00:00:00Z').getUTCDay()]}）`;
const h1 = (m: number) => (m / 60).toFixed(1);
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');

/** シフト作成：希望・予測・予算から下書きを自動で作る */
export function AutoDraft({ storeId, year, month, names, onAdded, onRemoved, compact }: {
  storeId: number; year: number; month: number; names: Record<number, string>; compact?: boolean;
  onAdded: (w: Window[]) => void; onRemoved: (w: Window[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<Extract<AutoDraftReply, { ok: true }> | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    setErr(''); setNote('');
    const r = await call(() => autoDraftAction(storeId, year, month));
    if (!r.ok) { setErr(r.error); return; }
    setRes(r as Extract<AutoDraftReply, { ok: true }>);
    onAdded((r as Extract<AutoDraftReply, { ok: true }>).added);
  });
  const undo = () => start(async () => {
    if (!res) return;
    const r = await call(() => undoAutoDraftAction(storeId, res.batch));
    if (!r.ok) { setErr(r.error); return; }
    onRemoved((r as { removed: Window[] }).removed);
    setNote((r as { message: string }).message); setRes(null);
  });
  const close = () => { setOpen(false); setRes(null); setErr(''); setNote(''); };
  const short = res?.days.filter((d) => d.short) ?? [];
  const over = res?.days.filter((d) => d.over) ?? [];
  const byDay = (d: string) => res?.added.filter((w) => w.date === d).map((w) => names[w.staffId] ?? '').join('、') ?? '';

  return (
    <>
      <button className="btn ad-btn" type="button" onClick={() => setOpen(true)}>自動で下書き</button>
      {open && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && !pending && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="adT">
            <h3 id="adT">{month}月のシフトの下書きを自動で作る</h3>
            {!res ? (
              <>
                <ul className="sub ad-rules">
                  <li>シフト希望を出した人を、<b>希望の時間どおり</b>に入れます</li>
                  <li>その日の<b>予測の作業時間</b>（受発注台帳の入荷・出荷の個数と重さから）と<b>最低人数</b>を満たすまで入れます</li>
                  <li>日の人件費予算を超えないようにします（最低人数に届かない日だけは超えても入れます）</li>
                  <li>特定の人に偏らないよう、希望に対して入った割合が少ない人から選びます</li>
                  <li>すでに入れてあるシフトはそのまま。今日より前の日は入れません</li>
                </ul>
                <p className="sub" style={{ margin: '6px 0 0' }}>作業時間の目安や最低人数は <Link href="/manage/forecast">作業量の予測</Link> で変えられます。作ったあとは下書きなので、いつもどおり直してから公開してください。</p>
                {note && <p className="ok-t" style={{ margin: '8px 0 0' }}>{note}</p>}
                {err && <p className="bad-t" style={{ margin: '8px 0 0' }}>{err}</p>}
                <div className="actions"><button className="btn" onClick={close} disabled={pending}>閉じる</button><button className="btn primary" onClick={run} disabled={pending}>{pending ? '作っています…' : '下書きを作る'}</button></div>
              </>
            ) : (
              <>
                {res.added.length > 0
                  ? <p className="ad-done"><b>{res.added.length}コマ</b>を下書きに入れました。</p>
                  : <p className="ad-done"><b>新しく入れられるシフトはありませんでした。</b><span className="sub" style={{ display: 'block', fontWeight: 400 }}>{short.length ? '足りない日に、まだシフトに入っていない希望がありません（希望が出ていない・予算が足りない）。' : 'すでに予測の作業時間と最低人数を満たしているので、足すシフトはありません。'}</span></p>}
                <p className="sub" style={{ margin: '0 0 8px' }}>
                  {res.ledger ? '受発注台帳から作業時間を予測しました' : '受発注台帳がまだ届いていないため、作業時間は「毎日の決まった作業」と最低人数だけで決めました'}
                  {res.ledger && (res.using === 'learned' ? '（実績から学習した目安）' : '（仮の目安）')}。
                </p>
                {short.length > 0 ? (
                  <>
                    <b className="warn-t">足りない日 {short.length}日</b>
                    <p className="sub" style={{ margin: '2px 0 6px' }}>希望を出した人が足りない・予算が足りない日です。声をかけるか、手で入れてください。</p>
                    <div className="grid-wrap ad-list"><table className="tbl dense">
                      <thead><tr><th>日</th><th>予測</th><th>入れた</th><th>人数</th><th>入れた人</th></tr></thead>
                      <tbody>{short.map((d) => (
                        <tr key={d.date}><td className="num">{md(d.date)}</td><td className="num">{h1(d.needMin)}h</td><td className="num">{h1(d.workMin)}h</td>
                          <td className="num">{d.people}/{d.minPeople}人</td><td>{byDay(d.date) || '—'}</td></tr>
                      ))}</tbody>
                    </table></div>
                  </>
                ) : <p className="ok-t" style={{ margin: 0 }}>予測の作業時間と最低人数は、すべての日で満たしています。</p>}
                {over.length > 0 && (
                  <details className="ad-over">
                    <summary className="sub">日の予算を超えた日 <b>{over.length}日</b>（{over.slice(0, 3).map((d) => md(d.date)).join('、')}{over.length > 3 ? ' ほか' : ''}）　すでに入っているシフトも含めた額です</summary>
                    <div className="grid-wrap ad-list"><table className="tbl dense">
                      <thead><tr><th>日</th><th>人件費</th><th>予算</th><th>超えた額</th><th>今回入れた</th></tr></thead>
                      <tbody>{over.map((d) => (
                        <tr key={d.date}><td className="num">{md(d.date)}</td><td className="num">{yen(d.cost)}</td><td className="num">{yen(d.budget)}</td><td className="num warn-t">{yen(d.cost - d.budget)}</td><td className="num">{d.added ? `${d.added}人（最低人数のため）` : '—'}</td></tr>
                      ))}</tbody>
                    </table></div>
                  </details>
                )}
                {err && <p className="bad-t" style={{ margin: '8px 0 0' }}>{err}</p>}
                <div className="actions">
                  {res.added.length > 0 && <button className="btn danger left" onClick={undo} disabled={pending}>元に戻す</button>}
                  <button className="btn primary" onClick={close} disabled={pending}>閉じて確認する</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
