-- 顔による本人確認（1対1照合）。写真は保存せず、顔の特徴を表す128個の数値だけを保存する。
create table if not exists staff_faces (
  staff_id      int primary key references staff(id) on delete cascade,
  descriptor    real[] not null,
  consent_at    timestamptz not null,       -- 本人に説明し同意を得た日時
  registered_by int references staff(id),
  created_at    timestamptz not null default now()
);
-- 打刻ごとの照合結果：ok＝本人と一致／mismatch＝一致せず（要確認）／skipped＝写真なしで打刻（要確認）
alter table punches add column if not exists face text;
alter table punches add column if not exists face_distance real;
alter table staff_faces enable row level security;
