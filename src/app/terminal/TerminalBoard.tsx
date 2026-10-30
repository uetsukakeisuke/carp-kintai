'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { terminalStateAction, terminalPunchAction, disableTerminalAction } from '@/app/actions';
import { NEXT, lastKind, type PunchKind } from '@/lib/calc';
import { Keypad } from '@/components/Keypad';
import { Clock } from '@/components/Clock';
import { PunchButtons } from '@/components/PunchButtons';
import { PunchLog, STATE_LABEL } from '@/components/PunchLog';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';
import { FaceStep } from '@/components/FaceStep';
import { loadFace } from '@/lib/face-client';

const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
type Row = { id: number; name: string; state: string; plan: { start: number; end: number } | null };

export function TerminalBoard({ storeName, rows, managers }: { storeName: string; rows: Row[]; managers: { id: number; name: string }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Row | null>(null);
  const [pin, setPin] = useState('');
  const [punches, setPunches] = useState<{ kind: PunchKind; minute: number }[] | null>(null);
  const [faceKind, setFaceKind] = useState<PunchKind | null>(null);
  // 店舗端末では顔認証の準備を最初にしておく
  useEffect(() => { const t = setTimeout(() => loadFace().catch(() => {}), 2000); return () => clearTimeout(t); }, []);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const [admin, setAdmin] = useState(false);
  const [mgr, setMgr] = useState<number>(managers[0]?.id ?? 0);

  // 最新の状態にし続ける（1分ごと）。入力中は止める。
  useEffect(() => { if (sel || admin) return; const t = setInterval(() => router.refresh(), 60000); return () => clearInterval(t); }, [sel, admin, router]);
  // 放置されたら閉じる（他の人が続けて押さないように）
  useEffect(() => { if (!sel) return; const t = setTimeout(() => close(), 45000); return () => clearTimeout(t); }, [sel, punches]); // eslint-disable-line

  const close = () => { setSel(null); setPin(''); setPunches(null); setErr(''); setFaceKind(null); };
  const check = (v: string) => start(async () => {
    setErr('');
    const r = await call(() => terminalStateAction(sel!.id, v));
    if (!r.ok) { setErr(r.error); setPin(''); return; }
    setPunches(r.punches);
  });
  const punch = (k: PunchKind) => setFaceKind(k); // 押したら顔の確認へ
  const doPunch = (k: PunchKind, f: { r: string; dist?: number }) => start(async () => {
    const r = await call(() => terminalPunchAction(sel!.id, pin, k, f));
    const name = sel!.name;
    close();
    toast(r.ok ? `${name}さん ${r.message}` : r.error);
    router.refresh();
  });

  return (
    <main className="wrap" style={{ paddingTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>{storeName} 打刻</h1>
        <button className="btn ghost" onClick={() => setAdmin(true)}>端末の設定</button>
      </div>
      <Clock />
      <p className="sub" style={{ textAlign: 'center', marginTop: 0 }}>自分の名前を押して、打刻コード（4桁）を入れてください。</p>
      <div className="termgrid">
        {rows.map((r) => (
          <button key={r.id} className="tcard" onClick={() => setSel(r)}>
            <b>{r.name}</b>
            <span className={`stt s-${r.state}`}>{STATE_LABEL[r.state]}</span>
            <small className="sub num">{r.plan ? `${hm(r.plan.start)}〜${hm(r.plan.end)}` : 'シフトなし'}</small>
          </button>
        ))}
      </div>
      {sel && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tm">
            <h3 id="tm">{sel.name}さん</h3>
            {punches === null ? (
              <>
                <p className="meta">打刻コード（4桁）を入れてください</p>
                <Keypad value={pin} onChange={setPin} onDone={check} disabled={pending} />
              </>
            ) : faceKind ? (
              <>
                {pending ? <p className="sub" style={{ textAlign: 'center' }}>記録しています…</p>
                  : <FaceStep staffId={sel.id} onResult={(f) => doPunch(faceKind, f)} />}
              </>
            ) : (
              <>
                <p className="meta">{sel.plan ? `今日のシフト ${hm(sel.plan.start)}〜${hm(sel.plan.end)}` : '今日のシフトはありません'}</p>
                <PunchButtons allowed={NEXT[lastKind(punches)]} reClockIn={lastKind(punches) === 'out'} disabled={pending} onPunch={punch} />
                {punches.length > 0 && <div className="todaylog" style={{ marginTop: 12 }}><PunchLog punches={punches} /></div>}
              </>
            )}
            {err && <p className="err" role="alert" style={{ textAlign: 'center' }}>{err}</p>}
            <div className="actions"><button className="btn" onClick={close}>閉じる</button></div>
          </div>
        </div>
      )}
      {admin && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setAdmin(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ta">
            <h3 id="ta">店舗端末の設定を解除</h3>
            <p className="meta">解除すると、この端末は通常のログイン画面に戻ります。店長・管理者のパスワードが必要です。</p>
            <select className="sel" value={mgr} onChange={(e) => setMgr(Number(e.target.value))} style={{ width: '100%', marginBottom: 8 }}>
              {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <Keypad value={pin} onChange={setPin} disabled={pending} onDone={(v) => start(async () => { const r = await call(() => disableTerminalAction(mgr, v)); if (r && !r.ok) { setErr(r.error); setPin(''); } })} />
            {err && <p className="err">{err}</p>}
            <div className="actions"><button className="btn" onClick={() => { setAdmin(false); setPin(''); setErr(''); }}>やめる</button></div>
          </div>
        </div>
      )}
      {node}
    </main>
  );
}
