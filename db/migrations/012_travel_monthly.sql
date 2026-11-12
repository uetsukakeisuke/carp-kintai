-- 旅費精算書を「1か月に1枚」にする（実際の用紙に合わせる）。その月の出張をまとめて書く。
--   diem:  出張日当の行 [{label,unit,count}]（例：出張日当　日帰り 3000×1、出張日当　宿泊 4000×6）4行まで
--   lodge: 宿泊日当の行（同じ形）4行まで
alter table travel_reports add column if not exists diem jsonb not null default '[]';
alter table travel_reports add column if not exists lodge jsonb not null default '[]';
alter table travel_reports drop column if exists diem_unit;
alter table travel_reports drop column if exists diem_days;
alter table travel_reports drop column if exists lodge_unit;
alter table travel_reports drop column if exists lodge_nights;
drop index if exists travel_reports_ym_idx;
create unique index if not exists travel_reports_ym_key on travel_reports(ym);

-- ドライブへの自動保存（Apps Script）の結果。画面に出す
alter table settings add column if not exists form_sync jsonb;
