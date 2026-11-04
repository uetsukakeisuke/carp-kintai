// 受発注台帳（Google スプレッドシート）をアプリへ送る Google Apps Script（script.google.com に貼り付けて使う）
// 台帳とは別のプロジェクトにする（台帳にすでにあるスクリプトや自動実行には手を触れない）
export function gasLedgerScript(appUrl: string, secret: string, sheetId: string) {
  return `// カープ勤怠：京都工房の受発注台帳を「受発注の報告」に送る
// 1時間ごとに「受発注履歴」と「取引先一覧」を読んで、アプリに送ります。台帳を書き換えることはしません。
const APP_URL = '${appUrl}/api/ledger/import';
const SECRET = '${secret}';
const SHEET_ID = '${sheetId}';

function sendLedger() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const orders = sheetOf(ss, '受発注履歴');
  const res = UrlFetchApp.fetch(APP_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-import-secret': SECRET },
    payload: JSON.stringify({ orders: cells(orders, 45), terms: cells(sheetOf(ss, '取引先一覧'), 2), gid: orders.getSheetId() }),
  });
  console.log(res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  if (res.getResponseCode() !== 200) throw new Error('アプリに送れませんでした（' + res.getResponseCode() + '）');
}

function sheetOf(ss, name) {
  const sh = ss.getSheets().filter(function (s) { return s.getName().trim() === name; })[0];
  if (!sh) throw new Error('シート「' + name + '」が見つかりません');
  return sh;
}

// 日付のセルは年まで分かるように「2026-11-10」の形で送る
function cells(sh, cols) {
  const rows = sh.getLastRow(), n = Math.min(sh.getLastColumn(), cols);
  if (rows < 1 || n < 1) return [];
  return sh.getRange(1, 1, rows, n).getValues().map(function (r) {
    return r.map(function (c) { return c instanceof Date ? Utilities.formatDate(c, 'Asia/Tokyo', 'yyyy-MM-dd') : c; });
  });
}

// 最初に1回だけ実行：1時間ごとの自動実行を登録して、その場で1回送る
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendLedger') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendLedger').timeBased().everyHours(1).create();
  sendLedger();
}
`;
}
