import { NextResponse } from 'next/server';
import { checkExpenseSecret } from '@/lib/expenses-data';
import { reportBundle, buildReportXlsx } from '@/lib/report';
import { xlsxResponse } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Apps Script がドライブに保存する給与報告フォーム（経費精算・旅費精算の中身入り）。合言葉が必要
export async function GET(req: Request) {
  if (!(await checkExpenseSecret(req.headers.get('x-import-secret')))) return NextResponse.json({ ok: false, error: '合言葉が違います' }, { status: 401 });
  const ym = new URL(req.url).searchParams.get('ym') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return NextResponse.json({ ok: false, error: '対象月が正しくありません' }, { status: 400 });
  const b = await reportBundle(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), true);
  const bytes = await buildReportXlsx(b.rows, b.header, b.sheets);
  const res = xlsxResponse(bytes, b.names.file);
  res.headers.set('x-form-hash', b.hash);
  return res;
}
