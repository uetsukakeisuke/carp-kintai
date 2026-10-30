'use client';
import { useState } from 'react';
import { setHopePeriodAction } from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';

/** シフト希望の受付期間（開始日〜締切日）。空欄なら制限なし */
export function DeadlineForm({ storeId, year, month, open, deadline }: { storeId: number; year: number; month: number; open: string | null; deadline: string | null }) {
  const [o, setO] = useState(open ?? '');
  const [d, setD] = useState(deadline ?? '');
  return (
    <div className="hope-period">
      <label><span className="sub">受付開始</span><input type="date" className="in" value={o} onChange={(e) => setO(e.target.value)} aria-label="受付開始日" /></label>
      <span className="sub" aria-hidden>〜</span>
      <label><span className="sub">締切</span><input type="date" className="in" value={d} onChange={(e) => setD(e.target.value)} aria-label="締切日" /></label>
      <ActionButton className="btn primary" action={() => setHopePeriodAction(storeId, year, month, o, d)}>保存</ActionButton>
    </div>
  );
}
