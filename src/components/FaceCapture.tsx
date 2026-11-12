'use client';
import { useEffect, useRef, useState } from 'react';
import { describeFace, fileToCanvas, loadFace, FACE_ERR } from '@/lib/face-client';

/**
 * カメラで顔を撮り、特徴（数値）を返す。写真そのものは保存も送信もしない。
 * ライブのカメラ映像で自動的に撮影し、使えない端末では「写真を撮る」（端末のカメラ）に切り替える。
 */
export function FaceCapture({ onDone, onSkip, skipLabel, busyText = '照合しています…' }: {
  onDone: (d: number[]) => void; onSkip?: () => void; skipLabel?: string; busyText?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<'loading' | 'live' | 'file'>('loading');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(false);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  const finish = (d: number[]) => { if (doneRef.current) return; doneRef.current = true; stop(); onDone(d); };

  useEffect(() => {
    let alive = true;
    (async () => {
      const lib = loadFace().catch(() => null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        setMode('live');
      } catch { if (alive) { setMode('file'); } }
      if (!(await lib) && alive) setErr(FACE_ERR.load);
    })();
    return () => { alive = false; stop(); };
  }, []);

  // ライブ映像：顔を探し、1人だけはっきり写ったら自動で撮る。
  // 1回の判定に時間がかかる端末では間をあけて、画面（「顔なしで打刻」など）が固まらないようにする
  useEffect(() => {
    if (mode !== 'live') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const v = video.current;
      let took = 0;
      if (alive && !doneRef.current && v && v.readyState >= 2) {
        const t0 = performance.now();
        try {
          const r = await describeFace(v);
          if (!alive) return;
          if ('d' in r) { finish(r.d); return; }
          setErr(FACE_ERR[r.err]);
        } catch { if (alive) setErr(FACE_ERR.load); }
        took = performance.now() - t0;
      }
      if (alive && !doneRef.current) timer = setTimeout(loop, Math.max(800, Math.min(took * 2, 4000)));
    };
    timer = setTimeout(loop, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [mode]); // eslint-disable-line

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setErr('');
    try {
      const r = await describeFace(await fileToCanvas(f));
      if ('d' in r) finish(r.d); else setErr(FACE_ERR[r.err]);
    } catch { setErr(FACE_ERR.load); }
    setBusy(false);
  };

  return (
    <div className="facecap">
      {mode !== 'file' && (
        <div className="facecam">
          <video ref={video} playsInline muted aria-label="カメラの映像" />
          <i className="faceguide" aria-hidden />
          <span className="facecam-msg">{mode === 'loading' ? 'カメラを準備しています…' : '顔を枠の中に入れてください（自動で撮影します）'}</span>
        </div>
      )}
      {mode === 'file' && <p className="sub" style={{ margin: 0 }}>{FACE_ERR.camera}</p>}
      <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
        <label className={`btn${mode === 'file' ? ' primary' : ''}`} style={{ cursor: 'pointer' }}>
          {busy ? busyText : '写真を撮る'}
          <input type="file" accept="image/*" capture="user" hidden disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} data-testid="face-file" />
        </label>
        {onSkip && <button type="button" className="btn ghost" onClick={() => { stop(); onSkip(); }}>{skipLabel ?? '写真なしで続ける'}</button>}
      </div>
      {err && <p className="err" role="alert" style={{ textAlign: 'center', margin: 0 }}>{err}</p>}
    </div>
  );
}
