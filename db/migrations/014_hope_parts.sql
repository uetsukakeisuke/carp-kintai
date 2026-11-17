-- シフト希望を時間帯に分けて持てるようにする（授業のコマ「1限 8:45〜10:15・2限 10:30〜12:00 …」で選べるように）
-- parts は [[開始分, 終了分], ...]。null なら開始〜終了の続いた希望（これまでどおり）
alter table shift_hopes add column if not exists parts jsonb;
