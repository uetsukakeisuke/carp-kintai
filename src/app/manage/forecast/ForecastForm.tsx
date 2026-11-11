'use client';
import { useState } from 'react';
import { saveForecastAction } from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';
import { predictMin, type Coef, type ForecastParams } from '@/lib/forecast';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const ROWS: { k: keyof Coef; label: string; unit: string; step: number }[] = [
  { k: 'inLine', label: '1件あたり', unit: '分', step: 1 },
  { k: 'inSqrt', label: '個数による分（×√個数）', unit: '分', step: 0.1 },
  { k: 'inKg', label: '1kgあたり', unit: '分', step: 0.1 },
];

/** 予測の目安・営業日・最低人数の設定 */
export function ForecastForm({ params, learned }: { params: ForecastParams; learned: Coef | null }) {
  const [p, setP] = useState(params);
  const setC = (k: keyof Coef, v: string) => setP((x) => ({ ...x, coef: { ...x.coef, [k]: Math.max(0, Number(v) || 0) } }));
  const ex = (kind: 'in' | 'out', c: Coef) => predictMin(kind === 'in' ? { inLines: 1, inSqrt: 10, inKg: 10, outLines: 0, outSqrt: 0, outKg: 0 } : { inLines: 0, inSqrt: 0, inKg: 0, outLines: 1, outSqrt: 10, outKg: 10 }, c, false);
  const block = (kind: 'in' | 'out', title: string) => (
    <fieldset className="fc-set">
      <legend>{title}</legend>
      {ROWS.map((r) => {
        const k = (kind === 'in' ? r.k : r.k.replace('in', 'out')) as keyof Coef;
        return (
          <label key={k} className="fc-row">
            <span>{r.label}</span>
            <input className="in num" type="number" min={0} step={r.step} value={p.coef[k]} onChange={(e) => setC(k, e.target.value)} aria-label={`${title} ${r.label}`} />
            <span className="sub">{r.unit}</span>
            {learned && <span className="fc-learn" title="実績から学習した値">学習 {learned[k]}</span>}
          </label>
        );
      })}
      <p className="sub fc-ex">例：100個・10kgの注文1件 → {ex(kind, p.coef)}分{learned ? `（学習した値なら ${ex(kind, learned)}分）` : ''}</p>
    </fieldset>
  );
  return (
    <div className="fc-form">
      <div className="fc-grid">
        {block('in', '入荷の作業（入荷した日：検品・仕分け）')}
        {block('out', '出荷の作業（出荷の日：検査・梱包・発送）')}
      </div>
      <div className="fc-grid">
        <fieldset className="fc-set">
          <legend>毎日のこと</legend>
          <label className="fc-row"><span>毎日の決まった作業（掃除・事務など）</span>
            <input className="in num" type="number" min={0} step={0.5} value={Math.round((p.coef.base / 60) * 10) / 10} onChange={(e) => setC('base', String((Number(e.target.value) || 0) * 60))} aria-label="毎日の決まった作業（時間）" />
            <span className="sub">時間</span>{learned && <span className="fc-learn">学習 {(learned.base / 60).toFixed(1)}</span>}</label>
          <label className="fc-row"><span>営業日の最低人数</span>
            <input className="in num" type="number" min={0} max={30} step={1} value={p.minPeople} onChange={(e) => setP({ ...p, minPeople: Math.max(0, Math.round(Number(e.target.value) || 0)) })} aria-label="最低人数" />
            <span className="sub">人</span></label>
          <label className="fc-row"><span>出荷は客先納入日の</span>
            <input className="in num" type="number" min={0} max={14} step={1} value={p.shipLead} onChange={(e) => setP({ ...p, shipLead: Math.max(0, Math.round(Number(e.target.value) || 0)) })} aria-label="出荷は何日前" />
            <span className="sub">日前</span></label>
        </fieldset>
        <fieldset className="fc-set">
          <legend>営業日</legend>
          <div className="fc-wd">
            {WD.map((w, i) => (
              <label key={w} className={p.workdays.includes(i) ? 'on' : ''}>
                <input type="checkbox" checked={p.workdays.includes(i)} onChange={(e) => setP({ ...p, workdays: e.target.checked ? [...p.workdays, i].sort() : p.workdays.filter((x) => x !== i) })} />{w}
              </label>
            ))}
          </div>
          <p className="sub" style={{ margin: '6px 0 0' }}>営業日には「毎日の決まった作業」と最低人数を入れます。営業日でない日も、入荷・出荷がある日は予測に出ます。</p>
          <label className="fc-check"><input type="checkbox" checked={p.learn} onChange={(e) => setP({ ...p, learn: e.target.checked })} /> 実績から自動で目安を直す（学習した日が10日以上たまったら、学習した値を使う）</label>
        </fieldset>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <ActionButton className="btn primary" action={() => saveForecastAction(p)}>保存</ActionButton>
      </div>
    </div>
  );
}
