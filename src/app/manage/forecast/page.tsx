import Link from 'next/link';
import { requireManager } from '@/lib/auth';
import { listStores } from '@/lib/data';
import { forecast } from '@/lib/forecast-data';
import { MIN_LEARN_DAYS } from '@/lib/forecast';
import { jstParts, addDays, weekday, WD } from '@/lib/time';
import { ForecastForm } from './ForecastForm';

export const dynamic = 'force-dynamic';
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const dt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const DAYS = 42;

export default async function ForecastPage() {
  const u = await requireManager();
  const stores = await listStores();
  const store = stores[0];
  if (!store) return <div className="empty"><b>店舗が登録されていません</b></div>;
  const today = jstParts().date;
  const f = await forecast(store.id, today, addDays(today, DAYS - 1));
  const L = f.learning;
  const max = Math.max(480, ...f.days.map((d) => d.min));

  return (
    <>
      <div className="ph"><h1>作業量の予測</h1><span className="sub">{store.name}・シフトの下書きの自動作成に使います</span></div>
      {!f.ready && <div className="banner warn" style={{ marginBottom: 12 }}>データベースの準備（SQL）がまだです。上塚さんに SQL Editor での実行をお願いしてください。それまでは仮の目安で表示しています。</div>}

      <section className="fc-sum">
        <div className="card">
          <div className="k">受発注台帳</div>
          {f.ledgerAt ? <><b>{dt(f.ledgerAt)}</b><div className="sub">に届いた台帳から予測しています</div></>
            : <><b className="warn-t">まだ届いていません</b><div className="sub">届くまでは「毎日の決まった作業」と最低人数だけで下書きを作ります{u.role === 'admin' && <>。<Link href="/manage/orders">受発注の報告</Link>で台帳とつないでください</>}</div></>}
        </div>
        <div className="card">
          <div className="k">学習（実績に合わせる）</div>
          <b>{L ? `${L.fitted.n}日分` : '—'}</b>
          <div className="sub">
            {!L ? 'まだ使えません' : L.using === 'learned'
              ? `学習した目安を使っています。1日あたりのずれ 約${Math.round(L.fitted.mae / 6) / 10}時間（仮の目安なら約${Math.round(L.fitted.maePrior / 6) / 10}時間）`
              : `${MIN_LEARN_DAYS}日たまると学習した目安に切り替えます。いまは仮の目安です`}
          </div>
        </div>
      </section>
      <p className="sub" style={{ margin: '0 0 14px' }}>
        学習には、台帳の「仕入」「客先納品」が済になった日と、その日に実際に働いた時間（打刻）を使います。台帳の済をその日のうちに付けるほど、予測が正確になります。
      </p>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="item-h"><b>これから{DAYS / 7}週間の予測</b><span className="sub">作業時間＝入荷・出荷の作業＋毎日の決まった作業</span></div>
        <div className="fc-days">
          {f.days.map((d) => {
            const w = weekday(d.date), ins = d.load?.items.filter((i) => i.kind === 'in') ?? [], outs = d.load?.items.filter((i) => i.kind === 'out') ?? [];
            return (
              <details key={d.date} className={`fc-day${d.workday ? '' : ' off'}${w === 0 ? ' sun' : w === 6 ? ' sat' : ''}`}>
                <summary>
                  <span className="fc-d num">{md(d.date)}<small>{WD[w]}</small></span>
                  <span className="fc-bar"><i style={{ width: `${Math.min(100, (d.min / max) * 100)}%` }} /></span>
                  <span className="fc-h num">{(d.min / 60).toFixed(1)}h</span>
                  <span className="fc-n sub">{ins.length ? `入荷${ins.length}` : ''}{ins.length && outs.length ? '・' : ''}{outs.length ? `出荷${outs.length}` : ''}{!ins.length && !outs.length ? (d.workday ? '' : '休み') : ''}</span>
                </summary>
                {d.load ? (
                  <ul className="fc-items">
                    {d.load.items.map((i, n) => (
                      <li key={n}><span className={`fc-k ${i.kind}`}>{i.kind === 'in' ? '入荷' : '出荷'}</span>{i.part}<span className="sub">　{i.customer}・{i.qty.toLocaleString('ja-JP')}個・{Math.round(i.kg * 10) / 10}kg{i.late ? '・予定日を過ぎています' : ''}</span></li>
                    ))}
                  </ul>
                ) : <p className="sub" style={{ margin: '4px 0 0' }}>入荷・出荷の予定はありません。</p>}
              </details>
            );
          })}
        </div>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="item-h"><b>予測の目安</b><span className="sub">はじめは仮の値です。実績がたまると自動で直ります</span></div>
        <p className="sub" style={{ margin: '2px 0 10px' }}>1行の注文あたりの作業時間＝1件あたり＋個数による分×√個数＋1kgあたり×重さ。個数は√にしているので、数が多いほど1個あたりの時間は短くなります。</p>
        <ForecastForm params={f.params} learned={L && L.fitted.n >= 2 ? L.fitted.coef : null} />
      </section>
      <p className="sub"><Link href="/manage/shifts">シフト作成</Link>の「自動で下書き」で、この予測を使って下書きを作ります。</p>
    </>
  );
}
