-- 2026/10/30 の変更（Supabase の SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
--   1) シフト希望の「受付開始日」を入れる列を追加
--   2) 店舗を「京都工房」だけにする（全員を京都工房の所属へ。お酒の水族館は非表示にする。過去のデータは残る）
--   3) 上塚 佳祐 のパスワードを 1111 に戻し、ロックを解除する

alter table shift_periods add column if not exists hope_open date;
insert into schema_migrations (name) values ('002_hope_open.sql') on conflict do nothing;

do $$
declare kobo int; aqua int;
begin
  select id into kobo from stores where name = '京都工房';
  select id into aqua from stores where name = 'お酒の水族館';
  if kobo is null then raise exception '店舗「京都工房」が見つかりません'; end if;

  update stores set active = true, sort = 1 where id = kobo;
  update stores set active = false where id = aqua;
  update staff set store_id = kobo where store_id is distinct from kobo;
  -- お酒の水族館で入れたシフト・受付期間・打刻・店舗端末を京都工房に移す（京都工房側にない分だけ）
  update shift_periods p set store_id = kobo where p.store_id = aqua
    and not exists (select 1 from shift_periods q where q.store_id = kobo and q.year = p.year and q.month = p.month);
  update shifts set store_id = kobo where store_id = aqua;
  update published_shifts set store_id = kobo where store_id = aqua;
  update punches set store_id = kobo where store_id = aqua;
  update sessions set store_id = kobo where kind = 'terminal' and store_id = aqua;

  update staff set pin_hash = '$2a$10$S.paN3aDODKIUWBCQgqhSOxWDP0fCHbkRBLjDCczSd96sE3zideDy',
    pin_must_change = false, failed_attempts = 0, locked_until = null, active = true
  where replace(replace(name, ' ', ''), '　', '') = '上塚佳祐';
end $$;

select st.name as "店舗", st.active as "使用中",
  (select count(*) from staff s where s.store_id = st.id and s.active) as "在籍人数"
from stores st order by st.sort, st.id;
