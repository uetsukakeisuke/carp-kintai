import { NextResponse } from 'next/server';
import { checkExpenseSecret, saveFormSync } from '@/lib/expenses-data';
import { reportBundle } from '@/lib/report';
import { jstParts } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 毎月の給与報告フォーム（YYMM給与報告フォーム.xlsx）をドライブに保存する Apps Script のための口。
// ヘッダー x-import-secret に「経費精算・旅費精算」画面の合言葉が必要。
//   GET  … いま保存する月（働いた月）と、ファイル名・フォルダ名・中身の目印（hash）
//   POST … 保存した結果（画面に出す）
// 保存する月：今月分はいつも。先月分は支給日まで（締めのあとに経費や打刻の修正が入るため）
const json = (v: unknown, status = 200) => NextResponse.json(v, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(req: Request) {
  if (!(await checkExpenseSecret(req.headers.get('x-import-secret')))) return json({ ok: false, error: '合言葉が違います' }, 401);
  const today = jstParts().date;
  const cur = today.slice(0, 7);
  const [y, m] = cur.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const first = await reportBundle(y, m, true);
  const months = Number(today.slice(8, 10)) <= first.header.payD ? [prev, cur] : [cur];
  const forms = [];
  for (const ym of months) {
    const b = ym === cur ? first : await reportBundle(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), true);
    forms.push({ ym, file: b.names.file, folder: b.names.folder, prefix: b.names.yymm, hash: b.hash });
  }
  return json({ ok: true, forms });
}

export async function POST(req: Request) {
  if (!(await checkExpenseSecret(req.headers.get('x-import-secret')))) return json({ ok: false, error: '合言葉が違います' }, 401);
  let body: { results?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, error: '形式が正しくありません' }, 400); }
  await saveFormSync(body.results);
  return json({ ok: true });
}
