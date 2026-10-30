-- スタッフ名簿を確定する（2026年10月30日時点・13名）
-- Supabase の SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果になります。
--   ・下の名簿にいる人を登録（すでにいる人はそのまま、所属店舗だけ「お酒の水族館」にそろえる）
--   ・名簿にいない人は「退職」にする（ログイン画面・シフト・端末に出なくなる。過去の勤怠は残る）
--   ・時給は 10月支給の給与明細の時給。1,150円の人は最低賃金改定に合わせ 2026/11/16 から 1,180円
-- 時給の変更は、あとから画面の「スタッフ・時給」でできます。

drop table if exists _roster;
create table _roster (ord int, name text, role text, employment text, pay_type text, hourly int, k text);
insert into _roster (ord, name, role, employment, pay_type, hourly) values
  ( 0, '上塚 佳祐',   'admin', '役員',   'monthly', null),
  ( 1, '小舩 愛賀',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1500),
  ( 2, '井上 朝日',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1200),
  ( 3, '上塚 妙子',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1300),
  ( 4, '大西 希望',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1200),
  ( 5, '黒岩 海里',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1150),
  ( 6, '坂本 大知',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1150),
  ( 7, '佐藤 楓',     'staff', 'ﾊﾟｰﾄ', 'hourly', 1150),
  ( 8, '西ヶ開 麻衣', 'staff', 'ﾊﾟｰﾄ', 'hourly', 1300),
  ( 9, '増田 馨',     'staff', 'ﾊﾟｰﾄ', 'hourly', 1150),
  (10, '山口 利珠',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1150),
  (11, '吉村 優太',   'staff', 'ﾊﾟｰﾄ', 'hourly', 1300),
  (12, '除補 凜',     'staff', 'ﾊﾟｰﾄ', 'hourly', 1150);

-- 名前の比較は空白（半角・全角）を無視する
update _roster set k = replace(replace(name, ' ', ''), '　', '');

-- 1) 名簿にいない人を退職にする（ログイン中の人も締め出す）
delete from sessions where staff_id in (
  select id from staff where replace(replace(name, ' ', ''), '　', '') not in (select k from _roster));
update staff set active = false, retired_at = coalesce(retired_at, current_date)
where active and replace(replace(name, ' ', ''), '　', '') not in (select k from _roster);

-- 2) 名簿の人を登録（未登録の人だけ）。パスワードは使わないが列が必須なので 1111 のハッシュを入れる
insert into staff (name, role, employment, pay_type, store_id, pin_hash, pin_must_change, sort)
select r.name, r.role, r.employment, r.pay_type, (select id from stores where name = 'お酒の水族館'),
       '$2a$10$S.paN3aDODKIUWBCQgqhSOxWDP0fCHbkRBLjDCczSd96sE3zideDy', true, r.ord
from _roster r
where not exists (select 1 from staff s where replace(replace(s.name, ' ', ''), '　', '') = r.k)
order by r.ord;

-- 3) 名簿の人は全員 在籍・お酒の水族館・名簿の順に並べる
update staff s set active = true, retired_at = null, sort = r.ord, name = r.name,
  store_id = (select id from stores where name = 'お酒の水族館')
from _roster r
where replace(replace(s.name, ' ', ''), '　', '') = r.k;

-- 4) 時給（時給制の人で、まだ時給が1件もない人だけ）
insert into wage_rates (staff_id, effective_from, hourly)
select s.id, date '2026-10-01', r.hourly
from _roster r join staff s on s.name = r.name
where r.pay_type = 'hourly' and not exists (select 1 from wage_rates w where w.staff_id = s.id)
on conflict (staff_id, effective_from) do nothing;

-- 5) 最低賃金の改定（2026/11/16〜 1,180円）を下回る人は、その日から 1,180円
insert into wage_rates (staff_id, effective_from, hourly)
select s.id, date '2026-11-16', 1180
from staff s join _roster r on r.name = s.name
where r.pay_type = 'hourly'
  and (select w.hourly from wage_rates w where w.staff_id = s.id and w.effective_from <= date '2026-11-16'
       order by w.effective_from desc limit 1) < 1180
on conflict (staff_id, effective_from) do nothing;

-- 作業用の表を片付ける
drop table _roster;

-- 結果の確認（在籍13名が並べば完了）
select s.sort as "順", s.name as "名前", st.name as "店舗",
  case s.role when 'admin' then '管理者' when 'manager' then '店長' else 'スタッフ' end as "権限",
  (select string_agg(to_char(w.effective_from, 'MM/DD') || '〜' || w.hourly || '円', '、' order by w.effective_from)
     from wage_rates w where w.staff_id = s.id) as "時給"
from staff s left join stores st on st.id = s.store_id
where s.active order by s.sort, s.id;
