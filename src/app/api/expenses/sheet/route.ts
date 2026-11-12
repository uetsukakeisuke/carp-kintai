import { NextResponse } from 'next/server';
import { changedMonths, checkExpenseSecret, notePull } from '@/lib/expenses-data';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 経費精算の専用スプレッドシート（Apps Script）が、アプリの経費精算・旅費精算を取りに来る口。
// ヘッダー x-import-secret に「経費精算・旅費精算」画面の合言葉が必要。読むだけ。
//   ?since=<ISO時刻> … その後に変わった月だけ（なければ全部の月）
// 返すもの：月ごとに、作るシート（名前・種類・書き込むセル）。シートが空の月は、その月のシートを消してよい
export async function GET(req: Request) {
  if (!(await checkExpenseSecret(req.headers.get('x-import-secret')))) {
    return NextResponse.json({ ok: false, error: '合言葉が違います' }, { status: 401 });
  }
  const s = new URL(req.url).searchParams.get('since');
  const since = s && !Number.isNaN(Date.parse(s)) ? new Date(s) : null;
  const now = new Date();
  const months = await changedMonths(since);
  await notePull().catch(() => {});
  // 少し前の時刻を返す（書き込み中だった変更を取りこぼさないよう、次回は1分重ねて取りに来る）
  return NextResponse.json({ ok: true, now: new Date(now.getTime() - 60_000).toISOString(), months }, { headers: { 'cache-control': 'no-store' } });
}
