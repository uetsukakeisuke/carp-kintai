'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { registerFaceAction, deleteFaceAction } from '@/app/actions';
import { FaceCapture } from '@/components/FaceCapture';
import { call } from '@/lib/call';

/** 顔の登録（管理者が本人の前で行う。写真は保存せず、顔の特徴の数値だけを保存） */
export function FaceRegister({ staff, registeredAt, onClose, onDone }: { staff: { id: number; name: string }; registeredAt: string | null; onClose: () => void; onDone: (msg: string) => void }) {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const save = (d: number[]) => start(async () => {
    const r = await call(() => registerFaceAction(staff.id, d, consent));
    if (!r.ok) { setErr(r.error); setCapturing(false); return; }
    onDone(r.message ?? '登録しました'); onClose(); router.refresh();
  });
  const del = () => start(async () => {
    const r = await call(() => deleteFaceAction(staff.id));
    if (!r.ok) { setErr(r.error); return; }
    onDone(r.message ?? '消しました'); onClose(); router.refresh();
  });
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="frT">
        <h3 id="frT">{staff.name} の顔を登録</h3>
        <p className="meta">{registeredAt ? `${registeredAt} に登録済みです。登録し直すと置き換わります。` : '打刻のときに写した顔が、ここで登録した顔と同じ人かを判定します。'}</p>
        <div className="consent">
          <b>本人への説明</b>
          <ul>
            <li>目的：勤怠打刻の本人確認（代わりに打刻することの防止）だけに使います</li>
            <li>写真は保存しません。顔の特徴を表す数値（128個）だけを保存します</li>
            <li>退職したときや本人が希望したときは、すぐに消します。同意しない場合は顔なしで打刻できます</li>
          </ul>
          <label><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> 本人に説明し、同意を得ました</label>
        </div>
        <div style={{ marginTop: 10 }}>
          {pending ? <p className="sub" style={{ textAlign: 'center' }}>保存しています…</p>
            : capturing ? <FaceCapture onDone={save} busyText="読み取っています…" />
            : <button type="button" className="btn primary" style={{ width: '100%' }} disabled={!consent} onClick={() => { setErr(''); setCapturing(true); }}>カメラで顔を写す</button>}
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="actions">
          {registeredAt && <button type="button" className="btn danger left" disabled={pending} onClick={del}>登録を消す</button>}
          <button type="button" className="btn" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
