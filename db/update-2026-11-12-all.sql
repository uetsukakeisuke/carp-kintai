-- 2026/11/12 まとめて実行用。何回実行しても同じ結果
set lock_timeout = '10s';
create table if not exists payslip_imports (
  id          serial primary key,
  source      text not null check (source in ('gmail','upload')),
  message_id  text unique,
  subject     text,
  file_names  text[] not null default '{}',
  received_at timestamptz,
  slips       int not null default 0,
  unmatched   int not null default 0,
  error       text,
  created_by  int references staff(id),
  created_at  timestamptz not null default now()
);
create table if not exists payslips (
  id          serial primary key,
  staff_id    int references staff(id),
  slip_name   text not null,
  slip_code   text,
  work_year   int not null,
  work_month  int not null check (work_month between 1 and 12),
  pay_date    date,
  period      text,
  data        jsonb not null,
  gross       int not null default 0,
  deduction   int not null default 0,
  net         int not null default 0,
  import_id   int references payslip_imports(id),
  ignored     boolean not null default false,
  updated_at  timestamptz not null default now(),
  unique (slip_name, work_year, work_month)
);
create index if not exists payslips_staff_idx
  on payslips(staff_id, work_year, work_month);
alter table staff add column if not exists payroll_code text;
alter table staff add column if not exists slip_pin_hash text;
alter table staff add column if not exists slip_failed int not null default 0;
alter table staff add column if not exists slip_locked_until timestamptz;
create table if not exists slip_unlocks (
  token_hash  text primary key,
  staff_id    int not null references staff(id) on delete cascade,
  expires_at  timestamptz not null
);
alter table settings add column if not exists import_secret text;
alter table payslip_imports enable row level security;
alter table payslips enable row level security;
alter table slip_unlocks enable row level security;
alter table staff add column if not exists slip_pin text;
alter table punches add column if not exists face text;
alter table punches add column if not exists face_distance real;
drop table if exists staff_faces;
create table if not exists ledger_snapshots (
  id          serial primary key,
  orders      jsonb not null,
  terms       jsonb not null,
  row_count   int not null default 0,
  meta        jsonb not null default '{}',
  received_at timestamptz not null default now()
);
create index if not exists ledger_snapshots_at_idx on ledger_snapshots(received_at desc);
alter table ledger_snapshots enable row level security;
alter table settings add column if not exists ledger_secret text;
alter table settings add column if not exists ledger_sheet_id text;
create table if not exists day_tasks (
  id          serial primary key,
  store_id    int not null references stores(id),
  work_date   date not null,
  staff_id    int references staff(id),
  kind        text not null default 'task' check (kind in ('task','note')),
  title       text not null,
  note        text,
  at_min      int check (at_min between 0 and 1800),
  first_date  date not null,
  done_at     timestamptz,
  done_by     int references staff(id),
  created_by  int references staff(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists day_tasks_day_idx on day_tasks(store_id, work_date);
create index if not exists day_tasks_open_idx
  on day_tasks(store_id, work_date)
  where done_at is null and kind = 'task';
alter table day_tasks enable row level security;
alter table staff add column if not exists cal_token text;
create unique index if not exists staff_cal_token_idx
  on staff(cal_token) where cal_token is not null;
alter table settings add column if not exists forecast jsonb;
create table if not exists ledger_events (
  id         serial primary key,
  event_date date not null,
  kind       text not null check (kind in ('in','out')),
  part       text not null,
  customer   text,
  qty        numeric not null default 0,
  kg         numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ledger_events_date_idx on ledger_events(event_date);
alter table ledger_events enable row level security;
create table if not exists ledger_days (day date primary key);
alter table ledger_days enable row level security;
create table if not exists auto_drafts (
  batch      int not null,
  store_id   int not null references stores(id),
  staff_id   int not null references staff(id) on delete cascade,
  work_date  date not null,
  start_min  int not null,
  end_min    int not null,
  created_by int references staff(id),
  created_at timestamptz not null default now(),
  primary key (batch, staff_id, work_date)
);
alter table auto_drafts enable row level security;
create table if not exists api_keys (
  id           serial primary key,
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  scopes       text[] not null default '{}',
  created_by   int references staff(id),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table api_keys enable row level security;
insert into schema_migrations (name) values
  ('003_payslips.sql'), ('004_slip_pin_visible.sql'), ('005_faces.sql'),
  ('006_ledger.sql'), ('007_tasks.sql'), ('008_calendar.sql'),
  ('009_forecast.sql'), ('010_api_keys.sql')
on conflict do nothing;
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in ('payslips', 'ledger_snapshots', 'day_tasks',
        'ledger_events', 'ledger_days', 'auto_drafts', 'api_keys')
  ) as "表（7なら完了）",
  (select count(*) from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'settings'
        and column_name in ('ledger_secret', 'ledger_sheet_id', 'forecast'))
      or (table_name = 'staff' and column_name in ('cal_token', 'slip_pin'))
      or (table_name = 'punches' and column_name = 'face'))
  ) as "列（6なら完了）";
