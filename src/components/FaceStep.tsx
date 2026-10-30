'use client';
import { useState } from 'react';
import { FaceCapture } from './FaceCapture';
import { getLocalFace, saveLocalFace, faceDistance, FACE_THRESHOLD, type FaceOutcome } from '@/lib/face-local';

/**
 * 打刻前の顔の確認（端末ごとに独立）。
 * この端末にまだ顔がなければ、本人がその場で登録する。登録済みなら照合する。
 */
export function FaceStep({ staffId, onResult }: { staffId: number; onResult: (r: { r: FaceOutcome; dist?: number }) => void }) {
  const has = !!getLocalFace(staffId);
  const [mode, setMode] = useState<'check' | 'register' | 'reregister'>(has ? 'check' : 'register');
  const [agree, setAgree] = useState(false);
  const [ready, setReady] = useState(has);

  const done = (d: number[]) => {
    if (mode === 'check') {
      const f = getLocalFace(staffId);
      if (!f) return onResult({ r: 'skipped' });
      const dist = faceDistance(d, f.d);
      return onResult({ r: dist < FACE_THRESHOLD ? 'ok' : 'mismatch', dist });
    }
    saveLocalFace(staffId, d);
    onResult({ r: mode === 'register' ? 'registered' : 'reregistered' });
  };

  if (!ready) {
    return (
      <div className="consent">
        <b>{mode === 'reregister' ? 'この端末の顔を登録し直します' : 'この端末で、はじめに自分の顔を登録します'}</b>
        <ul>
          <li>目的：勤怠打刻の本人確認（代わりに打刻することの防止）だけに使います</li>
          <li>写真は保存しません。顔の特徴を表す数値だけを、<b>この端末の中に</b>保存します（会社のサーバーには送りません）</li>
          <li>次からは、打刻のたびにこの顔と照合します{mode === 'reregister' ? '。登録し直したことは店長に伝わります' : ''}</li>
        </ul>
        <label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> 内容を理解し、同意します</label>
        <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 6 }}>
          <button type="button" className="btn primary" disabled={!agree} onClick={() => setReady(true)}>顔を登録して打刻</button>
          <button type="button" className="btn ghost" onClick={() => onResult({ r: 'skipped' })}>顔なしで打刻（店長確認）</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <p className="meta" style={{ margin: 0 }}>{mode === 'check' ? '本人確認のため、顔をカメラに向けてください。写真は保存されません。' : '登録する顔を写してください（本人だけが写るように）。'}</p>
      <FaceCapture key={mode} onDone={done} onSkip={() => onResult({ r: 'skipped' })} skipLabel="顔なしで打刻（店長確認）" />
      {mode === 'check' && (
        <p className="sub" style={{ textAlign: 'center', margin: 0 }}>
          うまく照合できないときは <button type="button" className="linkbtn" onClick={() => { setMode('reregister'); setAgree(false); setReady(false); }}>この端末の顔を登録し直す</button>
        </p>
      )}
    </>
  );
}
