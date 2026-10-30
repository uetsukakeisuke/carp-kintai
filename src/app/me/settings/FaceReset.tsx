'use client';
import { useEffect, useState } from 'react';
import { getLocalFace, clearLocalFace } from '@/lib/face-local';

/** この端末に登録した自分の顔を消す */
export function FaceReset({ staffId }: { staffId: number }) {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => { setAt(getLocalFace(staffId)?.at ?? null); }, [staffId]);
  return (
    <div className="card row" style={{ justifyContent: 'space-between', minHeight: 64 }}>
      <span><b>顔の登録（この端末）</b><br /><span className="sub">{at ? `${new Date(at).toLocaleDateString('ja-JP')} に登録。次の打刻で照合します。` : 'まだ登録していません。次の打刻で登録します。'}</span></span>
      {at && <button className="btn" type="button" onClick={() => { clearLocalFace(staffId); setAt(null); }}>消す</button>}
    </div>
  );
}
