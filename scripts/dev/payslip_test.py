from playwright.sync_api import sync_playwright
import re, base64, json
BASE='http://127.0.0.1:3100'; SP='/tmp/claude-0/-home-claude/20c525ae-8887-5652-81f4-9c6d1abadba7/scratchpad'
res=[]
def ok(n,c,x=''): res.append(c); print('PASS' if c else 'FAIL', n, x, flush=True)
def keypad(pg,d):
    for ch in d: pg.locator('.keypad button', has_text=re.compile(f'^{ch}$')).first.click()
def ctx(b,w=390,h=844):
    c=b.new_context(viewport={'width':w,'height':h},timezone_id='Asia/Tokyo'); c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css')); return c
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    a=ctx(b,1300,900).new_page(); a.on('pageerror',lambda e: errs.append(str(e)))
    a.goto(BASE+'/login'); a.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(a,'1111'); a.wait_for_url(re.compile('/manage/'))
    a.goto(BASE+'/manage/payslips'); a.wait_for_load_state('networkidle')
    code=a.inner_text('.codebox pre'); m=re.search(r"const SECRET = '([^']+)'", code); secret=m.group(1) if m else ''
    ok('Gmail用スクリプトに合言葉とURLが入っている', bool(secret) and '/api/payslips/import' in code)
    pdf9=base64.b64encode(open(SP+'/pay/202609.pdf','rb').read()).decode()
    body={'messageId':'msg-aug','subject':'給与明細のご送付','date':'2026-09-05T02:00:00Z','files':[{'name':'202609-給与支給明細書.pdf','base64':pdf9}]}
    r=a.request.post(BASE+'/api/payslips/import', data=json.dumps(body), headers={'content-type':'application/json','x-import-secret':'wrong'})
    ok('合言葉が違うと受け付けない', r.status==401, str(r.status))
    r=a.request.post(BASE+'/api/payslips/import', data=json.dumps(body), headers={'content-type':'application/json','x-import-secret':secret})
    j=r.json(); ok('Gmailからの取り込み（8月分19人）', r.status==200 and j['slips']==19, json.dumps(j,ensure_ascii=False))
    r=a.request.post(BASE+'/api/payslips/import', data=json.dumps(body), headers={'content-type':'application/json','x-import-secret':secret})
    ok('同じメールは二重に取り込まない', r.json().get('duplicate')==True)
    ich=base64.b64encode(open(SP+'/pay/202610_ichiran.pdf','rb').read()).decode()
    r=a.request.post(BASE+'/api/payslips/import', data=json.dumps({'messageId':'msg-list','files':[{'name':'一覧表.pdf','base64':ich}]}), headers={'content-type':'application/json','x-import-secret':secret})
    ok('明細以外のPDFは取り込まない', r.status==422, r.text()[:120])
    # 手動アップロード（9月分）
    a.goto(BASE+'/manage/payslips'); a.wait_for_load_state('networkidle')
    a.set_input_files('input[type=file]', SP+'/pay/202610_meisai.pdf'); a.click('button:has-text("取り込む")'); a.wait_for_selector('.toast', timeout=30000)
    t=a.inner_text('.toast'); ok('PDFを手で取り込める（9月分13人）', '13人分' in t, t)
    a.reload(); a.wait_for_load_state('networkidle')
    ok('「結びつかない明細」の欄は出ない', a.locator('text=結びつかない明細').count()==0)
    a.goto(BASE+'/manage/payslips?ym=2026-08'); a.wait_for_load_state('networkidle')
    names=a.locator('tbody td.head').all_inner_texts()
    ok('8月分は登録している人だけ表示（退職者は出ない）', len(names)>0 and not any('岡' in n or '三浦' in n for n in names), ','.join(names))
    a.goto(BASE+'/manage/payslips?ym=2026-09'); a.wait_for_load_state('networkidle')
    ok('9月分の一覧に井上さんの差引¥43,913', '¥43,913' in a.locator('tr', has_text='井上 朝日').inner_text())
    a.screenshot(path=SP+'/at/ps_admin.png', full_page=True)
    # スタッフ：初回に暗証番号を決める
    s=ctx(b).new_page(); s.on('pageerror',lambda e: errs.append(str(e)))
    s.goto(BASE+'/login'); s.locator('.namegrid button',has_text='井上 朝日').click(); s.wait_for_url('**/me/**')
    s.goto(BASE+'/me/payslips'); s.wait_for_load_state('networkidle')
    ok('初回は暗証番号を決める画面', '暗証番号（4桁）を決めて' in s.inner_text('body'))
    keypad(s,'1111'); keypad(s,'1111'); s.wait_for_selector('.err')
    ok('1111は使えない', '使えません' in s.inner_text('.err'))
    keypad(s,'2580'); keypad(s,'2580'); s.wait_for_selector('.slip', timeout=15000)
    ok('決めるとすぐ明細が見られる（9月分・手取り¥43,913）', '¥43,913' in s.inner_text('.slip-net') and '9月分' in s.inner_text('.slip-head'))
    ok('過去の明細も選べる（8月分）', s.locator('.slipmonth', has_text='8月分').count()==1)
    s.screenshot(path=SP+'/at/ps_staff.png', full_page=True)
    s.click('text=明細を閉じる'); s.wait_for_selector('.keypad')
    ok('閉じると暗証番号が必要', '暗証番号を入れて' in s.inner_text('body'))
    for i in range(5): keypad(s,'9999'); s.wait_for_timeout(500)
    ok('5回間違えるとロック', 'しばらく開けません' in s.inner_text('body') or 'ロック' in s.inner_text('body') or '開けません' in s.inner_text('body'))
    # 他の人の明細は見えない
    slip_id = re.search(r'id=(\d+)', a.locator('tr', has_text='井上 朝日').locator('a').get_attribute('href')).group(1)
    o=ctx(b).new_page(); o.goto(BASE+'/login'); o.locator('.namegrid button',has_text='大西 希望').click(); o.wait_for_url('**/me/**')
    o.goto(BASE+'/me/payslips'); keypad(o,'3691'); keypad(o,'3691'); o.wait_for_selector('.slip')
    o.goto(BASE+f'/me/payslips?id={slip_id}'); o.wait_for_selector('.slip')
    ok('他人の明細IDを指定しても自分の明細しか出ない', '大西' in o.inner_text('.slip-name') and '井上' not in o.inner_text('.slip'), o.inner_text('.slip-name'))
    r=o.request.get(BASE+'/manage/payslips?id='+slip_id); ok('スタッフは管理側の明細ページに入れない', '/manage/payslips' not in r.url, r.url)
    ok('JSエラーなし', not errs, ';'.join(errs))
    b.close()
print('RESULT',sum(res),'/',len(res))
