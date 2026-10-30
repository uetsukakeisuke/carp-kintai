-- スタッフ名簿を確定する（2026年10月30日時点・13名）
-- Supabase の SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果になります。
--   ・下の名簿にいる人を登録（すでにいる人はそのまま、所属店舗だけ「お酒の水族館」にそろえる）
--   ・名簿にいない人は「退職」にする（ログイン画面・シフト・端末に出なくなる。過去の勤怠は残る）
--   ・時給は 10月支給の給与明細の時給。1,150円の人は最低賃金改定に合わせ 2026/11/16 から 1,180円
-- 時給の変更は、あとから画面の「スタッフ・時給」でできます。

do $$
declare
  roster jsonb := '[
    {"ord":0,  "name":"上塚 佳祐",   "role":"admin", "employment":"役員",   "pay_type":"monthly", "hourly":null},
    {"ord":1,  "name":"小舩 愛賀",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1500},
    {"ord":2,  "name":"井上 朝日",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1200},
    {"ord":3,  "name":"上塚 妙子",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1300},
    {"ord":4,  "name":"大西 希望",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1200},
    {"ord":5,  "name":"黒岩 海里",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1150},
    {"ord":6,  "name":"坂本 大知",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1150},
    {"ord":7,  "name":"佐藤 楓",     "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1150},
    {"ord":8,  "name":"西ヶ開 麻衣", "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1300},
    {"ord":9,  "name":"増田 馨",     "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1150},
    {"ord":10, "name":"山口 利珠",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1150},
    {"ord":11, "name":"吉村 優太",   "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1300},
    {"ord":12, "name":"除補 凜",     "role":"staff", "employment":"ﾊﾟｰﾄ", "pay_type":"hourly",  "hourly":1150}
  ]';
  keys text[];
  shop int;
begin
  select id into shop from stores where name = 'お酒の水族館';
  if shop is null then raise exception '店舗「お酒の水族館」が見つかりません'; end if;

  -- 名前の比較は空白（半角・全角）を無視する
  select array_agg(replace(replace(r->>'name', ' ', ''), '　', '')) into keys from jsonb_array_elements(roster) r;

  -- 1) 名簿にいない人を退職にする（ログイン中の人も締め出す）
  delete from sessions where staff_id in (
    select id from staff where replace(replace(name, ' ', ''), '　', '') <> all(keys));
  update staff set active = false, retired_at = coalesce(retired_at, current_date)
  where active and replace(replace(name, ' ', ''), '　', '') <> all(keys);

  -- 2) 名簿の人を登録（未登録の人だけ）。パスワードは使わないが列が必須なので 1111 のハッシュを入れる
  insert into staff (name, role, employment, pay_type, store_id, pin_hash, pin_must_change, sort)
  select r.name, r.role, r.employment, r.pay_type, shop,
         '$2a$10$S.paN3aDODKIUWBCQgqhSOxWDP0fCHbkRBLjDCczSd96sE3zideDy', true, r.ord
  from jsonb_to_recordset(roster) as r(ord int, name text, role text, employment text, pay_type text, hourly int)
  where not exists (select 1 from staff s
                    where replace(replace(s.name, ' ', ''), '　', '') = replace(replace(r.name, ' ', ''), '　', ''))
  order by r.ord;

  -- 3) 名簿の人は全員 在籍・お酒の水族館・名簿の順に並べる
  update staff s set active = true, retired_at = null, sort = r.ord, name = r.name, store_id = shop
  from jsonb_to_recordset(roster) as r(ord int, name text)
  where replace(replace(s.name, ' ', ''), '　', '') = replace(replace(r.name, ' ', ''), '　', '');

  -- 4) 時給（時給制の人で、まだ時給が1件もない人だけ）
  insert into wage_rates (staff_id, effective_from, hourly)
  select s.id, date '2026-10-01', r.hourly
  from jsonb_to_recordset(roster) as r(name text, pay_type text, hourly int)
  join staff s on s.name = r.name
  where r.pay_type = 'hourly' and not exists (select 1 from wage_rates w where w.staff_id = s.id)
  on conflict (staff_id, effective_from) do nothing;

  -- 5) 最低賃金の改定（2026/11/16〜 1,180円）を下回る人は、その日から 1,180円
  insert into wage_rates (staff_id, effective_from, hourly)
  select s.id, date '2026-11-16', 1180
  from jsonb_to_recordset(roster) as r(name text, pay_type text)
  join staff s on s.name = r.name
  where r.pay_type = 'hourly'
    and (select w.hourly from wage_rates w where w.staff_id = s.id and w.effective_from <= date '2026-11-16'
         order by w.effective_from desc limit 1) < 1180
  on conflict (staff_id, effective_from) do nothing;
end $$;

-- 結果の確認（在籍13名が並べば完了）
select s.sort as "順", s.name as "名前", st.name as "店舗",
  case s.role when 'admin' then '管理者' when 'manager' then '店長' else 'スタッフ' end as "権限",
  (select string_agg(to_char(w.effective_from, 'MM/DD') || '〜' || w.hourly || '円', '、' order by w.effective_from)
     from wage_rates w where w.staff_id = s.id) as "時給"
from staff s left join stores st on st.id = s.store_id
where s.active order by s.sort, s.id;
