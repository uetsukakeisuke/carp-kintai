// ひな形の Excel（xlsx）に、書式を変えずに値だけ書き込むための小さな道具。
import type JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export type CellValue = string | number | { f: string; v?: number } | null;

const colN = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const split = (ref: string) => { const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) throw new Error(`セル番地が正しくありません: ${ref}`); return [m[1], Number(m[2])] as const; };

/** シート1枚の XML を開いて、セルに書く。書式（s）はそのまま */
export function editSheet(xml: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const NS = doc.documentElement.namespaceURI!;
  const sd = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
  const kids = (el: Element) => Array.from(el.childNodes as unknown as ArrayLike<Node>).filter((x) => x.nodeType === 1) as Element[];
  function rowEl(n: number) {
    let before: Element | null = null;
    for (const r of kids(sd)) { const rn = Number(r.getAttribute('r')); if (rn === n) return r; if (rn > n) { before = r; break; } }
    const r = doc.createElementNS(NS, 'row'); r.setAttribute('r', String(n)); sd.insertBefore(r, before); return r;
  }
  function cellEl(ref: string) {
    const [c, n] = split(ref), row = rowEl(n);
    let before: Element | null = null;
    for (const x of kids(row)) { const xr = x.getAttribute('r')!; if (xr === ref) return x; if (colN(split(xr)[0]) > colN(c)) { before = x; break; } }
    const x = doc.createElementNS(NS, 'c'); x.setAttribute('r', ref); row.insertBefore(x, before); return x;
  }
  const el = (name: string, text: string) => { const e = doc.createElementNS(NS, name); e.appendChild(doc.createTextNode(text)); return e; };
  function set(ref: string, v: CellValue) {
    const c = cellEl(ref);
    while (c.firstChild) c.removeChild(c.firstChild);
    c.removeAttribute('t');
    if (v === null || v === '') return;
    if (typeof v === 'number') c.appendChild(el('v', String(v)));
    else if (typeof v === 'object') { c.appendChild(el('f', v.f)); if (typeof v.v === 'number') c.appendChild(el('v', String(v.v))); }
    else {
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is'), t = el('t', v);
      if (/^\s|\s$/.test(v)) t.setAttribute('xml:space', 'preserve');
      is.appendChild(t); c.appendChild(is);
    }
  }
  return { set, xml: () => new XMLSerializer().serializeToString(doc) };
}

/** 書き込んでファイルに戻す */
export async function writeCells(zip: JSZip, part: string, cells: Iterable<[string, CellValue]>) {
  const f = zip.file(part);
  if (!f) throw new Error(`ひな形に ${part} がありません`);
  const s = editSheet(await f.async('string'));
  for (const [ref, v] of cells) s.set(ref, v);
  zip.file(part, s.xml());
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const WS_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const WS_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

/** シートを複製して末尾に足す（印刷範囲も写す）。足したシートのファイル名を返す */
export async function copySheet(zip: JSZip, srcPart: string, name: string): Promise<string> {
  const wbP = 'xl/workbook.xml', relP = 'xl/_rels/workbook.xml.rels', ctP = '[Content_Types].xml';
  let wb = await zip.file(wbP)!.async('string');
  let rels = await zip.file(relP)!.async('string');
  let ct = await zip.file(ctP)!.async('string');
  const src = await zip.file(srcPart)?.async('string');
  if (!src) throw new Error(`ひな形に ${srcPart} がありません`);
  let n = 1;
  while (zip.file(`xl/worksheets/sheet${n}.xml`)) n++;
  const part = `xl/worksheets/sheet${n}.xml`;
  zip.file(part, src.replace(/\stabSelected="1"/g, ''));
  // 元のシートの r:id と位置
  const relRe = /<Relationship\b[^>]*>/g;
  let srcRid = '';
  for (const m of rels.match(relRe) ?? []) {
    const target = /Target="([^"]+)"/.exec(m)?.[1] ?? '';
    if (target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/') === srcPart) srcRid = /Id="([^"]+)"/.exec(m)?.[1] ?? '';
  }
  const sheets = wb.match(/<sheet\b[^>]*\/>/g) ?? [];
  const srcIdx = sheets.findIndex((s) => new RegExp(`r:id="${srcRid}"`).test(s));
  const maxId = Math.max(0, ...sheets.map((s) => Number(/sheetId="(\d+)"/.exec(s)?.[1] ?? 0)));
  const rid = `rIdC${n}`;
  rels = rels.replace('</Relationships>', `<Relationship Type="${WS_TYPE}" Target="/${part}" Id="${rid}"/></Relationships>`);
  wb = wb.replace('</sheets>', `<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="${escAttr(name)}" sheetId="${maxId + 1}" state="visible" r:id="${rid}"/></sheets>`);
  if (srcIdx >= 0) {
    const area = new RegExp(`<definedName name="_xlnm\\.Print_Area" localSheetId="${srcIdx}">([^<]*)</definedName>`).exec(wb);
    if (area) {
      const ref = area[1].replace(/^.*!/, '');
      const dn = `<definedName name="_xlnm.Print_Area" localSheetId="${sheets.length}">'${escText(name.replace(/'/g, "''"))}'!${ref}</definedName>`;
      wb = wb.replace('</definedNames>', `${dn}</definedNames>`);
    }
  }
  ct = ct.replace('</Types>', `<Override PartName="/${part}" ContentType="${WS_CT}"/></Types>`);
  zip.file(wbP, wb); zip.file(relP, rels); zip.file(ctP, ct);
  return part;
}

/** 開いたときに計算し直す */
export async function recalcOnLoad(zip: JSZip) {
  const wp = 'xl/workbook.xml';
  let wx = await zip.file(wp)!.async('string');
  wx = /<calcPr[^>]*\/>/.test(wx)
    ? wx.replace(/<calcPr([^>]*?)\s*\/>/, (_m, a: string) => `<calcPr${a.replace(/\sfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`)
    : wx.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  zip.file(wp, wx);
}
