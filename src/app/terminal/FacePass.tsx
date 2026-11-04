'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { terminalStateAction, terminalPunchAction, checkPunchCodeAction } from '@/app/actions';
import { NEXT, lastKind, type PunchKind } from '@/lib/calc';
import { detectFace, loadFace } from '@/lib/face-client';
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
type Row = { id: number; name: string };
type Found = { id: number; name: string; punches: { kind: PunchKind; minute: number }[]; dist: number | null; registered: boolean; code: string };
type Phase =
  | { t: 'scan' } | { t: 'loading'; name: string } | { t: 'found'; f: Found; countdown: number | null }
  | { t: 'done'; text: string; bad?: boolean } | { t: 'unknown' }
  | { t: 'reg-name' } | { t: 'reg-code'; row: Row } | { t: 'reg-consent'; row: Row; code: string } | { t: 'reg-capture'; row: Row; code: string };

const MIN_SIZE = 0.22; // 画面の幅に対する顔の幅。これより小さい（遠い）顔は無視する
const AUTO_SEC = 3; // 出勤までの秒数
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
  const cooldown = useRef(new Map<number, number>()); // 打刻した人をしばらく無視する
  const streak = useRef<{ id: number; n: number; unknown: number }>({ id: 0, n: 0, unknown: 0 });

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

  const back = useCallback((coolId?: number, sec = 8) => {
    if (coolId) cooldown.current.set(coolId, Date.now() + sec * 1000);
    streak.current = { id: 0, n: 0, unknown: 0 };
    setPin(''); setAgree(false); setErr('');
    setPhase({ t: 'scan' });
  }, []);

  const punch = useCallback(async (f: Found, kind: PunchKind) => {
    setPhase({ t: 'loading', name: f.name });
    const r = await call(() => terminalPunchAction(f.id, f.code, kind, f.registered ? { r: 'registered' } : { r: 'ok', dist: f.dist ?? undefined }));
    setPhase({ t: 'done', text: r.ok ? `${f.name}さん　${r.message}` : r.error, bad: !r.ok });
    if (r.ok) onPunched();
    setTimeout(() => { if (phaseRef.current.t === 'done') back(f.id, 60); }, 3500);
  }, [back, onPunched]);

  // 本人とわかったら、その人の今日の状態を読み、出勤前なら自動で出勤へ
  const found = useCallback(async (row: Row, dist: number | null, registered = false, code = '') => {
    setPhase({ t: 'loading', name: row.name });
    const x = await call(() => terminalStateAction(row.id));
    if (!x.ok) { setPhase({ t: 'done', text: x.error, bad: true }); setTimeout(() => back(row.id), 3000); return; }
    const f: Found = { id: row.id, name: row.name, punches: x.punches, dist, registered, code };
    setPhase({ t: 'found', f, countdown: x.punches.length === 0 ? AUTO_SEC : null });
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
    const t = setTimeout(() => { if (phaseRef.current.t === 'unknown') back(); }, 8000);
    return () => clearTimeout(t);
  }, [phase, back]);

  // 顔を探し続ける
  useEffect(() => {
    if (!ready || cam !== 'on') return;
    let alive = true, running = false;
    const tick = async () => {
      const p = phaseRef.current, v = video.current;
      if (!alive || running || !v || v.readyState < 2 || (p.t !== 'scan' && p.t !== 'reg-capture')) return;
      running = true;
      try {
        const r = await detectFace(v);
        const cur = phaseRef.current;
        if (!alive) return;
        if ('err' in r) { setHint(r.err === 'many' ? '1人ずつカメラの前に立ってください' : ''); streak.current.n = 0; return; }
        if (r.size < MIN_SIZE) { setHint('もう少しカメラに近づいてください'); streak.current.n = 0; return; }
        setHint('');
        if (cur.t === 'reg-capture') {
          saveLocalFace(cur.row.id, r.d);
          await found(cur.row, null, true, cur.code);
          return;
        }
        const m = identify(r.d);
        if (!m || m.dist >= PASS_THRESHOLD) {
          streak.current.n = 0;
          if (++streak.current.unknown >= 3) setPhase({ t: 'unknown' });
          return;
        }
        streak.current.unknown = 0;
        if ((cooldown.current.get(m.staffId) ?? 0) > Date.now()) return;
        const s = streak.current;
        if (s.id === m.staffId) s.n++; else { s.id = m.staffId; s.n = 1; }
        if (s.n >= 2) { // 2回続けて同じ人と判定したら本人とみなす
          const row = rows.find((x) => x.id === m.staffId);
          if (row) await found(row, m.dist);
        }
      } catch { /* 次の回にもう一度 */ } finally { running = false; }
    };
    const t = setInterval(tick, 600);
    return () => { alive = false; clearInterval(t); };
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
            <button className="btn ghost" onClick={() => back()}>戻る</button>
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
