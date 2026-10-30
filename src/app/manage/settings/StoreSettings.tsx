'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveStoreAction, enableTerminalAction } from '@/app/actions';
import { useToast } from '@/components/Toast';

type St = { id: number | null; name: string; active: boolean; b: number[] };
const LABELS = ['月〜木', '金曜', '土日'];

export function StoreSettings({ stores }: { stores: St[] }) {
  const [list, setList] = useState<St[]>(stores);
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  const [term, setTerm] = useState<number | null>(stores.find((s) => s.active)?.id ?? null);
  const upd = (i: number, v: Partial<St>) => setList((l) => l.map((x, j) => (j === i ? { ...x, ...v } : x)));
  const save = (s: St) => start(async () => {
    const r = await saveStoreAction(s.id, s.name, s.b[0], s.b[1], s.b[2], s.active);
    toast(r.ok ? r.message ?? '保存しました' : r.error);
    router.refresh();
  });
  return (
    <div className="narrow" style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <section>
        <h2 className="sec" style={{ marginTop: 0 }}>店舗と1日あたりの人件費予算</h2>
        <div className="list">
          {list.map((s, i) => (
            <div className="item" key={s.id ?? `new${i}`}>
              <div className="field"><span>店舗名</span><input className="in" value={s.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="店舗名" /></div>
              <div className="kv" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {[0, 1, 2].map((k) => (
                  <label key={k} className="field"><span>{LABELS[k]}（円）</span>
                    <input className="in num" type="number" inputMode="numeric" min={0} step={1000} value={s.b[k]} onChange={(e) => upd(i, { b: s.b.map((x, j) => (j === k ? Number(e.target.value) || 0 : x)) })} />
                  </label>
                ))}
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <label className="row" style={{ minHeight: 44, fontSize: 15 }}>
                  <input type="checkbox" style={{ width: 22, height: 22 }} checked={s.active} onChange={(e) => upd(i, { active: e.target.checked })} /> 営業中
                </label>
                <button className="btn primary" disabled={pending || !s.name.trim()} onClick={() => save(s)}>{s.id === null ? '追加する' : '保存する'}</button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn" style={{ marginTop: 10, width: '100%' }} onClick={() => setList((l) => [...l, { id: null, name: '', active: true, b: [0, 0, 0] }])}>＋ 店舗を追加</button>
        <p className="sub">閉店した店舗は「営業中」を外して保存すると、シフト表やログイン画面に出なくなります（過去の記録は残ります）。</p>
      </section>
      <section className="item">
        <h2 className="sec" style={{ margin: 0 }}>この端末を店舗端末にする</h2>
        <p className="sub" style={{ margin: 0 }}>休憩室などに置く共用のタブレットで使います。設定するとこの端末は打刻専用の画面になり、スタッフは名前を押して4桁のパスワードを入れるだけで打刻できます。あなたのログインはこの端末から外れます。</p>
        <select className="sel" aria-label="店舗" value={term ?? ''} onChange={(e) => setTerm(Number(e.target.value))}>
          {stores.filter((s) => s.active).map((s) => <option key={s.id!} value={s.id!}>{s.name}</option>)}
        </select>
        <form action={async () => { if (term) await enableTerminalAction(term); }}><button className="btn primary" type="submit" disabled={!term} style={{ width: '100%' }}>この端末を店舗端末にする</button></form>
      </section>
      {node}
    </div>
  );
}
