-- 2026/11/12 経費精算・旅費精算（SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '30s';
-- 月ごと：精算書の下の欄（精算日・精算方法・氏名）と最後に変えた時刻
create table if not exists expense_months (
  ym            text primary key check (ym ~ '^\d{4}-\d{2}$'),
  settle_date   date,
  settle_method text check (settle_method in ('bank','cash')),
  person        text,
  updated_at    timestamptz not null default now()
);
-- 現金経費精算の1行（1か月22行まで）
create table if not exists expense_items (
  id         serial primary key,
  ym         text not null check (ym ~ '^\d{4}-\d{2}$'),
  day        date,
  doc        text,
  payee      text not null,
  category   text not null,
  subject    text,
  amount     int not null,
  created_by int references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expense_items_ym_idx
  on expense_items(ym, day, id);
-- 旅費精算書（出張1回で1枚）
create table if not exists travel_reports (
  id           serial primary key,
  ym           text not null check (ym ~ '^\d{4}-\d{2}$'),
  applied_on   date,
  dept         text,
  person       text,
  destination  text,
  schedule     jsonb not null default '[]',
  diem_unit    int not null default 5000,
  diem_days    numeric(5,1) not null default 0,
  lodge_unit   int not null default 10000,
  lodge_nights numeric(5,1) not null default 0,
  lines        jsonb not null default '[]',
  advance      int not null default 0,
  created_by   int references staff(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists travel_reports_ym_idx
  on travel_reports(ym, id);
alter table settings
  add column if not exists expense_secret text;
alter table settings
  add column if not exists expense_pulled_at timestamptz;
alter table expense_months enable row level security;
alter table expense_items enable row level security;
alter table travel_reports enable row level security;
insert into schema_migrations (name) values ('011_expenses.sql')
on conflict do nothing;
select count(*) as "表（3なら完了）" from information_schema.tables
where table_schema = 'public'
  and table_name in ('expense_months', 'expense_items', 'travel_reports');
