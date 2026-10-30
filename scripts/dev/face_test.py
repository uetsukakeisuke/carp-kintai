from playwright.sync_api import sync_playwright
import re
BASE='http://127.0.0.1:3100'; SP='/tmp/claude-0/-home-claude/20c525ae-8887-5652-81f4-9c6d1abadba7/scratchpad'
res=[]
def ok(n,c,x=''): res.append(c); print('PASS' if c else 'FAIL', n, x, flush=True)
def keypad(pg,d):
    for ch in d: pg.locator('.keypad button', has_text=re.compile(f'^{ch}$')).first.click()
def ctx(b,w=390,h=844):
    c=b.new_context(viewport={'width':w,'height':h},timezone_id='Asia/Tokyo'); c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css')); return c
def face_file(pg, f):
    pg.wait_for_selector('[data-testid=face-file]', state='attached', timeout=20000)
    pg.set_input_files('[data-testid=face-file]', SP+'/'+f)
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    a=ctx(b,1300,900).new_page(); a.on('pageerror',lambda e: errs.append(str(e)))
    a.goto(BASE+'/login'); a.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(a,'1111'); a.wait_for_url(re.compile('/manage/'))
    a.goto(BASE+'/manage/staff'); a.wait_for_load_state('networkidle')
    a.locator('tr', has_text='井上 朝日').locator('button', has_text='顔').click(); a.wait_for_selector('.consent')
    ok('同意にチェックしないと撮れない', a.locator('button', has_text='カメラで顔を写す').is_disabled())
    a.check('.consent input'); a.click('button:has-text("カメラで顔を写す")')
    face_file(a,'face0.jpg'); a.wait_for_selector('.toast', timeout=90000)
    ok('顔を登録できる', '登録しました' in a.inner_text('.toast'), a.inner_text('.toast'))
    a.reload(); ok('一覧に登録済みと出る', '登録済み' in a.locator('tr', has_text='井上 朝日').inner_text())
    # スタッフのスマホ打刻
    s=ctx(b).new_page(); s.on('pageerror',lambda e: errs.append(str(e)))
    s.goto(BASE+'/login'); s.locator('.namegrid button',has_text='井上 朝日').click(); s.wait_for_url('**/me/punch')
    s.click('.pbtn.p-in'); keypad(s,'1111')
    face_file(s,'face1.jpg'); s.wait_for_selector('.toast', timeout=90000); t=s.inner_text('.toast')
    ok('本人の顔なら「本人確認OK」で記録', '本人確認OK' in t, t)
    s.wait_for_timeout(800)
    s.click('.pbtn.p-break_start'); keypad(s,'1111')
    face_file(s,'face2.jpg'); s.wait_for_selector('.toast >> text=一致しなかった', timeout=90000); t=s.inner_text('.toast')
    ok('別人の顔なら記録はされ「要確認」', '一致しなかった' in t and '記録しました' in t, t)
    s.wait_for_timeout(800)
    s.click('.pbtn.p-break_end'); keypad(s,'1111'); s.wait_for_selector('text=写真なしで打刻')
    s.click('text=写真なしで打刻'); s.wait_for_selector('.toast >> text=写真なし', timeout=30000)
    ok('写真なしでも打刻でき「要確認」', '写真なし' in s.inner_text('.toast'))
    s.screenshot(path=SP+'/at/face_punch.png')
    # 顔を登録していない人は今までどおり
    o=ctx(b).new_page(); o.goto(BASE+'/login'); o.locator('.namegrid button',has_text='大西 希望').click(); o.wait_for_url('**/me/punch')
    o.click('.pbtn.p-in'); keypad(o,'1111'); o.wait_for_selector('.toast')
    ok('顔を登録していない人は顔なしでそのまま打刻', '記録しました' in o.inner_text('.toast') and o.locator('.facecap').count()==0)
    # 管理者の勤怠実績
    a.goto(BASE+'/manage/attendance'); a.wait_for_load_state('networkidle')
    row=a.locator('table.dense tbody tr', has_text='井上 朝日')
    ok('勤怠実績に「顔 要確認」と出る', '顔 要確認' in row.inner_text() and '顔なし' in row.inner_text(), row.inner_text().replace('\n',' '))
    ok('顔の確認が必要な打刻の案内が出る', a.locator('.banner', has_text='顔の確認が必要な打刻').count()==1)
    # 店舗端末
    a.goto(BASE+'/manage/settings'); a.click('button:has-text("この端末を店舗端末にする")'); a.wait_for_url('**/terminal')
    a.locator('.tcard', has_text='井上 朝日').click(); keypad(a,'1111'); a.wait_for_selector('.modal .pbtns')
    a.click('.modal .pbtn.p-out'); face_file(a,'face1.jpg'); a.wait_for_selector('.toast', timeout=90000); t=a.inner_text('.toast')
    ok('店舗端末でも顔で本人確認して打刻', '本人確認OK' in t, t)
    ok('JSエラーなし', not errs, ';'.join(errs)[:300])
    b.close()
print('RESULT',sum(res),'/',len(res))
