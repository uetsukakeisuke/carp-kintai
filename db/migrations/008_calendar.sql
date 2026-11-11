-- 自分のカレンダー（Googleカレンダー・iPhoneのカレンダーなど）に、シフトと予定表を自動で入れるためのURL。
-- 本人が設定画面で作る。URLを知っている人はその人の予定を見られるので、作り直し・取り消しができる。
alter table staff add column if not exists cal_token text;
create unique index if not exists staff_cal_token_idx on staff(cal_token) where cal_token is not null;
