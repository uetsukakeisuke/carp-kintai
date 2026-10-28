// 初期データ： npm run db:seed        （店舗と管理者アカウント）
//              npm run db:seed -- --demo（動作確認用の架空スタッフとシフトも入れる）
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL を設定してください'); process.exit(1); }
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : 'require', onnotice: () => {} });
const demo = process.argv.includes('--demo');

const STORES = [
  { name: 'お酒の水族館', sort: 1, weekday: 42000, friday: 50000, weekend: 56000 },
  { name: '京都工房', sort: 2, weekday: 30000, friday: 36000, weekend: 40000 },
];

(async () => {
  for (const s of STORES) {
    await sql`insert into stores (name, sort, budget_weekday, budget_friday, budget_weekend) values (${s.name}, ${s.sort}, ${s.weekday}, ${s.friday}, ${s.weekend})
      on conflict (name) do nothing`;
  }
  const pin = await bcrypt.hash('1111', 10);
  const [admin] = await sql<{ id: number }[]>`select id from staff where role = 'admin' limit 1`;
  if (!admin) {
    const [a] = await sql<{ id: number }[]>`insert into staff (name, kana, role, employment, pay_type, pin_hash, sort)
      values ('上塚 佳祐', 'うえつか けいすけ', 'admin', '役員', 'monthly', ${pin}, 0) returning id`;
    console.log('管理者アカウントを作成しました（上塚 佳祐 / 初期パスワード 1111）id=', a.id);
  }
  if (demo) {
    const stores = await sql<{ id: number; name: string }[]>`select id, name from stores order by sort`;
    const names = [
      ['佐藤 美咲', 'さとう みさき', 1250, 300], ['鈴木 健太', 'すずき けんた', 1180, 0], ['高橋 優花', 'たかはし ゆうか', 1180, 200],
      ['田中 翔', 'たなか しょう', 1500, 500], ['伊藤 さくら', 'いとう さくら', 1200, 400], ['渡辺 大輝', 'わたなべ だいき', 1180, 0],
      ['山本 葵', 'やまもと あおい', 1180, 250], ['中村 蓮', 'なかむら れん', 1180, 350],
    ] as const;
    for (const [i, [name, kana, wage, trans]] of names.entries()) {
      const store = stores[i < 6 ? 0 : 1];
      const [ex] = await sql`select id from staff where name = ${name}`;
      if (ex) continue;
      const [s] = await sql<{ id: number }[]>`insert into staff (name, kana, role, store_id, transport_per_day, commute_means, pin_hash, sort)
        values (${name}, ${kana}, ${i === 3 ? 'manager' : 'staff'}, ${store.id}, ${trans}, ${trans ? '電車' : null}, ${pin}, ${i + 1}) returning id`;
      await sql`insert into wage_rates (staff_id, effective_from, hourly) values (${s.id}, '2026-01-01', ${wage})`;
    }
    console.log('デモ用の架空スタッフを登録しました（全員 初期パスワード 1111）');
  }
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
