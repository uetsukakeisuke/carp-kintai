// 毎月の給与報告フォームを Google ドライブに作って保存する Google Apps Script（script.google.com の新しいプロジェクトに貼り付けて使う）
// マイドライブの「給与報告」フォルダの中の「YYMM10支給分」フォルダに「YYMM給与報告フォーム.xlsx」（YYMM＝支給月）を1時間ごとに保存する。
// 中身が変わったときだけ保存し直す。ドライブで手で直したファイル・前からある同じ名前のファイルは上書きしない。
export function gasFormsScript(appUrl: string, secret: string) {
  return `// カープ勤怠：毎月の給与報告フォームをドライブに作って保存する
// 1時間ごとにアプリから給与報告フォーム（給与報告・現金経費精算・旅費精算）を受け取り、
// マイドライブの「給与報告」フォルダ →「YYMM10支給分」フォルダに「YYMM給与報告フォーム.xlsx」として保存します（YYMM＝支給月）。
// ・中身が変わったときだけ保存し直します（前の版はドライブの「版の履歴」に残ります）
// ・ドライブで手で直したファイルや、前からある同じ名前のファイルは上書きしません
//   （アプリの内容で作り直したいときは、そのファイルをゴミ箱に入れてください）
const APP_URL = '${appUrl}';
const SECRET = '${secret}';
const ROOT_FOLDER = '給与報告';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function saveForms() {
  const list = call('/api/forms', 'get');
  const root = rootFolder();
  const props = PropertiesService.getScriptProperties();
  const results = list.forms.map(function (f) {
    try {
      return saveOne(root, props, f);
    } catch (e) {
      console.error(f.file + ' ' + e);
      return { ym: f.ym, file: f.file, folder: f.folder, status: 'error', error: String(e).slice(0, 200) };
    }
  });
  results.forEach(function (r) { console.log(r.file + '：' + r.status); });
  call('/api/forms', 'post', { results: results });
}

function saveOne(root, props, f) {
  const folder = monthFolder(root, f.prefix, f.folder);
  const key = 'form:' + f.ym;
  const saved = JSON.parse(props.getProperty(key) || 'null'); // このスクリプトが前に保存したファイル
  let file = null;
  if (saved) { try { file = DriveApp.getFileById(saved.id); if (file.isTrashed()) file = null; } catch (e) { file = null; } }
  const out = function (status, fl) { return { ym: f.ym, file: f.file, folder: folder.getName(), status: status, url: fl ? fl.getUrl() : undefined }; };
  if (!file) {
    const same = folder.getFilesByName(f.file);
    while (same.hasNext()) { const x = same.next(); if (!x.isTrashed()) return out('exists', x); } // 手で作った同じ名前のファイル
    const blob = fetchFile(f.ym).setName(f.file);
    file = folder.createFile(blob);
    remember(props, key, file, f.hash);
    return out('created', file);
  }
  if (file.getLastUpdated().getTime() !== saved.updated) return out('edited', file); // ドライブで直されている
  if (saved.hash === f.hash) return out('unchanged', file);
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + file.getId() + '?uploadType=media&fields=id,modifiedTime', {
    method: 'patch', contentType: XLSX, payload: fetchFile(f.ym).getBytes(), muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  });
  if (res.getResponseCode() !== 200) throw new Error('ドライブに保存できませんでした（' + res.getResponseCode() + '）' + res.getContentText().slice(0, 150));
  const meta = JSON.parse(res.getContentText());
  props.setProperty(key, JSON.stringify({ id: file.getId(), hash: f.hash, updated: Date.parse(meta.modifiedTime) }));
  return out('saved', file);
}

function remember(props, key, file, hash) {
  props.setProperty(key, JSON.stringify({ id: file.getId(), hash: hash, updated: DriveApp.getFileById(file.getId()).getLastUpdated().getTime() }));
}

// マイドライブの「給与報告」フォルダ（なければ作る）
function rootFolder() {
  const it = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER);
}
// 「2611」で始まるフォルダ（例：261110支給分）。なければ作る
function monthFolder(root, prefix, name) {
  const it = root.getFolders();
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(prefix) === 0) return f; }
  return root.createFolder(name);
}

function call(path, method, body) {
  const res = UrlFetchApp.fetch(APP_URL + path, {
    method: method, contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-import-secret': SECRET }, payload: body ? JSON.stringify(body) : undefined,
  });
  if (res.getResponseCode() !== 200) throw new Error('アプリとやり取りできませんでした（' + res.getResponseCode() + '）' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}
function fetchFile(ym) {
  const res = UrlFetchApp.fetch(APP_URL + '/api/forms/file?ym=' + ym, { headers: { 'x-import-secret': SECRET }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('給与報告フォームを受け取れませんでした（' + res.getResponseCode() + '）');
  return res.getBlob().setContentType(XLSX);
}

// 最初に1回だけ実行：1時間ごとの自動実行を登録して、その場で1回保存する
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'saveForms') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('saveForms').timeBased().everyHours(1).create();
  saveForms();
}
`;
}
