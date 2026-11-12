"""給与報告のひな形に「現金経費精算」「旅費精算」のシートを足す（開発用・1回だけ使う）。

使い方:
  python3 scripts/dev/build-report-template.py <元のひな形.xlsx（給与報告1枚）> <Googleから書き出した給与報告フォーム.xlsx> <出力.xlsx>

- 給与報告シート（sheet1.xml）・画像・書式はそのまま。足すシートの書式は styles.xml の後ろに付け足す。
- 経費精算の合計式は6行目から数えるように直す（元は7行目からで、1行目の金額が合計に入っていなかった）。
- 見本の入力（たばこ購入 など）は消す。旅費精算は1ページに収まるよう縦向き・1ページに縮小。
"""
import copy
import io
import re
import sys
import zipfile

import openpyxl
from lxml import etree

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
WS_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'
WS_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'
q = lambda t: f'{{{NS}}}{t}'


def clean_form(path: str) -> bytes:
    wb = openpyxl.load_workbook(path)
    for n in list(wb.sheetnames):
        if n not in ('現金経費精算', '旅費精算'):
            del wb[n]
    ex = wb['現金経費精算']
    for row in ex.iter_rows(min_row=6, max_row=27, max_col=14):
        for c in row:
            c.value = None
    ex['A1'] = '令和　年度'
    ex['D1'] = None
    for col in 'DEFGHIJKL':
        ex[f'{col}28'] = f'=SUM({col}6:{col}27)'
    ex['N28'] = '=SUM(N6:N27)'
    ex['K30'] = '=SUM(D28:L28,N28)'
    tr = wb['旅費精算']
    if tr.max_row > 56:
        tr.delete_rows(57, tr.max_row - 56)
    tr['O26'] = '=I26*M26'
    tr['AF26'] = '=Z26*AD26'
    tr['O30'] = '=SUM(O26:O29)'
    tr['AF30'] = '=SUM(AF26:AF29)'
    tr['AE50'] = '=O30+AF30'
    tr['AE51'] = '=SUM(AF33:AF48)'
    tr['AE53'] = '=AE50+AE51-AE52'
    tr.page_setup.orientation = 'portrait'
    tr.page_setup.paperSize = 9
    tr.sheet_properties.pageSetUpPr.fitToPage = True
    tr.page_setup.fitToWidth = 1
    tr.page_setup.fitToHeight = 1
    tr.print_area = 'A1:AJ54'
    ex.print_area = 'A1:N31'
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def children(el, tag):
    return [c for c in el if c.tag == q(tag)]


def merge(tpl_path: str, form_bytes: bytes, out_path: str):
    za = zipfile.ZipFile(tpl_path)
    zb = zipfile.ZipFile(io.BytesIO(form_bytes))
    files = {n: za.read(n) for n in za.namelist()}

    sa = etree.fromstring(files['xl/styles.xml'])
    sb = etree.fromstring(zb.read('xl/styles.xml'))

    # 表示形式
    fa = sa.find(q('numFmts'))
    if fa is None:
        fa = etree.Element(q('numFmts'))
        sa.insert(0, fa)
    have = {nf.get('formatCode'): int(nf.get('numFmtId')) for nf in fa}
    next_id = max([163] + list(have.values())) + 1
    nf_map = {}
    fb = sb.find(q('numFmts'))
    for nf in (fb if fb is not None else []):
        code, old = nf.get('formatCode'), int(nf.get('numFmtId'))
        if code in have:
            nf_map[old] = have[code]
        else:
            el = etree.SubElement(fa, q('numFmt'))
            el.set('numFmtId', str(next_id))
            el.set('formatCode', code)
            have[code] = next_id
            nf_map[old] = next_id
            next_id += 1
    fa.set('count', str(len(fa)))

    def append_all(tag_list, tag_item):
        a, b = sa.find(q(tag_list)), sb.find(q(tag_list))
        off = len(children(a, tag_item))
        for it in children(b, tag_item):
            a.append(copy.deepcopy(it))
        a.set('count', str(len(children(a, tag_item))))
        return off

    off_font = append_all('fonts', 'font')
    off_fill = append_all('fills', 'fill')
    off_border = append_all('borders', 'border')
    xa, xb = sa.find(q('cellXfs')), sb.find(q('cellXfs'))
    off_xf = len(children(xa, 'xf'))
    for xf in children(xb, 'xf'):
        n = copy.deepcopy(xf)
        nid = int(n.get('numFmtId', '0'))
        n.set('numFmtId', str(nf_map.get(nid, nid)))
        n.set('fontId', str(int(n.get('fontId', '0')) + off_font))
        n.set('fillId', str(int(n.get('fillId', '0')) + off_fill))
        n.set('borderId', str(int(n.get('borderId', '0')) + off_border))
        n.set('xfId', '0')
        xa.append(n)
    xa.set('count', str(len(children(xa, 'xf'))))
    files['xl/styles.xml'] = etree.tostring(sa, xml_declaration=True, encoding='UTF-8', standalone=True)

    # ブックにシートを足す
    wa = etree.fromstring(files['xl/workbook.xml'])
    ra = etree.fromstring(files['xl/_rels/workbook.xml.rels'])
    ca = etree.fromstring(files['[Content_Types].xml'])
    wbb = etree.fromstring(zb.read('xl/workbook.xml'))
    rbb = etree.fromstring(zb.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'): r.get('Target') for r in rbb}
    sheets_a = wa.find(q('sheets'))
    defined_a = wa.find(q('definedNames'))
    n_sheets = len(sheets_a)
    used_rids = {r.get('Id') for r in ra}
    for i, sh in enumerate(wbb.find(q('sheets'))):
        idx = n_sheets + 1 + i
        src = targets[sh.get(f'{{{R_NS}}}id')].lstrip('/')
        x = etree.fromstring(zb.read(src))
        for c in x.iter(q('c'), q('row')):
            if c.get('s') is not None:
                c.set('s', str(int(c.get('s')) + off_xf))
        for c in x.iter(q('col')):
            if c.get('style') is not None:
                c.set('style', str(int(c.get('style')) + off_xf))
        part = f'xl/worksheets/sheet{idx}.xml'
        files[part] = etree.tostring(x, xml_declaration=True, encoding='UTF-8', standalone=True)
        rid = f'rIdX{idx}'
        assert rid not in used_rids
        rel = etree.SubElement(ra, f'{{{PKG_REL}}}Relationship')
        rel.set('Type', WS_TYPE)
        rel.set('Target', f'/{part}')
        rel.set('Id', rid)
        s = etree.SubElement(sheets_a, q('sheet'))
        s.set('name', sh.get('name'))
        s.set('sheetId', str(idx))
        s.set('state', 'visible')
        s.set(f'{{{R_NS}}}id', rid)
        ov = etree.SubElement(ca, f'{{{CT_NS}}}Override')
        ov.set('PartName', f'/{part}')
        ov.set('ContentType', WS_CT)
        # 印刷範囲
        dfb = wbb.find(q('definedNames'))
        for dn in (dfb if dfb is not None else []):
            if dn.get('localSheetId') == str(i):
                n = copy.deepcopy(dn)
                n.set('localSheetId', str(idx - 1))
                defined_a.append(n)
    files['xl/workbook.xml'] = etree.tostring(wa, xml_declaration=True, encoding='UTF-8', standalone=True)
    files['xl/_rels/workbook.xml.rels'] = etree.tostring(ra, xml_declaration=True, encoding='UTF-8', standalone=True)
    files['[Content_Types].xml'] = etree.tostring(ca, xml_declaration=True, encoding='UTF-8', standalone=True)

    # 印刷範囲が workbook.xml にない書き方（openpyxl はシート側に持つことがある）でも困らないようにそのまま
    order = [n for n in za.namelist()] + sorted(n for n in files if n not in za.namelist())
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zo:
        for n in order:
            zo.writestr(n, files[n])


if __name__ == '__main__':
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    merge(sys.argv[1], clean_form(sys.argv[2]), sys.argv[3])
    print('ok', sys.argv[3])
