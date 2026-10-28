-- ============================================================
-- カープ勤怠：Supabase 初期設定（SQL Editor に全部貼り付けて「Run」）
-- 1回だけ実行してください。もう一度実行しても重複登録はされません。
-- ============================================================

-- 勤怠・シフト管理システム 初期スキーマ
-- 時刻は「勤務日(work_date) の 0:00 からの分」で持つ。深夜営業で日付をまたぐ勤務は 1440 分以上（最大 29:00 = 1740 分）。

create table if not exists stores (
  id            serial primary key,
  name          text not null unique,
  sort          int  not null default 0,
  active        boolean not null default true,
  -- 人件費予算（円／日）。曜日別の既定値。日別の上書きは daily_budgets。
  budget_weekday int not null default 0,
  budget_friday  int not null default 0,
  budget_weekend int not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists staff (
  id              serial primary key,
  name            text not null,
  kana            text,
  role            text not null default 'staff' check (role in ('staff','manager','admin')),
  employment      text not null default 'ﾊﾟｰﾄ',         -- 給与報告の「雇用」欄
  pay_type        text not null default 'hourly' check (pay_type in ('hourly','monthly')),
  store_id        int references stores(id),
  transport_per_day int not null default 0,              -- 通勤手当 日額（円）
  commute_means   text,                                  -- 通勤手段（電車 等）
  active          boolean not null default true,
  sort            int not null default 0,
  pin_hash        text not null,
  pin_must_change boolean not null default true,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  retired_at      date
);
create index if not exists staff_store_idx on staff(store_id) where active;

-- 時給の履歴（適用開始日つき）。過去の勤務は当時の時給で計算する。
create table if not exists wage_rates (
  id             serial primary key,
  staff_id       int not null references staff(id) on delete cascade,
  effective_from date not null,
  hourly         int not null check (hourly > 0),
  created_by     int references staff(id),
  created_at     timestamptz not null default now(),
  unique (staff_id, effective_from)
);

-- 地域別最低賃金
create table if not exists min_wages (
  region         text not null,
  effective_from date not null,
  hourly         int  not null,
  primary key (region, effective_from)
);

-- ログインセッション（user = 個人、terminal = 店舗の共用端末）
create table if not exists sessions (
  token_hash  text primary key,
  kind        text not null check (kind in ('user','terminal')),
  staff_id    int references staff(id) on delete cascade,
  store_id    int references stores(id),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_staff_idx on sessions(staff_id);

-- シフト期間（店舗×月）
create table if not exists shift_periods (
  id            serial primary key,
  store_id      int not null references stores(id),
  year          int not null,
  month         int not null check (month between 1 and 12),
  hope_deadline date,
  status        text not null default 'draft' check (status in ('draft','published','changed')),
  published_at  timestamptz,
  unique (store_id, year, month)
);

-- シフト希望（出勤できる日だけ時間を入れる）
create table if not exists shift_hopes (
  staff_id   int not null references staff(id) on delete cascade,
  work_date  date not null,
  start_min  int not null,
  end_min    int not null check (end_min > start_min),
  primary key (staff_id, work_date)
);
create table if not exists hope_submissions (
  staff_id     int not null references staff(id) on delete cascade,
  year         int not null,
  month        int not null,
  submitted_at timestamptz not null default now(),
  primary key (staff_id, year, month)
);

-- シフト（下書き＝店長の作業中）と公開版（スタッフが見るもの）
create table if not exists shifts (
  staff_id   int not null references staff(id) on delete cascade,
  work_date  date not null,
  store_id   int not null references stores(id),
  start_min  int not null,
  end_min    int not null check (end_min > start_min),
  updated_at timestamptz not null default now(),
  primary key (staff_id, work_date)
);
create index if not exists shifts_store_date_idx on shifts(store_id, work_date);
create table if not exists published_shifts (
  staff_id   int not null references staff(id) on delete cascade,
  work_date  date not null,
  store_id   int not null references stores(id),
  start_min  int not null,
  end_min    int not null,
  primary key (staff_id, work_date)
);
create index if not exists pshifts_store_date_idx on published_shifts(store_id, work_date);

create table if not exists daily_budgets (
  store_id  int not null references stores(id),
  work_date date not null,
  amount    int not null,
  primary key (store_id, work_date)
);

-- 打刻。記録は書き換えず、修正は承認経由で corrected_* に履歴を残す。
create table if not exists punches (
  id          bigserial primary key,
  staff_id    int not null references staff(id),
  store_id    int references stores(id),
  work_date   date not null,
  kind        text not null check (kind in ('in','break_start','break_end','out')),
  minute      int  not null,
  via         text not null default 'mobile',   -- mobile / terminal / correction
  created_at  timestamptz not null default now(),
  original_minute int,                          -- 修正前の時刻（修正承認で上書きした場合）
  correction_reason text,
  voided      boolean not null default false
);
create index if not exists punches_staff_date_idx on punches(staff_id, work_date);
create index if not exists punches_date_idx on punches(work_date);

create table if not exists correction_requests (
  id          bigserial primary key,
  staff_id    int not null references staff(id),
  work_date   date not null,
  kind        text not null check (kind in ('in','break_start','break_end','out')),
  minute      int  not null,
  reason      text not null,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by  int references staff(id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists corr_status_idx on correction_requests(status);

-- 操作ログ（誰がいつ何をしたか）
create table if not exists audit_log (
  id         bigserial primary key,
  actor_id   int references staff(id),
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- 会社設定（1行のみ）
create table if not exists settings (
  id             int primary key default 1 check (id = 1),
  company_name   text not null default '株式会社カープエージェンシー',
  min_wage_region text not null default '京都府',
  pay_day        int  not null default 10,
  report_email   text not null default 'kyuyo@actvision-tax.jp'
);
insert into settings (id) values (1) on conflict do nothing;

-- 京都府の最低賃金（京都労働局）
insert into min_wages (region, effective_from, hourly) values
  ('京都府', '2025-11-21', 1122),
  ('京都府', '2026-11-16', 1180)
on conflict do nothing;

-- データベースへの直接アクセスを閉じる（アプリのサーバーだけが接続する）
alter table stores enable row level security;
alter table staff enable row level security;
alter table wage_rates enable row level security;
alter table min_wages enable row level security;
alter table sessions enable row level security;
alter table shift_periods enable row level security;
alter table shift_hopes enable row level security;
alter table hope_submissions enable row level security;
alter table shifts enable row level security;
alter table published_shifts enable row level security;
alter table daily_budgets enable row level security;
alter table punches enable row level security;
alter table correction_requests enable row level security;
alter table audit_log enable row level security;
alter table settings enable row level security;

create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());


-- このファイルで 001 のマイグレーションを適用済みとして記録
insert into schema_migrations (name) values ('001_init.sql') on conflict do nothing;

-- 店舗
insert into stores (name, sort, budget_weekday, budget_friday, budget_weekend) values
  ('お酒の水族館', 1, 42000, 50000, 56000),
  ('京都工房', 2, 30000, 36000, 40000)
on conflict (name) do nothing;

-- 管理者（上塚 佳祐／初期パスワード 1111。初回ログイン時に変更）
insert into staff (name, kana, role, employment, pay_type, pin_hash, sort)
select '上塚 佳祐', 'うえつか けいすけ', 'admin', '役員', 'monthly', '$2a$10$S.paN3aDODKIUWBCQgqhSOxWDP0fCHbkRBLjDCczSd96sE3zideDy', 0
where not exists (select 1 from staff where role = 'admin');

select '準備が完了しました' as result,
  (select count(*) from stores) as stores,
  (select count(*) from staff) as staff;
