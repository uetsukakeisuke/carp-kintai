-- シフトの枠（会社が作る「日・時間帯・人数」）。枠の中なら、スタッフが自分でシフトに入る・時間を変える・やめることができる
create table if not exists shift_slots (
  id         serial primary key,
  store_id   int  not null references stores(id),
  work_date  date not null,
  start_min  int  not null,
  end_min    int  not null check (end_min > start_min),
  capacity   int  not null check (capacity between 1 and 99),
  label      text not null default '',
  created_by int references staff(id),
  created_at timestamptz not null default now()
);
create index if not exists shift_slots_day_idx on shift_slots(store_id, work_date);
-- スタッフが自分で変えたシフトの記録（店長が見る）
create table if not exists shift_changes (
  id         bigserial primary key,
  store_id   int  not null references stores(id),
  staff_id   int  not null references staff(id) on delete cascade,
  work_date  date not null,
  action     text not null check (action in ('add','change','delete')),
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists shift_changes_store_idx on shift_changes(store_id, created_at desc);
-- 「空きが出ました」のお知らせ（全員に表示）
create table if not exists shift_notices (
  id         bigserial primary key,
  store_id   int  not null references stores(id),
  work_date  date not null,
  slot_id    int  references shift_slots(id) on delete cascade,
  start_min  int  not null,
  end_min    int  not null,
  label      text not null default '',
  by_staff   int  references staff(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shift_notices_store_idx on shift_notices(store_id, created_at desc);
-- お知らせをどこまで見たか（未読の数を出すため）
alter table staff add column if not exists notice_seen_at timestamptz;
alter table shift_slots enable row level security;
alter table shift_changes enable row level security;
alter table shift_notices enable row level security;
