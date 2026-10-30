-- 明細の暗証番号を管理者が確認できるようにする（本人にも画面でそう伝える）
alter table staff add column if not exists slip_pin text;
