-- 経費精算・旅費精算。上塚さん（管理者）がアプリで入れて、
-- 給与報告のExcel（「現金経費精算」「旅費精算」のシート）と専用のスプレッドシートに書き出す。
--   ym: 何月分か（'2026-11'）。経費の日付が前の月でも、精算する月に入れる

-- 月ごと：精算書の下の欄（精算日・精算方法・氏名）と、最後に変えた時刻（スプレッドシートへ反映する目印）
create table if not exists expense_months (
  ym            text primary key check (ym ~ '^\d{4}-\d{2}$'),
  settle_date   date,
  settle_method text check (settle_method in ('bank','cash')),
  person        text,
  updated_at    timestamptz not null default now()
);

-- 現金経費精算の1行（1か月22行まで＝用紙の行数）
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
create index if not exists expense_items_ym_idx on expense_items(ym, day, id);

-- 旅費精算書（出張1回で1枚。同じ月に何枚でも）
--   schedule: 出張スケジュール [{from,to,place,detail}]（8行まで）
--   lines:    交通費その他出張中の支出 [{date,kind,memo,amount}]（16行まで）
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
create index if not exists travel_reports_ym_idx on travel_reports(ym, id);

-- 専用スプレッドシートの Apps Script がデータを取りに来るときの合言葉
alter table settings add column if not exists expense_secret text;
alter table settings add column if not exists expense_pulled_at timestamptz;  -- 最後に取りに来た時刻

alter table expense_months enable row level security;
alter table expense_items enable row level security;
alter table travel_reports enable row level security;
