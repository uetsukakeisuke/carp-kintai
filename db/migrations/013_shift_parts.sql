-- シフトを時間帯に分けて持てるようにする（スマレジの「08:45〜10:15・10:30〜12:00」のような分割シフト）
-- parts は [[開始分, 終了分], ...]。null なら開始〜終了の続いたシフト（これまでどおり）
alter table shifts add column if not exists parts jsonb;
alter table published_shifts add column if not exists parts jsonb;
