-- 2026/11/04 受発注の報告（SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '10s';
-- 京都工房の受発注台帳（Google スプレッドシート）を読み取って、朝の報告を作る。
-- スプレッドシートの Apps Script が「受発注履歴」と「取引先一覧」を1時間ごとに送ってくる。
-- 台帳には単価・粗利が入るので、見られるのは管理者だけ。アプリから台帳を書き換えることはしない。
create table if not exists ledger_snapshots (
  id          serial primary key,
  orders      jsonb not null,      -- 受発注履歴の全セル（1行目が見出し）
  terms       jsonb not null,      -- 取引先一覧（会社名・支払い条件）
  row_count   int not null default 0,
  meta        jsonb not null default '{}', -- シートの番号（gid）など。行へのリンクに使う
  received_at timestamptz not null default now()
);
create index if not exists ledger_snapshots_at_idx on ledger_snapshots(received_at desc);
alter table ledger_snapshots enable row level security;

alter table settings add column if not exists ledger_secret text;   -- スクリプトからの送信を確かめる合言葉
alter table settings add column if not exists ledger_sheet_id text; -- 台帳のスプレッドシートID
insert into schema_migrations (name) values ('006_ledger.sql') on conflict do nothing;
select count(*) as "列（3なら完了）" from information_schema.columns where (table_name = 'settings' and column_name in ('ledger_secret','ledger_sheet_id')) or (table_name = 'ledger_snapshots' and column_name = 'meta');
