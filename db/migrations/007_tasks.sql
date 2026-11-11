-- その日の予定表。上塚さん・店長が入れて、スタッフは打刻画面で見て、作業が終わったら「済」にする。
--   staff_id が空 … 全体（その日の出勤者みんな）／入っている … その人の作業
--   kind: task＝作業（終わったら済にする）／note＝予定・連絡（済にしない）
--   first_date: 最初に入れた日。終わらずに別の日へ回しても残す（「11/10から」と表示する）
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
create index if not exists day_tasks_open_idx on day_tasks(store_id, work_date) where done_at is null and kind = 'task';
alter table day_tasks enable row level security;
