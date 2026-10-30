'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadPayslipsAction, rotateImportSecretAction } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { ActionButton } from '@/components/ActionButton';
import { call } from '@/lib/call';

export function UploadForm() {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [toast, node] = useToast();
  const router = useRouter();
  const [names, setNames] = useState('');
  return (
    <div className="row" style={{ gap: 8 }}>
      <label className="btn" style={{ cursor: 'pointer' }}>
        PDFを選ぶ
        <input ref={ref} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => setNames([...(e.target.files ?? [])].map((f) => f.name).join('、'))} />
      </label>
      <span className="sub" style={{ flex: '1 1 160px' }}>{names || '「給与支給明細書」のPDF'}</span>
      <button className="btn primary" disabled={pending || !names} onClick={() => start(async () => {
        const fd = new FormData();
        for (const f of ref.current?.files ?? []) fd.append('files', f);
        const r = await call(() => uploadPayslipsAction(fd));
        toast(r.ok ? r.message ?? '取り込みました' : r.error);
        if (r.ok) { setNames(''); if (ref.current) ref.current.value = ''; router.refresh(); }
      })}>{pending ? '読み取り中…' : '取り込む'}</button>
      {node}
    </div>
  );
}

export function ScriptBox({ code }: { code: string }) {
  const [toast, node] = useToast();
  return (
    <div className="codebox">
      <pre>{code}</pre>
      <button className="btn" type="button" onClick={() => { navigator.clipboard?.writeText(code).then(() => toast('コピーしました'), () => toast('コピーできませんでした。選択してコピーしてください')); }}>コピー</button>
      {node}
    </div>
  );
}

export function RotateSecret() {
  return <ActionButton className="btn ghost" confirmText="合言葉を作り直すと、今のスクリプトは使えなくなります。作り直しますか？" action={rotateImportSecretAction}>合言葉を作り直す</ActionButton>;
}
