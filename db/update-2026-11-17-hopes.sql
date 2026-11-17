-- 2026/11/17 シフト希望を授業のコマで選べるように（SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '10s';
-- 希望を「1限・2限…」のように時間帯に分けて持てるようにする。今ある希望はそのまま（null＝これまでどおり）。
alter table shift_hopes add column if not exists parts jsonb;
insert into schema_migrations (name) values ('014_hope_parts.sql') on conflict do nothing;
select count(*) as "列（1なら完了）" from information_schema.columns
where table_name = 'shift_hopes' and column_name = 'parts';
