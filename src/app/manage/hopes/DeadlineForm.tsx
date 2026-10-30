'use client';
import { useState } from 'react';
import { setHopeDeadlineAction } from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';

export function DeadlineForm({ storeId, year, month, current }: { storeId: number; year: number; month: number; current: string | null }) {
  const [v, setV] = useState(current ?? '');
  return (
    <span className="row" style={{ marginLeft: 'auto', flexWrap: 'nowrap' }}>
      <label htmlFor="dl" className="sub">提出締切</label>
      <input id="dl" type="date" className="in" value={v} onChange={(e) => setV(e.target.value)} />
      <ActionButton action={() => setHopeDeadlineAction(storeId, year, month, v)}>保存</ActionButton>
    </span>
  );
}
