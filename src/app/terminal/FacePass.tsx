'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { terminalStateAction, terminalPunchAction, checkPunchCodeAction } from '@/app/actions';
import { NEXT, lastKind, type PunchKind } from '@/lib/calc';
import { detectFace, loadFace, faceBackend } from '@/lib/face-client';
import { identify, saveLocalFace, PASS_THRESHOLD } from '@/lib/face-local';
import { Keypad } from '@/components/Keypad';
import { PUNCH_LABEL } from '@/components/PunchLog';
import { call } from '@/lib/call';

/**
 * 顔パス打刻（店舗に置いた会社のiPhone用）。
 * カメラを動かし続け、近づいた人の顔をこの端末に登録された顔と比べて本人を見分ける。
 *  - 今日まだ打刻していない人 → 3秒後に自動で出勤
 *  - 勤務中・休憩中・退勤後の人 → 休憩・退勤・もう一度出勤のボタンを出す
 *  - 登録されていない顔 → 「はじめての方」から、名前と打刻コードで本人が登録
 * 顔の特徴はこの端末の中だけに保存し、サーバーには照合の結果だけを送る。
 */
type Row = { id: number; name: string; punches?: { kind: PunchKind; minute: number }[] };
type Found = { id: number; name: string; punches: { kind: PunchKind; minute: number }[]; dist: number | null; registered: boolean; code: string };
type Phase =
  | { t: 'scan' } | { t: 'loading'; name: string } | { t: 'found'; f: Found; countdown: number | null }
  | { t: 'done'; text: string; bad?: boolean } | { t: 'unknown' }
  | { t: 'reg-name' } | { t: 'reg-code'; row: Row } | { t: 'reg-consent'; row: Row; code: string } | { t: 'reg-capture'; row: Row; code: string };

const MIN_SIZE = 0.22; // 画面の幅に対する顔の幅。これより小さい（遠い）顔は無視する
const AUTO_SEC = 3; // 出勤までの秒数
const SURE = 0.38; // これより近く、2番目の人と十分離れていれば1回の判定で確定（速い）
const GONE_MS = 1200; // 打刻した人がカメラの前から離れたとみなす時間
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hm = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;

export function FacePass({ rows, onPunched, onNameMode }: { rows: Row[]; onPunched: () => void; onNameMode: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<'starting' | 'on' | 'error'>('starting');
  const [ready, setReady] = useState(false);
  const [phase, setPhaseState] = useState<Phase>({ t: 'scan' });
  const phaseRef = useRef<Phase>({ t: 'scan' });
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const [hint, setHint] = useState('');
  const [pin, setPin] = useState('');
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  // 打刻した人は、カメラの前にいる間だけ無視する（離れたらすぐ次の判定ができる）
  const ignore = useRef<{ id: number; until: number; seen: number } | null>(null);
  const streak = useRef<{ id: number; n: number; unknown: number }>({ id: 0, n: 0, unknown: 0 });
  const [speed, setSpeed] = useState<number | null>(null);

  // カメラ・顔の判定の準備、画面を消さない
  useEffect(() => {
    let stream: MediaStream | null = null, lock: { release: () => Promise<void> } | null = null, alive = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}); }
        setCam('on');
      } catch { if (alive) setCam('error'); }
      try { await loadFace(); if (alive) setReady(true); } catch { if (alive) setErr('顔の判定の準備ができませんでした。通信を確認して、画面を再読み込みしてください。'); }
    })();
    const wake = async () => { try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* 対応していない端末 */ } };
    wake();
    const onVis = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', onVis);
    navigator.storage?.persist?.().catch(() => {}); // 登録した顔が消されにくいように
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); lock?.release().catch(() => {}); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  const back = useCallback((coolId?: number, maxSec = 8) => {
    // coolId＝0 は「登録されていない顔」の案内を閉じたとき（しばらく同じ案内を出さない）
    if (coolId !== undefined) ignore.current = { id: coolId, until: Date.now() + maxSec * 1000, seen: Date.now() };
    streak.current = { id: 0, n: 0, unknown: 0 };
    setPin(''); setAgree(false); setErr('');
    setPhase({ t: 'scan' });
  }, []);

  const punch = useCallback(async (f: Found, kind: PunchKind) => {
    setPhase({ t: 'loading', name: f.name });
    const r = await call(() => terminalPunchAction(f.id, f.code, kind, f.registered ? { r: 'registered' } : { r: 'ok', dist: f.dist ?? undefined }));
    setPhase({ t: 'done', text: r.ok ? `${f.name}さん　${r.message}` : r.error, bad: !r.ok });
    if (r.ok) onPunched();
    // 打刻した人は、前に立ち続けていても2秒たてば（離れて戻ればすぐ）また画面を出す
    setTimeout(() => { if (phaseRef.current.t === 'done') back(f.id, 2); }, 1500);
  }, [back, onPunched]);

  // 本人とわかったら、その人の今日の状態を読み、出勤前なら自動で出勤へ
  const found = useCallback(async (row: Row, dist: number | null, registered = false, code = '') => {
    const show = (punches: { kind: PunchKind; minute: number }[]) =>
      setPhase({ t: 'found', f: { id: row.id, name: row.name, punches, dist, registered, code }, countdown: punches.length === 0 ? AUTO_SEC : null });
    if (row.punches) show(row.punches); else setPhase({ t: 'loading', name: row.name });
    const x = await call(() => terminalStateAction(row.id));
    const cur = phaseRef.current;
    if (!x.ok) { if (!row.punches) { setPhase({ t: 'done', text: x.error, bad: true }); setTimeout(() => back(row.id), 3000); } return; }
    // スマホで打刻していたなど、端末の情報が古かったときだけ画面を直す
    const stillMe = (cur.t === 'found' && cur.f.id === row.id) || (cur.t === 'loading' && cur.name === row.name);
    if (stillMe && (!row.punches || x.punches.length !== row.punches.length)) show(x.punches);
  }, [back]);

  // 自動出勤のカウントダウン
  useEffect(() => {
    if (phase.t !== 'found' || phase.countdown === null) return;
    if (phase.countdown <= 0) { punch(phase.f, 'in'); return; }
    const t = setTimeout(() => { const p = phaseRef.current; if (p.t === 'found' && p.countdown !== null) setPhase({ ...p, countdown: p.countdown - 1 }); }, 1000);
    return () => clearTimeout(t);
  }, [phase, punch]);
  // ボタンが出たまま放置されたら戻る
  useEffect(() => {
    if (phase.t !== 'found' || phase.countdown !== null) return;
    const id = phase.f.id;
    const t = setTimeout(() => { if (phaseRef.current.t === 'found') back(id, 10); }, 15000);
    return () => clearTimeout(t);
  }, [phase, back]);
  useEffect(() => {
    if (phase.t !== 'unknown') return;
    const t = setTimeout(() => { if (phaseRef.current.t === 'unknown') back(0, 8); }, 8000);
    return () => clearTimeout(t);
  }, [phase, back]);

  // 顔を探し続ける（前の判定が終わったらすぐ次。何もいないときは少し間をあける）
  useEffect(() => {
    if (!ready || cam !== 'on') return;
    let alive = true;
    (async () => {
      while (alive) {
        const p = phaseRef.current, v = video.current;
        if (!v || v.readyState < 2 || (p.t !== 'scan' && p.t !== 'reg-capture')) { await sleep(200); continue; }
        let gap = 120;
        const t0 = performance.now();
        try {
          const r = await detectFace(v, MIN_SIZE);
          if (!alive) break;
          const cur = phaseRef.current;
          if ('err' in r) {
            streak.current.n = 0;
            setHint(r.err === 'many' ? '1人ずつカメラの前に立ってください' : r.err === 'far' ? 'もう少しカメラに近づいてください' : '');
            if (r.err === 'noface') gap = 250;
          } else {
            setHint('');
            setSpeed(Math.round(performance.now() - t0));
            if (cur.t === 'reg-capture') {
              saveLocalFace(cur.row.id, r.d);
              await found(cur.row, null, true, cur.code);
            } else if (cur.t === 'scan') {
              const m = identify(r.d);
              const now = Date.now(), ig = ignore.current;
              if (ig && now > ig.until) ignore.current = null;
              if (ig && ig.id && now - ig.seen > GONE_MS) ignore.current = null; // 前から離れた
              if (!m || m.dist >= PASS_THRESHOLD) {
                streak.current.n = 0;
                if (ignore.current && !ignore.current.id) { /* 未登録の案内を閉じた直後 */ } else if (++streak.current.unknown >= 3) setPhase({ t: 'unknown' });
              } else if (ignore.current && ignore.current.id === m.staffId) {
                ignore.current.seen = now; // 打刻した人がまだ前にいる
                streak.current = { id: 0, n: 0, unknown: 0 };
              } else {
                streak.current.unknown = 0;
                const st = streak.current;
                if (st.id === m.staffId) st.n++; else { st.id = m.staffId; st.n = 1; }
                const sure = m.dist < SURE && m.second - m.dist > 0.08;
                if (sure || st.n >= 2) {
                  const row = rows.find((x) => x.id === m.staffId);
                  if (row) { streak.current = { id: 0, n: 0, unknown: 0 }; await found(row, m.dist); }
                }
              }
            }
          }
        } catch { gap = 500; }
        await sleep(gap);
      }
    })();
    return () => { alive = false; };
  }, [ready, cam, rows, found]);

  const p = phase;
  const greet = () => { const h = new Date().getHours(); return h < 11 ? 'おはようございます' : h < 17 ? 'こんにちは' : 'おつかれさまです'; };
  return (
    <div className="fp">
      <div className={`fp-cam${p.t === 'found' || p.t === 'done' || p.t === 'loading' ? ' dim' : ''}`}>
        <video ref={video} playsInline muted aria-label="カメラの映像" />
        <i className="faceguide" aria-hidden />
        <div className="fp-status" aria-live="polite">
          {cam === 'error' ? 'カメラを使えません。iPhoneの設定でこのサイトのカメラを許可してください。'
            : cam === 'starting' || !ready ? '顔パスを準備しています…'
            : p.t === 'reg-capture' ? `${p.row.name}さん、カメラに顔を向けてください（自動で登録します）`
            : hint || 'カメラに顔を近づけてください'}
          {cam === 'on' && ready && p.t === 'scan' && <small className="fp-mask">マスクの方は、一瞬マスクを下げてカメラを見てください</small>}
          {speed !== null && <small className="fp-speed">判定 {(speed / 1000).toFixed(2)}秒・{faceBackend === 'webgl' ? 'GPU' : faceBackend.toUpperCase()}</small>}
        </div>
        {(p.t === 'found' || p.t === 'loading' || p.t === 'done') && (
          <div className={`fp-card${p.t === 'done' && p.bad ? ' bad' : ''}`} role="dialog" aria-live="assertive">
            {p.t === 'loading' && <><b className="fp-name">{p.name}さん</b><span className="sub">確認しています…</span></>}
            {p.t === 'done' && <b className="fp-done">{p.bad ? '⚠ ' : '✓ '}{p.text}</b>}
            {p.t === 'found' && (() => {
              const lk = lastKind(p.f.punches);
              const last = p.f.punches[p.f.punches.length - 1];
              return (
                <>
                  <b className="fp-name">{p.f.name}さん</b>
                  <span className="sub">{greet()}{p.f.registered ? '（この端末に顔を登録しました）' : ''}</span>
                  {p.countdown !== null ? (
                    <>
                      <div className="fp-count"><b className="num">{p.countdown}</b>秒後に出勤します</div>
                      <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
                        <button className="btn primary big" onClick={() => punch(p.f, 'in')}>すぐ出勤</button>
                        <button className="btn big" onClick={() => back(p.f.id, 15)}>やめる（別の人です）</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="sub">{last ? `最後の打刻：${PUNCH_LABEL[last.kind]} ${hm(last.minute)}` : ''}</span>
                      <div className="fp-btns">
                        {NEXT[lk].map((k) => (
                          <button key={k} className={`pbtn p-${k}`} onClick={() => punch(p.f, k)}>{k === 'in' && lk === 'out' ? 'もう一度出勤' : PUNCH_LABEL[k]}</button>
                        ))}
                      </div>
                      <button className="btn" onClick={() => back(p.f.id, 15)}>閉じる（別の人です）</button>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>

      {p.t === 'unknown' && (
        <div className="fp-panel">
          <b>この端末に登録されていない顔です</b>
          <p className="sub" style={{ margin: '4px 0 8px' }}>はじめての方は顔を登録してください（登録はマスクを外して）。登録済みなのに見分けられないときは、マスクや帽子を外してもう一度立つか、名前を選んで打刻できます。</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => setPhase({ t: 'reg-name' })}>顔を登録する</button>
            <button className="btn" onClick={onNameMode}>名前を選んで打刻</button>
            <button className="btn ghost" onClick={() => back(0, 8)}>戻る</button>
          </div>
        </div>
      )}
      {p.t === 'reg-name' && (
        <div className="fp-panel">
          <b>顔の登録：自分の名前を押してください</b>
          <div className="termgrid" style={{ marginTop: 8 }}>
            {rows.map((r) => <button key={r.id} className="tcard" onClick={() => { setPin(''); setErr(''); setPhase({ t: 'reg-code', row: r }); }}><b>{r.name}</b></button>)}
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => back()}>やめる</button></div>
        </div>
      )}
      {p.t === 'reg-code' && (
        <div className="fp-panel narrowpanel">
          <b>{p.row.name}さん：打刻コード（4桁）を入れてください</b>
          <Keypad value={pin} onChange={setPin} onDone={async (v) => {
            const r = await call(() => checkPunchCodeAction(v));
            if (!r.ok) { setErr(r.error); setPin(''); return; }
            setErr(''); setAgree(false); setPhase({ t: 'reg-consent', row: p.row, code: v });
          }} />
          {err && <p className="err" style={{ textAlign: 'center' }}>{err}</p>}
          <div className="row"><button className="btn ghost" onClick={() => back()}>やめる</button></div>
        </div>
      )}
      {p.t === 'reg-consent' && (
        <div className="fp-panel narrowpanel">
          <div className="consent">
            <b>{p.row.name}さんの顔をこの端末に登録します</b>
            <ul>
              <li>目的：勤怠打刻の本人確認（顔パス）だけに使います</li>
              <li>写真は保存しません。顔の特徴を表す数値だけを、<b>この端末の中に</b>保存します（会社のサーバーには送りません）</li>
              <li>登録すると、次からはカメラの前に立つだけで本人と判定されます</li>
              <li>マスクを外して、正面からカメラを見てください</li>
            </ul>
            <label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> 内容を理解し、同意します</label>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" disabled={!agree} onClick={() => setPhase({ t: 'reg-capture', row: p.row, code: p.code })}>カメラで顔を登録</button>
            <button className="btn ghost" onClick={() => back()}>やめる</button>
          </div>
        </div>
      )}
      {p.t === 'reg-capture' && (
        <div className="row" style={{ justifyContent: 'center' }}><button className="btn ghost" onClick={() => back()}>やめる</button></div>
      )}

      {(p.t === 'scan' || p.t === 'unknown') && (
        <div className="row fp-foot">
          <button className="btn" onClick={() => setPhase({ t: 'reg-name' })}>はじめての方（顔の登録）</button>
          <button className="btn" onClick={onNameMode}>名前を選んで打刻</button>
        </div>
      )}
      {err && p.t === 'scan' && <p className="err" style={{ textAlign: 'center' }}>{err}</p>}
    </div>
  );
}
