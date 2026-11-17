// Excel（xlsx）の最初のシートを、文字の2次元配列として読む（シフトの取り込み用）。
// 数式は計算済みの値を読む。日付の書式のセルは Excel の日付の数のまま（取り込み側で日付に直す）。
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const MAX_ROWS = 2000, MAX_COLS = 200;
const colN = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function texts(el: Element, ns: string): string {
  // <si><t>…</t></si> も <si><r><t>…</t></r>…</si>（書式つき）も、ふりがな（<rPh>）は除いて文字をつなぐ
  let out = '';
  const ts = el.getElementsByTagNameNS(ns, 't');
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if ((t.parentNode as Element | null)?.localName === 'rPh') continue;
    out += t.textContent ?? '';
  }
  return out;
}

export async function readFirstSheet(buf: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buf);
  const parse = (x: string) => new DOMParser().parseFromString(x, 'application/xml');
  const wbXml = await zip.file('xl/workbook.xml')?.async('string');
  if (!wbXml) throw new Error('Excel のファイルではありません');
  const wb = parse(wbXml);
  const NS = wb.documentElement.namespaceURI!;
  const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheet = wb.getElementsByTagNameNS(NS, 'sheet')[0];
  if (!sheet) throw new Error('シートがありません');
  const rid = sheet.getAttributeNS(RNS, 'id') ?? sheet.getAttribute('r:id');
  let path = 'xl/worksheets/sheet1.xml';
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (relsXml && rid) {
    const rels = parse(relsXml).getElementsByTagName('Relationship');
    for (let i = 0; i < rels.length; i++) {
      if (rels[i].getAttribute('Id') !== rid) continue;
      const t = rels[i].getAttribute('Target') ?? '';
      path = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
    }
  }
  const shared: string[] = [];
  const ssXml = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (ssXml) {
    const ss = parse(ssXml);
    const sis = ss.getElementsByTagNameNS(ss.documentElement.namespaceURI!, 'si');
    for (let i = 0; i < sis.length; i++) shared.push(texts(sis[i], ss.documentElement.namespaceURI!));
  }
  const shXml = await zip.file(path)?.async('string');
  if (!shXml) throw new Error('シートが読めません');
  const sh = parse(shXml);
  const SNS = sh.documentElement.namespaceURI!;
  const grid: string[][] = [];
  const rows = sh.getElementsByTagNameNS(SNS, 'row');
  for (let i = 0; i < rows.length && i < MAX_ROWS * 2; i++) {
    const r = rows[i];
    const rn = Number(r.getAttribute('r')) || grid.length + 1;
    if (rn > MAX_ROWS) break;
    const out: string[] = grid[rn - 1] ?? [];
    const cs = r.getElementsByTagNameNS(SNS, 'c');
    for (let j = 0; j < cs.length; j++) {
      const c = cs[j];
      const ref = c.getAttribute('r') ?? '';
      const col = /^([A-Z]+)/.exec(ref)?.[1];
      const ci = col ? colN(col) - 1 : out.length;
      if (ci >= MAX_COLS) continue;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagNameNS(SNS, 'v')[0]?.textContent ?? '';
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') { const is = c.getElementsByTagNameNS(SNS, 'is')[0]; val = is ? texts(is, SNS) : ''; }
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v;
      out[ci] = val;
    }
    grid[rn - 1] = out;
  }
  return Array.from(grid, (r) => Array.from(r ?? [], (c) => c ?? ''));
}
