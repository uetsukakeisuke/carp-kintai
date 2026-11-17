'use client';
import { useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { previewShiftImportAction, applyShiftImportAction, type ShiftImportPreviewReply } from '@/app/actions';
import { call } from '@/lib/call';
import { planCost } from '@/lib/calc';
import { partsText, partsOf } from '@/lib/shift-parts';
import { importDiff, type ImportEntry } from '@/lib/shift-import';

type Preview = Extract<ShiftImportPreviewReply, { ok: true }>;
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WD[new Date(d + 'T00:00:00Z').getUTCDay()]}）`;
const h1 = (m: number) => (Math.round(m / 6) / 10).toString();

/** シフト作成：スマレジのシフト表（Excel）や CSV から、1か月分を下書きに一括で入れる */
export function ShiftImport({ storeId, year, month }: { storeId: number; year: number; month: number }) {
  const [open, setOpen] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null);
  const [fileName, setFileName] = useState('');
  const [map, setMap] = useState<number[]>([]); // ファイルの行 → スタッフID（0＝取り込まない）
  const [mode, setMode] = useState<'replace' | 'fill'>('replace');
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setPv(null); setErr(''); setDone(''); setFileName(''); setMode('replace'); if (input.current) input.current.value = ''; };
  const close = () => { if (pending) return; setOpen(false); reset(); };
  const pick = (f: File | undefined) => {
    if (!f) return;
    setErr(''); setFileName(f.name);
    start(async () => {
      const fd = new FormData();
      fd.set('storeId', String(storeId)); fd.set('file', f);
      const r = await call(() => previewShiftImportAction(fd));
      if (!r.ok) { setErr(r.error); setPv(null); return; }
      setPv(r); setMap(r.rows.map((x) => x.staffId ?? 0));
    });
  };

  const sum = useMemo(() => {
    if (!pv) return null;
    const staffIds = map.filter((id) => id > 0);
    const dup = new Set(staffIds.filter((id, i) => staffIds.indexOf(id) !== i));
    const entries: ImportEntry[] = pv.rows.flatMap((r, i) => (map[i] > 0 ? r.days.map((d) => ({ staffId: map[i], date: d.date, start: d.start, end: d.end, parts: d.parts })) : []));
    const diff = importDiff(pv.existing, entries, staffIds, mode);
    const unmatched = pv.rows.filter((r, i) => !map[i] && r.days.length > 0);
    const split = entries.some((e) => e.parts);
    const work = entries.reduce((a, e) => a + planCost(e, 0).workMin, 0);
    return { staffIds: [...new Set(staffIds)], dup, entries, diff, unmatched, split, work };
  }, [pv, map, mode]);

  const apply = () => {
    if (!pv || !sum) return;
    start(async () => {
      const r = await call(() => applyShiftImportAction(storeId, pv.ym, sum.entries, sum.staffIds, mode), 60_000);
      if (!r.ok) { setErr(r.error); return; }
      setDone(r.message ?? '取り込みました');
    });
  };
  const [py, pm] = pv ? pv.ym.split('-').map(Number) : [year, month];
  const blocked = !pv || !sum || !sum.staffIds.length || sum.dup.size > 0 || (sum.split && !pv.partsReady);

  return (
    <>
      <button className="btn" type="button" onClick={() => setOpen(true)}>スマレジから取り込む</button>
      {open && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal si-modal" role="dialog" aria-modal="true" aria-labelledby="siT">
            <h3 id="siT">シフトをファイルから取り込む</h3>
            {done ? (
              <>
                <p className="ok-t" style={{ margin: '4px 0 8px' }}><b>{done}</b></p>
                <p className="sub" style={{ margin: 0 }}>下書きなので、スタッフにはまだ見えません。シフト表で確かめてから「確定・公開」してください。</p>
                <div className="actions">
                  <button className="btn" onClick={reset}>別のファイルも取り込む</button>
                  <button className="btn primary" onClick={() => window.location.assign(`/manage/shifts?store=${storeId}&ym=${pv?.ym ?? `${year}-${String(month).padStart(2, '0')}`}`)}>{pm}月のシフト表を見る</button>
                </div>
              </>
            ) : !pv ? (
              <>
                <p className="sub" style={{ margin: '0 0 10px' }}>
                  スマレジのシフト表から出力した Excel（.xlsx）を、そのまま選んでください。1か月分をまとめて<b>下書き</b>に入れます（公開はあとで）。
                  CSV でも、「名前・日付・開始・終了」の列があれば読めます。
                </p>
                <label className={`si-drop${pending ? ' busy' : ''}`}>
                  <input ref={input} type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => pick(e.target.files?.[0])} disabled={pending} />
                  <b>{pending ? `${fileName} を読んでいます…` : 'ファイルを選ぶ'}</b>
                  <span className="sub">Excel（.xlsx）・CSV</span>
                </label>
                {err && <p className="bad-t" style={{ margin: '8px 0 0' }}>{err}</p>}
                <div className="actions"><button className="btn" onClick={close} disabled={pending}>閉じる</button></div>
              </>
            ) : (
              <>
                <p className="meta" style={{ marginTop: 0 }}>
                  <b>{py}年{pm}月</b>のシフト・{pv.rows.length}人分（{fileName}）
                  {(py !== year || pm !== month) && <span className="warn-t">　いま開いている{month}月とは違う月です</span>}
                </p>
                <div className="grid-wrap si-list"><table className="tbl dense">
                  <thead><tr><th>ファイルの名前</th><th>アプリのスタッフ</th><th>日数</th><th>時間</th></tr></thead>
                  <tbody>
                    {pv.rows.map((r, i) => {
                      const work = r.days.reduce((a, d) => a + planCost(d, 0).workMin, 0);
                      const isDup = map[i] > 0 && sum!.dup.has(map[i]);
                      return (
                        <tr key={i} className={!map[i] && r.days.length ? 'si-miss' : ''}>
                          <td><b>{r.name}</b>
                            {r.days.length > 0 && (
                              <details className="si-days"><summary className="sub">日ごとに見る</summary>
                                <ul>{r.days.map((d) => <li key={d.date} className="num">{md(d.date)} {partsText(partsOf(d))}</li>)}</ul>
                              </details>
                            )}
                          </td>
                          <td>
                            <select className="sel" value={map[i]} aria-label={`${r.name}を入れるスタッフ`} onChange={(e) => setMap((m) => m.map((x, j) => (j === i ? Number(e.target.value) : x)))}>
                              <option value={0}>（取り込まない）</option>
                              {pv.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            {isDup && <div className="bad-t si-note">同じスタッフが2行に選ばれています</div>}
                            {!map[i] && r.days.length > 0 && <div className="warn-t si-note">アプリに同じ名前の人がいません</div>}
                          </td>
                          <td className="num">{r.days.length ? `${r.days.length}日` : '—'}</td>
                          <td className="num">{work ? `${h1(work)}h` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                {sum!.unmatched.length > 0 && (
                  <p className="sub" style={{ margin: '6px 0 0' }}>
                    名前が合わない人（{sum!.unmatched.map((r) => r.name).join('、')}）は、スタッフを選ぶか、<Link href="/manage/staff">スタッフ・時給</Link>で追加してから、もう一度ファイルを選んでください。
                  </p>
                )}
                <fieldset className="si-mode">
                  <legend className="sub">今ある{pm}月の下書きとの重なり</legend>
                  <label><input type="radio" name="si-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> 選んだ人の{pm}月のシフトを、ファイルの内容に<b>置き換える</b>（おすすめ）</label>
                  <label><input type="radio" name="si-mode" checked={mode === 'fill'} onChange={() => setMode('fill')} /> シフトが入っていない日だけ入れる（入っている日はそのまま）</label>
                </fieldset>
                <div className="si-sum">
                  <span>入る <b className="num">{sum!.diff.added}</b>件</span>
                  {mode === 'replace' ? <><span>時間が変わる <b className="num">{sum!.diff.changed}</b>件</span><span className={sum!.diff.removed ? 'warn-t' : ''}>外れる <b className="num">{sum!.diff.removed}</b>件</span><span className="sub">同じ {sum!.diff.same}件</span></>
                    : <span className="sub">入っているので入れない {sum!.diff.skipped}件</span>}
                  <span className="sub">合計 {h1(sum!.work)}時間</span>
                </div>
                {sum!.split && <p className="sub" style={{ margin: '6px 0 0' }}>「8:45〜10:15・10:30〜12:00」のように分かれた日は、分かれたまま入れます。間の時間は勤務に数えません。</p>}
                {sum!.split && !pv.partsReady && <p className="bad-t" style={{ margin: '6px 0 0' }}>分かれた時間帯を入れるには、先にデータベースの準備が必要です。Supabase の SQL Editor で <code>db/update-2026-11-17-shifts.sql</code> を実行してから、もう一度ファイルを選んでください。</p>}
                {pv.warnings.length > 0 && (
                  <details className="si-warn" open={pv.warnings.length <= 3}><summary className="warn-t">読めなかったところ {pv.warnings.length}件</summary>
                    <ul>{pv.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                )}
                {err && <p className="bad-t" style={{ margin: '8px 0 0' }}>{err}</p>}
                <div className="actions">
                  <button className="btn left" onClick={reset} disabled={pending}>別のファイル</button>
                  <button className="btn" onClick={close} disabled={pending}>やめる</button>
                  <button className="btn primary" onClick={apply} disabled={pending || blocked}>{pending ? '取り込んでいます…' : `${pm}月の下書きに取り込む`}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
