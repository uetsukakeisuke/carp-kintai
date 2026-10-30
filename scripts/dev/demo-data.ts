// 開発・確認用の架空データ（シフト希望、シフト、公開、過去2週間の打刻、修正申請）を入れる
//   DATABASE_URL=... npx tsx scripts/dev/demo-data.ts
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} });
const pad = (n: number) => String(n).padStart(2, '0');
const jst = () => new Date(Date.now() + 9 * 3600e3);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

(async () => {
  const staff = await sql<{ id: number; name: string; store_id: number | null; role: string }[]>`select id, name, store_id, role from staff where store_id is not null order by id`;
  const today = jst(); today.setUTCHours(0, 0, 0, 0);
  const patterns = [[600, 1020], [540, 900], [1020, 1380], [660, 1200], [1080, 1440], [720, 1260]];
  const months: [number, number][] = [];
  for (const off of [0, 1]) { const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + off, 1)); months.push([d.getUTCFullYear(), d.getUTCMonth() + 1]); }
  for (const [y, m] of months) {
    const nd = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (const [i, s] of staff.entries()) {
      const [ps, pe] = patterns[i % patterns.length];
      const days = [1, 2, 3, 4, 5, 6, 0].filter((_, j) => (i + j) % 3 !== 0);
      for (let d = 1; d <= nd; d++) {
        const k = `${y}-${pad(m)}-${pad(d)}`, w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        if (!days.includes(w) || rnd() < 0.15) continue;
        await sql`insert into shift_hopes (staff_id, work_date, start_min, end_min) values (${s.id}, ${k}, ${ps}, ${pe}) on conflict do nothing`;
        if (rnd() < 0.8) {
          const e = rnd() < 0.1 ? pe + 60 : pe;
          await sql`insert into shifts (staff_id, work_date, store_id, start_min, end_min) values (${s.id}, ${k}, ${s.store_id}, ${ps}, ${e}) on conflict do nothing`;
        }
      }
      if (i !== 1) await sql`insert into hope_submissions (staff_id, year, month) values (${s.id}, ${y}, ${m}) on conflict do nothing`;
    }
  }
  // 今月は公開済み、来月は下書き
  const [y0, m0] = months[0];
  const stores = await sql<{ id: number }[]>`select id from stores`;
  for (const st of stores) {
    await sql`insert into shift_periods (store_id, year, month, status, published_at) values (${st.id}, ${y0}, ${m0}, 'published', now()) on conflict (store_id, year, month) do update set status = 'published'`;
    await sql`insert into published_shifts (staff_id, work_date, store_id, start_min, end_min)
      select staff_id, work_date, store_id, start_min, end_min from shifts where store_id = ${st.id} and work_date between ${`${y0}-${pad(m0)}-01`} and ${`${y0}-${pad(m0)}-31`} on conflict do nothing`;
    const [y1, m1] = months[1];
    await sql`insert into shift_periods (store_id, year, month, hope_deadline) values (${st.id}, ${y1}, ${m1}, ${`${y0}-${pad(m0)}-20`}) on conflict do nothing`;
  }
  // 過去2週間の打刻（予定どおり＋少しのずれ）。1件は退勤漏れ、1件は修正申請。
  const todayKey = ymd(today);
  const past = await sql<{ staff_id: number; work_date: string; start_min: number; end_min: number; store_id: number }[]>`
    select staff_id, work_date::text, start_min, end_min, store_id from published_shifts where work_date < ${todayKey} and work_date >= ${ymd(new Date(today.getTime() - 14 * 86400e3))} order by work_date`;
  let n = 0;
  for (const p of past) {
    const tin = p.start_min - Math.floor(rnd() * 8) + (rnd() < 0.1 ? 12 : 0);
    const tout = p.end_min + Math.floor(rnd() * 15) - 3;
    await sql`insert into punches (staff_id, store_id, work_date, kind, minute, via) values (${p.staff_id}, ${p.store_id}, ${p.work_date}, 'in', ${tin}, 'terminal')`;
    if (p.end_min - p.start_min > 360) {
      const bs = p.start_min + Math.floor((p.end_min - p.start_min) / 2);
      await sql`insert into punches (staff_id, store_id, work_date, kind, minute, via) values (${p.staff_id}, ${p.store_id}, ${p.work_date}, 'break_start', ${bs}, 'terminal'), (${p.staff_id}, ${p.store_id}, ${p.work_date}, 'break_end', ${bs + 45}, 'terminal')`;
    }
    if (n++ === 3) {
      await sql`insert into correction_requests (staff_id, work_date, kind, minute, reason) values (${p.staff_id}, ${p.work_date}, 'out', ${p.end_min + 10}, '閉店作業のあと退勤を押し忘れました')`;
      continue;
    }
    await sql`insert into punches (staff_id, store_id, work_date, kind, minute, via) values (${p.staff_id}, ${p.store_id}, ${p.work_date}, 'out', ${tout}, 'mobile')`;
  }
  console.log('demo data: hopes/shifts for', months.map((x) => x.join('-')).join(', '), '/ past days', past.length);
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
