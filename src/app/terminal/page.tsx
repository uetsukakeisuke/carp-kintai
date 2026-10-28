import { redirect } from 'next/navigation';
import { currentTerminal } from '@/lib/auth';
import { listStaff, punchesBetween, publishedShifts } from '@/lib/data';
import { summarizeDay } from '@/lib/calc';
import { jstParts, addDays } from '@/lib/time';
import { TerminalBoard } from './TerminalBoard';

export const dynamic = 'force-dynamic';

export default async function TerminalPage() {
  const t = await currentTerminal();
  if (!t) redirect('/login');
  const now = jstParts();
  const staff = await listStaff({ storeId: t.store_id });
  const [punches, shifts] = await Promise.all([punchesBetween(addDays(now.date, -1), now.date), publishedShifts(now.date, now.date, { storeId: t.store_id })]);
  const managers = (await listStaff()).filter((s) => s.role !== 'staff').map((s) => ({ id: s.id, name: s.name }));
  const rows = staff.map((s) => {
    const prev = punches.filter((p) => p.staff_id === s.id && p.work_date === addDays(now.date, -1));
    const openPrev = prev.length && prev[prev.length - 1].kind !== 'out' && now.minute < 300;
    const ps = openPrev ? prev : punches.filter((p) => p.staff_id === s.id && p.work_date === now.date);
    const sh = shifts.find((x) => x.staff_id === s.id);
    const sum = summarizeDay(ps, { now: openPrev ? now.minute + 1440 : now.minute, plan: sh ? { start: sh.start_min, end: sh.end_min } : null });
    return { id: s.id, name: s.name, state: sum.state, plan: sh ? { start: sh.start_min, end: sh.end_min } : null };
  });
  return <TerminalBoard storeName={t.store_name} rows={rows} managers={managers} />;
}
