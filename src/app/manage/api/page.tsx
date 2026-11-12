import { headers } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
import { listApiKeys, SCOPES, type ApiKeyRow } from '@/lib/apikeys';
import { NewKey, RevokeKey } from './ApiKeys';

export const dynamic = 'force-dynamic';
const dt = (d: Date | null) => (d ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—');

export default async function ApiPage() {
  await requireAdmin();
  let keys: ApiKeyRow[] = [], ready = true;
  try { keys = await listApiKeys(); } catch { ready = false; }
  const h = await headers();
  const base = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}/api/v1`;
  return (
    <div className="narrow">
      <p className="sub" style={{ margin: '-6px 0 12px' }}>公式LINEなど、ほかのシステムがアプリのデータを読むためのキーです。読めるのは公開済みのシフト・予定表・スタッフの名前だけで、時給・暗証番号・給与明細・下書きのシフトは読めません。書き換えもできません。</p>
      {!ready && <div className="banner warn" style={{ marginBottom: 12 }}>データベースの準備（SQL）がまだです。SQL Editor で実行してから使ってください。</div>}

      <section className="card" style={{ marginBottom: 14 }}>
        <b>新しいAPIキー</b>
        <div style={{ marginTop: 8 }}><NewKey scopes={SCOPES} /></div>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <b>発行したキー</b>
        {keys.length === 0 ? <p className="sub" style={{ margin: '6px 0 0' }}>まだありません。</p> : (
          <div className="grid-wrap" style={{ marginTop: 8 }}><table className="tbl stack dense">
            <thead><tr><th>使い道</th><th>キーの先頭</th><th>読める範囲</th><th>最後に使った</th><th>発行</th><th /></tr></thead>
            <tbody>{keys.map((k) => (
              <tr key={k.id}>
                <td className="head"><b>{k.name}</b>{k.revoked_at && <span className="flag f-late">取り消し済み</span>}</td>
                <td data-label="キー" className="num">{k.prefix}…</td>
                <td data-label="範囲" className="full">{k.scopes.map((s) => SCOPES[s] ?? s).join('・')}</td>
                <td data-label="最後に使った" className="num">{dt(k.last_used_at)}</td>
                <td data-label="発行" className="num hide-sp">{dt(k.created_at)}{k.created_by_name ? `（${k.created_by_name}）` : ''}</td>
                <td className="acts">{!k.revoked_at && <RevokeKey id={k.id} name={k.name} />}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="sub" style={{ margin: '8px 0 0' }}>キーが漏れたかもしれないときや、連携をやめるときは「取り消す」。新しいキーを発行して渡し直してください。</p>
      </section>

      <section className="card">
        <b>連携する人に伝えること</b>
        <ul className="sub api-doc">
          <li>アドレス：<code>{base}</code></li>
          <li>キーは毎回ヘッダーに付ける：<code>Authorization: Bearer ck_…</code></li>
          <li><code>GET /day?date=2026-11-12</code> … その日に出勤する人ごとの、シフトと予定（全体＋その人）。1人ずつ送るならこれ</li>
          <li><code>GET /shifts?from=…&amp;to=…</code> … 公開済みのシフト（62日まで）</li>
          <li><code>GET /tasks?from=…&amp;to=…</code> … 予定表</li>
          <li><code>GET /staff</code> … スタッフの名前と番号（LINEの友だちとの結びつけに使う）</li>
        </ul>
        <p className="sub" style={{ margin: '6px 0 0' }}>くわしい仕様書は別に渡します。</p>
      </section>
    </div>
  );
}
