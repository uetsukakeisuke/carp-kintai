-- 2026/10/30 明細の暗証番号を管理者が確認できるようにする（SQL Editor に貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '10s';
-- 明細の暗証番号を管理者が確認できるようにする（本人にも画面でそう伝える）
alter table staff add column if not exists slip_pin text;
insert into schema_migrations (name) values ('004_slip_pin_visible.sql') on conflict do nothing;
select count(*) as "列（1なら完了）" from information_schema.columns where table_name = 'staff' and column_name = 'slip_pin';
