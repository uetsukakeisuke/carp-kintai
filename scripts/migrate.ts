// マイグレーションを順に適用する： npm run db:migrate
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL を設定してください'); process.exit(1); }
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : 'require', onnotice: () => {} });

(async () => {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const dir = join(process.cwd(), 'db/migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    console.log('適用しました:', f);
  }
  console.log('マイグレーション完了');
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
