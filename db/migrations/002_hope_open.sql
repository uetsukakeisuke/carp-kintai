-- シフト希望の受付開始日（この日より前は入力できない）
alter table shift_periods add column if not exists hope_open date;
