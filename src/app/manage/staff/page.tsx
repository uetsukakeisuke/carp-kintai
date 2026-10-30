import { requireManager } from '@/lib/auth';
import { listStaff, listStores, ratesFor, minWages } from '@/lib/data';
import { wageAt, minWageAt } from '@/lib/calc';
import { jstParts } from '@/lib/time';
import { StaffManager } from './StaffManager';
import { faceRegistrations } from '@/lib/face';

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const u = await requireManager();
  const sp = await searchParams;
  const [staff, stores, mw, faces] = await Promise.all([listStaff({ includeInactive: sp.all === '1' }), listStores(true), minWages(), faceRegistrations()]);
  const rates = await ratesFor(staff.map((s) => s.id));
  const today = jstParts().date;
  const next = mw.find((m) => m.effective_from > today) ?? null;
  return (
    <StaffManager
      isAdmin={u.role === 'admin'}
      showAll={sp.all === '1'}
      today={today}
      minWage={{ now: minWageAt(mw, today), next }}
      stores={stores.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }))}
      staff={staff.map((s) => {
        const r = rates.get(s.id) ?? [];
        const cur = wageAt(r, today);
        const fut = r.filter((x) => x.effective_from > today);
        const atNext = next ? wageAt(r, next.effective_from) : cur;
        return {
          id: s.id, name: s.name, kana: s.kana ?? '', role: s.role, employment: s.employment, payType: s.pay_type, storeId: s.store_id,
          transport: s.transport_per_day, commuteMeans: s.commute_means ?? '', active: s.active, mustChange: s.pin_must_change,
          locked: !!s.locked_until && s.locked_until > new Date(), wage: cur, future: fut, history: r,
          belowNow: s.pay_type === 'hourly' && cur !== null && cur < minWageAt(mw, today),
          belowNext: s.pay_type === 'hourly' && !!next && atNext !== null && atNext < next.hourly,
          faceAt: (() => { const f = faces.find((x) => x.staff_id === s.id); return f ? jstParts(f.created_at).date.replace(/-/g, '/') : null; })(),
        };
      })}
    />
  );
}
