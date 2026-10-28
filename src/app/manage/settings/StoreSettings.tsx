'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveStoreAction, enableTerminalAction } from '@/app/actions';
import { useToast } from '@/components/Toast';

type St = { id: number | null; name: string; active: boolean; b: number[] };

export function StoreSettings({ stores }: { stores: St[] }) {
  const [list, setList] = useState<St[]>(stores);
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  const [term, setTerm] = useState<number | null>(stores.find((s) => s.active)?.id ?? null);
  const upd = (i: number, v: Partial<St>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...v } : x)));
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <section>
        <h2 className="sec" style={{ marginTop: 0 }}>店舗と人件費の予算（円／日）</h2>
        <div className="grid-wrap"><table className="tbl" style={{ minWidth: 720 }}>
          <thead><tr><th>店舗名</th><th>月〜木</th><th>金</th><th>土日</th><th>状態</th><th></th></tr></thead>
          <tbody>
            {list.map((s, i) => (
              <tr key={s.id ?? `new${i}`}>
                <td><input className="in" aria-label="店舗名" value={s.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                {[0, 1, 2].map((k) => <td key={k}><input className="in num" style={{ width: 110 }} type="number" min={0} step={1000} aria-label="予算" value={s.b[k]} onChange={(e) => upd(i, { b: s.b.map((x, j) => (j === k ? Number(e.target.value) || 0 : x)) })} /></td>)}
                <td><label className="row"><input type="checkbox" checked={s.active} onChange={(e) => upd(i, { active: e.target.checked })} /> 営業中</label></td>
                <td><button className="btn" disabled={pending} onClick={() => start(async () => { const r = await saveStoreAction(s.id, s.name, s.b[0], s.b[1], s.b[2], s.active); toast(r.ok ? r.message ?? '保存しました' : r.error); router.refresh(); })}>保存</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <button className="btn" style={{ marginTop: 8 }} onClick={() => setList((l) => [...l, { id: null, name: '', active: true, b: [0, 0, 0] }])}>店舗を追加</button>
        <p className="sub">閉店した店舗は「営業中」を外すと、シフト表やログイン画面に出なくなります（過去の記録は残ります）。</p>
      </section>
      <section className="card">
        <h2 className="sec" style={{ marginTop: 0 }}>この端末を店舗端末にする</h2>
        <p className="sub">休憩室などに置く共用のタブレットで使います。設定するとこの端末は打刻専用の画面になり、スタッフは名前を押してパスワードを入れるだけで打刻できます。あなたのログインはこの端末から外れます。</p>
        <div className="row">
          <select className="sel" value={term ?? ''} onChange={(e) => setTerm(Number(e.target.value))}>
            {stores.filter((s) => s.active).map((s) => <option key={s.id!} value={s.id!}>{s.name}</option>)}
          </select>
          <form action={async () => { if (term) await enableTerminalAction(term); }}><button className="btn primary" type="submit" disabled={!term}>この端末を店舗端末にする</button></form>
        </div>
      </section>
      {node}
    </div>
  );
}
