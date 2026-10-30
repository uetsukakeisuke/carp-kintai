import { NextResponse } from 'next/server';
import { currentUser, currentTerminal } from '@/lib/auth';
import { whoIsWorking } from '@/lib/data';

export const dynamic = 'force-dynamic';

// いま出勤している人（ログインしている人・店舗端末なら誰でも見られる。時給などは含めない）
export async function GET() {
  const [u, term] = await Promise.all([currentUser(), currentTerminal()]);
  if (!u && !term) return NextResponse.json({ error: 'ログインしてください' }, { status: 401 });
  const board = await whoIsWorking(term?.store_id ?? null);
  return NextResponse.json(board, { headers: { 'Cache-Control': 'no-store' } });
}
