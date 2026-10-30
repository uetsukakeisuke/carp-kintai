-- 顔による本人確認。顔の登録と照合はそれぞれの端末の中で行い、サーバーには結果だけを記録する。
-- 打刻ごとの結果：ok＝本人と一致／mismatch＝一致せず（要確認）／skipped＝顔なしで打刻（要確認）
--               registered＝その端末ではじめて顔を登録／reregistered＝その端末で登録し直し（要確認）
alter table punches add column if not exists face text;
alter table punches add column if not exists face_distance real;
-- 以前の版で作った表（顔の特徴をサーバーに保存する方式）は使わないので消す
drop table if exists staff_faces;
