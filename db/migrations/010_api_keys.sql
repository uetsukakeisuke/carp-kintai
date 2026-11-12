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
