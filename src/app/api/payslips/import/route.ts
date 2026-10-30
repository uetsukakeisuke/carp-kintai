import { NextResponse } from 'next/server';
import { checkImportSecret, importPayslipFiles } from '@/lib/payslips';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Gmail（Google Apps Script）から給与明細PDFを受け取る口。
// ヘッダー x-import-secret に「給与明細」画面の合言葉が必要。
export async function POST(req: Request) {
  if (!(await checkImportSecret(req.headers.get('x-import-secret')))) {
    return NextResponse.json({ ok: false, error: '合言葉が違います' }, { status: 401 });
  }
  let body: { messageId?: string; subject?: string; date?: string; files?: { name?: string; base64?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: '形式が正しくありません' }, { status: 400 }); }
  const files = (body.files ?? [])
    .filter((f) => typeof f.base64 === 'string' && /\.pdf$/i.test(f.name ?? ''))
    .slice(0, 5)
    .map((f) => ({ name: String(f.name).slice(0, 200), bytes: new Uint8Array(Buffer.from(f.base64!, 'base64')) }));
  if (!files.length) return NextResponse.json({ ok: false, error: 'PDFがありません' }, { status: 400 });
  if (files.some((f) => f.bytes.length > 4_000_000)) return NextResponse.json({ ok: false, error: 'ファイルが大きすぎます' }, { status: 413 });
  const r = await importPayslipFiles(files, {
    source: 'gmail', messageId: body.messageId?.slice(0, 100) ?? null, subject: body.subject?.slice(0, 300) ?? null,
    receivedAt: body.date && !isNaN(Date.parse(body.date)) ? body.date : null,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
