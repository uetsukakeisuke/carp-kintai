// これまでの「給与報告フォーム」(Excel) からスタッフを一括登録する
//   npm run import:staff -- <給与報告フォーム.xlsx> [時給の適用開始日 例 2026-12-01] [--dry-run]
// ・アルバイト・パート欄（19行目〜）の 所属・氏名・時給 を読み取る
// ・閉店した店舗（motto鯉）の行は取り込まない。同じ人が複数行ある場合は最初の行を使う
// ・全員 初期パスワード 1111（初回ログイン時に変更）
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

const CLOSED = ['motto鯉'];
const [file, fromArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dry = process.argv.includes('--dry-run');
if (!file) { console.error('使い方: npm run import:staff -- <給与報告フォーム.xlsx> [2026-12-01] [--dry-run]'); process.exit(1); }
const from = fromArg ?? new Date().toISOString().slice(0, 10);

async function readSheet(path: string) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const p = new DOMParser();
  const ssXml = zip.file('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (ssXml) {
    const doc = p.parseFromString(await ssXml.async('string'), 'application/xml');
    const sis = doc.getElementsByTagName('si');
    for (let i = 0; i < sis.length; i++) {
      const ts = sis[i].getElementsByTagName('t'); let s = '';
      for (let j = 0; j < ts.length; j++) s += ts[j].textContent ?? '';
      shared.push(s);
    }
  }
  // 「給与報告」シートを探す
  const wb = p.parseFromString(await zip.file('xl/workbook.xml')!.async('string'), 'application/xml');
  const rels = p.parseFromString(await zip.file('xl/_rels/workbook.xml.rels')!.async('string'), 'application/xml');
  const sheets = wb.getElementsByTagName('sheet');
  let target = 'xl/worksheets/sheet1.xml';
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getAttribute('name') === '給与報告') {
      const rid = sheets[i].getAttribute('r:id');
      const rs = rels.getElementsByTagName('Relationship');
      for (let j = 0; j < rs.length; j++) if (rs[j].getAttribute('Id') === rid) target = 'xl/' + rs[j].getAttribute('Target')!.replace(/^\/?xl\//, '');
    }
  }
  const doc = p.parseFromString(await zip.file(target)!.async('string'), 'application/xml');
  const cells = new Map<string, string>();
  const cs = doc.getElementsByTagName('c');
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i], ref = c.getAttribute('r')!, t = c.getAttribute('t');
    let v = '';
    if (t === 's') v = shared[Number(c.getElementsByTagName('v')[0]?.textContent)] ?? '';
    else if (t === 'inlineStr') v = c.getElementsByTagName('t')[0]?.textContent ?? '';
    else v = c.getElementsByTagName('v')[0]?.textContent ?? '';
    cells.set(ref, v);
  }
  return cells;
}

(async () => {
  const cells = await readSheet(file);
  const seen = new Set<string>();
  const rows: { store: string; name: string; wage: number }[] = [];
  for (let r = 19; r <= 53; r++) {
    const store = (cells.get(`B${r}`) ?? '').trim(), name = (cells.get(`C${r}`) ?? '').replace(/\s+/g, ' ').trim(), wage = Number(cells.get(`K${r}`));
    if (!name || CLOSED.includes(store)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push({ store, name, wage });
  }
  console.log(`${rows.length}名を読み取りました（時給の適用開始日 ${from}）`);
  for (const r of rows) console.log(`  ${r.store}\t${r.name}\t${r.wage}円`);
  if (dry) return;
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL を設定してください'); process.exit(1); }
  const local = /localhost|127\.0\.0\.1/.test(url);
  const sql = postgres(url, { max: 1, prepare: false, ssl: local ? false : 'require' });
  const pin = await bcrypt.hash('1111', 10);
  let added = 0;
  for (const [i, r] of rows.entries()) {
    const [store] = await sql<{ id: number }[]>`insert into stores (name, sort) values (${r.store}, 10) on conflict (name) do update set name = excluded.name returning id`;
    const [ex] = await sql`select id from staff where replace(name, ' ', '') = ${r.name.replace(/\s/g, '')}`;
    if (ex) { console.log(`  登録済みのため飛ばしました：${r.name}`); continue; }
    const [s] = await sql<{ id: number }[]>`insert into staff (name, role, employment, store_id, pin_hash, sort) values (${r.name}, 'staff', 'ﾊﾟｰﾄ', ${store.id}, ${pin}, ${i + 1}) returning id`;
    if (r.wage > 0) await sql`insert into wage_rates (staff_id, effective_from, hourly) values (${s.id}, ${from}, ${r.wage})`;
    added++;
  }
  console.log(`${added}名を登録しました。交通費は「スタッフ・時給」画面で入力してください。`);
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
