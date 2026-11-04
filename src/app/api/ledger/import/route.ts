import { NextResponse } from 'next/server';
import { checkLedgerSecret, cleanGrid, saveSnapshot } from '@/lib/ledger';
import { buildReport } from '@/lib/kobo';
import { jstParts } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 受発注台帳（Google スプレッドシート）の Apps Script から、受発注履歴と取引先一覧を受け取る口。
// ヘッダー x-import-secret に「受発注の報告」画面の合言葉が必要。台帳を書き換えることはしない。
export async function POST(req: Request) {
  if (!(await checkLedgerSecret(req.headers.get('x-import-secret')))) {
    return NextResponse.json({ ok: false, error: '合言葉が違います' }, { status: 401 });
  }
  let body: { orders?: unknown; terms?: unknown; gid?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: '形式が正しくありません' }, { status: 400 }); }
  const orders = cleanGrid(body.orders), terms = cleanGrid(body.terms, 2);
  if (!orders || orders.length < 2 || !terms) return NextResponse.json({ ok: false, error: '受発注履歴が空です' }, { status: 400 });
  const gid = Number.isInteger(body.gid) ? (body.gid as number) : undefined;
  const saved = await saveSnapshot(orders, terms, { gid });
  const r = buildReport(orders, terms, jstParts().date);
  return NextResponse.json({
    ok: true, rows: saved.rows, read: r.read,
    counts: { overdue: r.overdue.length, soon: r.soon.length, late: r.late.length, unbilled: r.unbilled.length, issues: r.issues.length },
  });
}
