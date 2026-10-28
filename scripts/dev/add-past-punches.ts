import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
(async () => {
  const y = new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  const [sato] = await sql`select id, store_id from staff where name = '佐藤 美咲'`;
  const [ito] = await sql`select id, store_id from staff where name = '伊藤 さくら'`;
  const ins = (s: any, kind: string, m: number) => sql`insert into punches (staff_id, store_id, work_date, kind, minute, via) values (${s.id}, ${s.store_id}, ${y}, ${kind}, ${m}, 'mobile')`;
  await ins(sato, 'in', 600); await ins(sato, 'out', 930);                      // 10:00-15:30 → 5h30
  await ins(ito, 'in', 1200); await ins(ito, 'break_start', 1380); await ins(ito, 'break_end', 1410); await ins(ito, 'out', 1530); // 20:00-25:30、23:00-23:30休憩
  console.log('past punches', y);
  await sql.end();
})();
