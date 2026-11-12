// 経費精算の専用スプレッドシートに入れる Google Apps Script（スプレッドシートの「拡張機能 → Apps Script」に貼り付けて使う）
// アプリの経費精算・旅費精算を10分ごとに取りに来て、月ごとのタブ（例：2026年11月 現金経費精算）に書き込む。
// タブは、同じスプレッドシートにある「現金経費精算」「旅費精算」のタブ（ひな形）を複製して作る。
export function gasExpenseScript(appUrl: string, secret: string) {
  return `// カープ勤怠：経費精算・旅費精算をこのスプレッドシートに反映する
// アプリで入れた内容を10分ごとに取りに来て、月ごとのタブ（例：2026年11月 現金経費精算）に書き込みます。
// アプリの内容で上書きします（このスプレッドシートで直した部分は、次に反映したときアプリの内容に戻ります）。
const APP_URL = '${appUrl}/api/expenses/sheet';
const SECRET = '${secret}';
const KINDS = { expense: '現金経費精算', travel: '旅費精算' };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('カープ勤怠')
    .addItem('今すぐ反映', 'syncNow')
    .addItem('全部の月を作り直す', 'syncAll')
    .addToUi();
}
function syncNow() { sync(false); }
function syncAll() { sync(true); }
function syncAuto() { sync(false); }

function sync(all) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;
  try {
    const props = PropertiesService.getDocumentProperties();
    const since = all ? '' : (props.getProperty('since') || '');
    const res = UrlFetchApp.fetch(APP_URL + (since ? '?since=' + encodeURIComponent(since) : ''), {
      headers: { 'x-import-secret': SECRET }, muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) throw new Error('アプリから取れませんでした（' + res.getResponseCode() + '）' + res.getContentText().slice(0, 200));
    const body = JSON.parse(res.getContentText());
    const ss = SpreadsheetApp.getActive();
    body.months.forEach(function (m) { writeMonth(ss, m); });
    props.setProperty('since', body.now);
    console.log(body.months.length + 'か月分を反映しました');
  } finally {
    lock.releaseLock();
  }
}

function prefix(ym) { return Number(ym.slice(0, 4)) + '年' + Number(ym.slice(5, 7)) + '月 '; }
function ymOf(name) {
  const m = /^(\\d{4})年(\\d{1,2})月 /.exec(name);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : '';
}

// ひな形のタブ（年月の付いていない「現金経費精算」「旅費精算」）
function template(ss, kind) {
  const word = KINDS[kind];
  const sh = ss.getSheets().filter(function (s) { return !ymOf(s.getName()) && s.getName().indexOf(word) >= 0; })[0];
  if (!sh) throw new Error('ひな形のタブ「' + word + '」が見つかりません。いま使っている給与報告フォームから「' + word + '」のタブを、このスプレッドシートにコピーしてください');
  return sh;
}

function writeMonth(ss, m) {
  const pre = prefix(m.ym), keep = {};
  m.sheets.forEach(function (s) {
    const name = pre + s.name;
    keep[name] = true;
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name, indexFor(ss, m.ym), { template: template(ss, s.kind) });
    writeCells(sh, s.cells);
  });
  // その月の、もう要らないタブ（アプリで消した旅費精算書など）を消す
  ss.getSheets().forEach(function (sh) {
    const n = sh.getName();
    if (n.indexOf(pre) === 0 && !keep[n] && (n.indexOf(KINDS.expense) >= 0 || n.indexOf(KINDS.travel) >= 0)) ss.deleteSheet(sh);
  });
}

// 新しい月ほど左。同じ月の中では作った順
function indexFor(ss, ym) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const k = ymOf(sheets[i].getName());
    if (!k || k < ym) return i;
  }
  return sheets.length;
}

// セルに書く。null＝消す／数＝そのまま／文字＝文字のまま（日付などに化けないよう ' を付ける）／{f}＝計算式
function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  if (typeof v === 'object') return '=' + v.f;
  return "'" + v;
}
function colNum(s) { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n; }
function writeCells(sh, cells) {
  // 同じ行で隣り合うセルはまとめて書く（速くするため）
  let run = null;
  const flush = function () {
    if (!run) return;
    sh.getRange(run.row, run.col, 1, run.values.length).setValues([run.values]);
    run = null;
  };
  cells.forEach(function (c) {
    const m = /^([A-Z]+)(\\d+)$/.exec(c[0]);
    const col = colNum(m[1]), row = Number(m[2]);
    if (run && run.row === row && run.col + run.values.length === col) { run.values.push(cellValue(c[1])); return; }
    flush();
    run = { row: row, col: col, values: [cellValue(c[1])] };
  });
  flush();
}

// 最初に1回だけ実行：ひな形を確かめ、10分ごとの自動実行を登録して、全部の月を書き込む
function setup() {
  const ss = SpreadsheetApp.getActive();
  ['expense', 'travel'].forEach(function (k) {
    const sh = template(ss, k);
    if (sh.getName() !== 'ひな形 ' + KINDS[k]) sh.setName('ひな形 ' + KINDS[k]);
  });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncAuto') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncAuto').timeBased().everyMinutes(10).create();
  sync(true);
}
`;
}
