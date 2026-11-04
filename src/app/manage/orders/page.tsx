import { headers } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
import { latestSnapshot, ledgerSettings } from '@/lib/ledger';
import { buildReport, reportText, shortName, md, SOON_DAYS, type Flag, type OrderRow } from '@/lib/kobo';
import { gasLedgerScript } from '@/lib/gas-ledger';
import { jstParts } from '@/lib/time';
import { ScriptBox } from '../payslips/PayslipAdmin';
import { SheetForm, LinePreview, RotateLedgerSecret } from './OrdersAdmin';

export const dynamic = 'force-dynamic';

const dt = (d: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const money = (n: number) => Math.round(n).toLocaleString('ja-JP') + '円';
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const STALE_H = 3;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [cfg, snap] = await Promise.all([ledgerSettings(), latestSnapshot()]);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(sp.d ?? '') ? sp.d! : jstParts().date;
  const r = snap ? buildReport(snap.orders, snap.terms, today) : null;
  const h = await headers();
  const appUrl = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  const ageH = snap ? (Date.now() - new Date(snap.received_at).getTime()) / 3600000 : 0;
  const link = (line: number) => cfg.sheetId ? `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit#gid=${snap?.meta?.gid ?? 0}&range=A${line}` : null;

  const Line = ({ n }: { n: number }) => { const u = link(n); return u ? <a href={u} target="_blank" rel="noopener noreferrer">{n}行目</a> : <>{n}行目</>; };
  const Head = ({ x, flag }: { x: OrderRow; flag?: React.ReactNode }) => (
    <td className="head"><b>{x.part}</b>{flag}</td>
  );
  const status = (x: OrderRow) => x.fromStock ? '在庫から' : x.received ? '入荷済み' : '未入荷';

  const setup = (
    <>
      <b>台帳とつなぐ</b>
      <p className="sub" style={{ margin: '4px 0 10px' }}>
        台帳（スプレッドシート）の「受発注履歴」と「取引先一覧」を、1時間ごとにこのアプリへ送ります。読むだけで、台帳を書き換えることはありません。
      </p>
      <ol className="steps">
        <li>
          台帳のURLを貼り付けて「登録」{cfg.sheetId && <span className="ok-t">（登録済み）</span>}
          <div style={{ marginTop: 6 }}><SheetForm has={!!cfg.sheetId} /></div>
        </li>
        <li>台帳を開ける Google アカウントで <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener noreferrer">script.google.com（新しいプロジェクト）</a> を開く。<b>台帳の中のスクリプト（拡張機能 → Apps Script）ではなく、新しいプロジェクト</b>に貼ってください（台帳の今の自動実行には触れません）</li>
        <li>最初から入っている文字をすべて消し、下のスクリプトを「コピー」して貼り付け、保存（💾）</li>
        <li>上の関数の選択欄で <b>setup</b> を選んで「実行」→ Google の許可画面で「許可」</li>
        <li>この画面を開き直すと、今日の報告が出ます。以後は1時間ごとに新しい台帳に入れ替わります</li>
      </ol>
      {cfg.sheetId
        ? <div style={{ marginTop: 10 }}><ScriptBox code={gasLedgerScript(appUrl, cfg.secret, cfg.sheetId)} /></div>
        : <p className="sub" style={{ margin: '10px 0 0' }}>台帳のURLを登録すると、ここにスクリプトが出ます。</p>}
      <p className="sub" style={{ margin: '8px 0 0' }}>スクリプトの中の合言葉（SECRET）は、このアプリに台帳を送るための鍵です。他の人に見せないでください。漏れたときは作り直してください。</p>
      <div style={{ marginTop: 8 }}><RotateLedgerSecret /></div>
    </>
  );

  if (!snap || !r) {
    return (
      <div className="narrow">
        <div className="ph"><h1>受発注の報告</h1></div>
        <div className="empty" style={{ marginBottom: 14 }}><b>まだ台帳が届いていません</b>下の手順で台帳とつなぐと、毎朝の報告がここに出ます。</div>
        <section className="card">{setup}</section>
      </div>
    );
  }

  const text = reportText(r);
  const bySupplier = groupBy(r.late, (f) => f.row.supplier);
  const byBill = groupBy(r.unbilled, (f) => `${f.row.customer}|${f.closing}`);
  const cards: { id: string; k: string; n: number; tone: string }[] = [
    { id: 'overdue', k: '客先納期の超過', n: r.overdue.length, tone: 'bad' },
    { id: 'soon', k: `納期${SOON_DAYS}日以内で未入荷`, n: r.soon.length, tone: 'warn' },
    { id: 'late', k: '仕入先の遅れ', n: r.late.length, tone: 'warn' },
    { id: 'unbilled', k: '締め日を過ぎて未請求', n: r.unbilled.length, tone: 'warn' },
  ];

  return (
    <>
      <div className="ph"><h1>受発注の報告</h1><span className="sub">{md(today)}（{'日月火水木金土'[new Date(today + 'T00:00:00Z').getUTCDay()]}）京都工房</span></div>
      <p className="sub" style={{ margin: '-8px 0 12px' }}>
        台帳の取り込み：{dt(new Date(snap.received_at))}（注文 {r.read}行）
        {ageH > STALE_H && <span className="warn-t">　最後に届いてから{Math.floor(ageH)}時間たっています。スクリプトが止まっていないか確認してください</span>}
      </p>
      {r.fallbackColumns.length > 0 && (
        <div className="banner" style={{ marginBottom: 12 }}>台帳の見出しが見つからない列があったため、決まった位置で読んでいます：{r.fallbackColumns.join('、')}</div>
      )}

      <section className="ord-sum" aria-label="件数">
        {cards.map((c) => (
          <a key={c.id} href={`#${c.id}`} className={`card ord-card ${c.n ? c.tone : 'zero'}`}>
            <span className="k">{c.k}</span><b className="num">{c.n}<small>件</small></b>
          </a>
        ))}
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="item-h"><b>LINEで届く文面（見本）</b></div>
        <p className="sub" style={{ margin: '2px 0 8px' }}>LINEにつなぐと、毎朝この文面が上塚さんに届きます。今はこの画面で確かめる段階です。</p>
        <LinePreview text={text} />
      </section>

      <Sec id="overdue" title="客先納期を過ぎているもの" n={r.overdue.length} rule="客先納入日を過ぎていて、客先納品が「済」でない行">
        <Table head={['品番', '売上', '客先', '客先納期', '仕入', '仕入先', '台帳']}>{r.overdue.map(({ row: x }) => (
          <tr key={x.line}>
            <Head x={x} flag={<span className="flag f-late">{days(x.custDue!, today)}日超過</span>} />
            <td className="amt num">{money(x.amount)}</td>
            <td data-label="客先">{shortName(x.customer)}</td>
            <td data-label="客先納期" className="num">{md(x.custDue!)}</td>
            <td data-label="仕入">{status(x)}</td>
            <td data-label="仕入先">{shortName(x.supplier) || '—'}</td>
            <td data-label="台帳"><Line n={x.line} /></td>
          </tr>
        ))}</Table>
      </Sec>

      <Sec id="soon" title={`客先納期まで${SOON_DAYS}日以内なのに未入荷`} n={r.soon.length} rule={`客先納入日まであと${SOON_DAYS}日以内で、仕入が「済」でない行`}>
        <Table head={['品番', '売上', '客先', '客先納期', '仕入納期', '仕入先', '台帳']}>{r.soon.map(({ row: x }) => (
          <tr key={x.line}>
            <Head x={x} flag={<span className="flag f-late">あと{days(today, x.custDue!)}日</span>} />
            <td className="amt num">{money(x.amount)}</td>
            <td data-label="客先">{shortName(x.customer)}</td>
            <td data-label="客先納期" className="num">{md(x.custDue!)}</td>
            <td data-label="仕入納期" className="num">{x.supDue ? md(x.supDue) : '—'}{x.supDue && x.supDue < today && <span className="bad-t">（過ぎています）</span>}</td>
            <td data-label="仕入先">{shortName(x.supplier) || '—'}</td>
            <td data-label="台帳"><Line n={x.line} /></td>
          </tr>
        ))}</Table>
      </Sec>

      <Sec id="late" title="仕入先の遅れ" n={r.late.length} rule="仕入納期を過ぎていて、仕入が「済」でない行（仕入先が「在」の行は除く）">
        {bySupplier.map(([sup, fs]) => (
          <div key={sup} className="ord-grp">
            <h3>{shortName(sup) || '（仕入先が空欄）'}<span className="sub">　{fs.length}件</span></h3>
            <Table head={['品番', '仕入納期', '客先', '客先納期', '個数', '台帳']}>{fs.map(({ row: x }) => (
              <tr key={x.line}>
                <Head x={x} flag={<span className="flag f-late">{days(x.supDue!, today)}日遅れ</span>} />
                <td data-label="仕入納期" className="num">{md(x.supDue!)}</td>
                <td data-label="客先">{x.toStock ? '在庫にする分' : shortName(x.customer)}</td>
                <td data-label="客先納期" className="num">{x.custDue ? md(x.custDue) : '—'}</td>
                <td data-label="個数" className="num">{x.qty || '—'}</td>
                <td data-label="台帳"><Line n={x.line} /></td>
              </tr>
            ))}</Table>
          </div>
        ))}
      </Sec>

      <Sec id="unbilled" title="締め日を過ぎて未請求" n={r.unbilled.length} rule="客先納品が「済」で、客先の締め日（取引先一覧の支払い条件）を過ぎても、請求書発行が「済」でない行。0円の行と客先が「在」の行は除く。締め日は客先納入日から数えています">
        {byBill.map(([k, fs]) => (
          <div key={k} className="ord-grp">
            <h3>{shortName(fs[0].row.customer)}<span className="sub">　締め日 {md(fs[0].closing!)}・{fs.length}件・{money(fs.reduce((a, f) => a + f.row.amount, 0))}</span></h3>
            <Table head={['品番', '売上', '客先納入日', '検収', '台帳']}>{fs.map(({ row: x }) => (
              <tr key={x.line}>
                <Head x={x} />
                <td className="amt num">{money(x.amount)}</td>
                <td data-label="客先納入日" className="num">{md(x.custDue!)}</td>
                <td data-label="検収">{x.inspected ? '済' : '未'}</td>
                <td data-label="台帳"><Line n={x.line} /></td>
              </tr>
            ))}</Table>
          </div>
        ))}
      </Sec>

      {r.unpaid.length > 0 && (
        <Sec id="unpaid" title="未入金のメモ" n={r.unpaid.length} rule="品名に「未入金」とある行">
          <Table head={['客先', '金額', '内容', '台帳']}>{r.unpaid.map((u) => (
            <tr key={u.line}>
              <td className="head"><b>{shortName(u.customer)}</b></td>
              <td className="amt num">{money(u.amount)}</td>
              <td data-label="内容" className="full">{u.label}</td>
              <td data-label="台帳"><Line n={u.line} /></td>
            </tr>
          ))}</Table>
        </Sec>
      )}

      <Sec id="issues" title="台帳の確認" n={r.issues.length} rule="正しく判定できなかった行。直すと次の取り込みから反映されます">
        <Table head={['品番・客先', '内容', '台帳']}>{r.issues.map((i, n) => (
          <tr key={`${i.line}-${n}`}>
            <td className="head"><b>{i.part}</b></td>
            <td data-label="内容" className="full">{i.what}</td>
            <td data-label="台帳"><Line n={i.line} /></td>
          </tr>
        ))}</Table>
      </Sec>

      <p className="sub" style={{ margin: '4px 0 16px' }}>
        判定から外している行：仕入先が「在」（在庫から出す）は仕入のチェックをしない／客先が「在」（在庫にする）は客先納期と請求のチェックをしない／売上0円は請求のチェックをしない。
      </p>

      <details className="card" style={{ marginBottom: 14 }}>
        <summary><b>台帳との連携（設定）</b></summary>
        <div style={{ marginTop: 12 }}>{setup}</div>
      </details>
    </>
  );
}

function groupBy(fs: Flag[], key: (f: Flag) => string): [string, Flag[]][] {
  const m = new Map<string, Flag[]>();
  for (const f of fs) m.set(key(f), [...(m.get(key(f)) ?? []), f]);
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
}
function Sec({ id, title, n, rule, children }: { id: string; title: string; n: number; rule: string; children: React.ReactNode }) {
  return (
    <section id={id} className="ord-sec">
      <h2>{title}<span className={`ord-n${n ? '' : ' zero'}`}>{n}件</span></h2>
      <p className="sub">{rule}</p>
      {n ? children : <p className="ord-none">ありません</p>}
    </section>
  );
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="grid-wrap"><table className="tbl stack dense ord-tbl">
      <thead><tr>{head.map((x) => <th key={x}>{x}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table></div>
  );
}
