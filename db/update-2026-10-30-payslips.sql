-- 2026/10/30 給与明細の取り込み（Supabase の SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '10s';

-- 給与明細（アクトヴィジョンの「給与支給明細書」PDF から取り込む）
create table if not exists payslip_imports (
  id          serial primary key,
  source      text not null check (source in ('gmail','upload')),
  message_id  text unique,                 -- Gmail のメールID（同じメールを二重に取り込まない）
  subject     text,
  file_names  text[] not null default '{}',
  received_at timestamptz,
  slips       int not null default 0,      -- 読み取れた明細の数
  unmatched   int not null default 0,      -- スタッフと結びつかなかった数
  error       text,
  created_by  int references staff(id),
  created_at  timestamptz not null default now()
);

create table if not exists payslips (
  id          serial primary key,
  staff_id    int references staff(id),    -- null＝まだスタッフと結びついていない
  slip_name   text not null,               -- 明細書の氏名（空白なし）
  slip_code   text,                        -- 明細書の従業員コード
  work_year   int not null,
  work_month  int not null check (work_month between 1 and 12),
  pay_date    date,
  period      text,
  data        jsonb not null,              -- { attendance, pay, deduction, unit }
  gross       int not null default 0,
  deduction   int not null default 0,
  net         int not null default 0,
  import_id   int references payslip_imports(id),
  ignored     boolean not null default false, -- 退職済みなど、アプリに登録していない人
  updated_at  timestamptz not null default now(),
  unique (slip_name, work_year, work_month)
);
create index if not exists payslips_staff_idx on payslips(staff_id, work_year, work_month);

-- 明細を開くための本人の暗証番号（ログインとは別）
alter table staff add column if not exists payroll_code text;
alter table staff add column if not exists slip_pin_hash text;
alter table staff add column if not exists slip_failed int not null default 0;
alter table staff add column if not exists slip_locked_until timestamptz;

-- 明細を開いている間の鍵（10分）
create table if not exists slip_unlocks (
  token_hash  text primary key,
  staff_id    int not null references staff(id) on delete cascade,
  expires_at  timestamptz not null
);

-- Gmail の自動取り込みが使う合言葉
alter table settings add column if not exists import_secret text;

alter table payslip_imports enable row level security;
alter table payslips enable row level security;
alter table slip_unlocks enable row level security;

insert into schema_migrations (name) values ('003_payslips.sql') on conflict do nothing;

-- 明細の暗証番号を管理者が確認できるようにする
alter table staff add column if not exists slip_pin text;
insert into schema_migrations (name) values ('004_slip_pin_visible.sql') on conflict do nothing;

select (select count(*) from information_schema.tables where table_name in ('payslips','payslip_imports','slip_unlocks')) as "作った表（3なら完了）";
