-- 2026/11/11 自分のカレンダーに入れるURL（SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '10s';
-- 自分のカレンダー（Googleカレンダー・iPhoneのカレンダーなど）に、シフトと予定表を自動で入れるためのURL。
-- 本人が設定画面で作る。URLを知っている人はその人の予定を見られるので、作り直し・取り消しができる。
alter table staff add column if not exists cal_token text;
create unique index if not exists staff_cal_token_idx on staff(cal_token) where cal_token is not null;
insert into schema_migrations (name) values ('008_calendar.sql') on conflict do nothing;
select count(*) as "列（1なら完了）" from information_schema.columns where table_name = 'staff' and column_name = 'cal_token';
