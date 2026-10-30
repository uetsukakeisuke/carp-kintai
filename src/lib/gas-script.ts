// Gmail に届いた給与明細PDFをアプリへ送る Google Apps Script（script.google.com に貼り付けて使う）
export function gasScript(appUrl: string, secret: string) {
  return `// カープ勤怠：アクトヴィジョンの給与明細メールを自動で取り込む
// 1時間ごとに Gmail を確認し、まだ取り込んでいない「給与明細」のPDFをアプリに送ります。
const APP_URL = '${appUrl}/api/payslips/import';
const SECRET = '${secret}';
const QUERY = 'from:kyuyo@actvision-tax.jp subject:給与明細 has:attachment filename:pdf newer_than:90d -label:勤怠アプリ取込済み';
const DONE_LABEL = '勤怠アプリ取込済み';

function importPayslips() {
  const label = GmailApp.getUserLabelByName(DONE_LABEL) || GmailApp.createLabel(DONE_LABEL);
  for (const thread of GmailApp.search(QUERY, 0, 10)) {
    let allDone = true;
    for (const m of thread.getMessages()) {
      const pdfs = m.getAttachments().filter(function (a) { return /\\.pdf$/i.test(a.getName()) && a.getName().indexOf('明細') >= 0; });
      if (!pdfs.length) continue;
      const res = UrlFetchApp.fetch(APP_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { 'x-import-secret': SECRET },
        payload: JSON.stringify({
          messageId: m.getId(), subject: m.getSubject(), date: m.getDate().toISOString(),
          files: pdfs.map(function (a) { return { name: a.getName(), base64: Utilities.base64Encode(a.getBytes()) }; }),
        }),
      });
      const code = res.getResponseCode();
      console.log(m.getSubject() + ' → ' + code + ' ' + res.getContentText().slice(0, 300));
      if (code !== 200 && code !== 422) allDone = false; // 通信の失敗などは次の回にもう一度
    }
    if (allDone) thread.addLabel(label);
  }
}

// 最初に1回だけ実行：1時間ごとの自動実行を登録して、その場で1回取り込む
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importPayslips').timeBased().everyHours(1).create();
  importPayslips();
}
`;
}
