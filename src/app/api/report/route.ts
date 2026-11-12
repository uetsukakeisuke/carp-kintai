import { NextResponse } from 'next/server';
import { currentUser, isManager } from '@/lib/auth';
import { reportBundle, buildReportXlsx } from '@/lib/report';
import { audit } from '@/lib/db';
import { xlsxResponse } from '@/lib/xlsx';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || !isManager(u)) return new NextResponse('ログインしてください', { status: 401 });
  const ym = new URL(req.url).searchParams.get('ym') ?? '';
  if (!/^\d{4}-\d{2}$/.test(ym)) return new NextResponse('対象月が正しくありません', { status: 400 });
  const [y, m] = ym.split('-').map(Number);
  // 経費精算・旅費精算は上塚さん（管理者）が出力したときだけ中身を入れる。店長が出力したときは空の用紙
  const b = await reportBundle(y, m, u.role === 'admin');
  const bytes = await buildReportXlsx(b.rows, b.header, b.sheets);
  await audit(u.id, 'report_export', { ym, rows: b.rows.length });
  return xlsxResponse(bytes, b.names.file);
}
