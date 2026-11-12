-- 2026/11/12 外部連携（APIキー）（SQL Editor に全文を貼り付けて Run。何回実行しても同じ結果）
set lock_timeout = '10s';
-- 外部のシステム（公式LINEなど）がアプリのデータを読むためのAPIキー。
-- キーそのものは保存せず、ハッシュだけ持つ（発行したときに1回だけ表示する）。読める範囲を決め、いつでも取り消せる。
create table if not exists api_keys (
  id           serial primary key,
  name         text not null,              -- 使い道（例：公式LINE）
  prefix       text not null,              -- キーの先頭（画面で見分ける用）
  key_hash     text not null unique,
  scopes       text[] not null default '{}', -- staff＝スタッフの名前／shifts＝公開済みのシフト／tasks＝予定表
  created_by   int references staff(id),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table api_keys enable row level security;
insert into schema_migrations (name) values ('010_api_keys.sql') on conflict do nothing;
select count(*) as "表（1なら完了）" from information_schema.tables where table_name = 'api_keys';
