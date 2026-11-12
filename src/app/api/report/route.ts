import { NextResponse } from 'next/server';
import { currentUser, isManager } from '@/lib/auth';
import { reportData, buildReportXlsx } from '@/lib/report';
import { audit } from '@/lib/db';
import { expenseCells, travelCells, type SheetCells } from '@/lib/expenses';
import { monthData } from '@/lib/expenses-data';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || !isManager(u)) return new NextResponse('ログインしてください', { status: 401 });
  const ym = new URL(req.url).searchParams.get('ym') ?? '';
  if (!/^\d{4}-\d{2}$/.test(ym)) return new NextResponse('対象月が正しくありません', { status: 400 });
  const [y, m] = ym.split('-').map(Number);
  const { rows, header } = await reportData(y, m);
  // 経費精算・旅費精算は上塚さん（管理者）が出力したときだけ中身を入れる。店長が出力したときは空の用紙
  const exp = u.role === 'admin' ? await monthData(ym) : null;
  const sheets: SheetCells[] = [expenseCells(exp?.month ?? null, exp?.items ?? [], ym), ...(exp?.trips ?? []).map(travelCells)];
  const bytes = await buildReportXlsx(rows, header, sheets);
  await audit(u.id, 'report_export', { ym, rows: rows.length, expenses: exp?.items.length ?? 0, trips: exp?.trips.length ?? 0 });
  const name = `${String(y).slice(2)}${String(m).padStart(2, '0')}給与報告フォーム.xlsx`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  });
}
