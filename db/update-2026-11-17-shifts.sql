-- 2026/11/17 分割シフト（スマレジからの取り込み用）（SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '10s';
-- 1日のシフトを「08:45〜10:15・10:30〜12:00」のように時間帯に分けて持てるようにする。
-- 今あるシフトはそのまま（null＝これまでどおりの続いたシフト）。
alter table shifts add column if not exists parts jsonb;
alter table published_shifts add column if not exists parts jsonb;
insert into schema_migrations (name) values ('013_shift_parts.sql') on conflict do nothing;
select count(*) as "列（2なら完了）" from information_schema.columns
where table_name in ('shifts', 'published_shifts') and column_name = 'parts';
