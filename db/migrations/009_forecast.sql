-- 作業量の予測と、シフトの下書きの自動作成
alter table settings add column if not exists forecast jsonb; -- 予測の目安・出荷の日・営業日・最低人数

-- 台帳の「仕入」「客先納品」が済になった日（＝その作業をした日）。予測を実績に合わせる（学習）ために使う
create table if not exists ledger_events (
  id         serial primary key,
  event_date date not null,
  kind       text not null check (kind in ('in','out')), -- in＝入荷、out＝出荷
  part       text not null,
  customer   text,
  qty        numeric not null default 0,
  kg         numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ledger_events_date_idx on ledger_events(event_date);
alter table ledger_events enable row level security;

-- 台帳が届いた日（この日は済になった記録が取れている＝学習に使える日）
create table if not exists ledger_days (day date primary key);
alter table ledger_days enable row level security;

-- 自動で入れた下書き（「元に戻す」で、その後に手で直していないものだけ消すため）
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
