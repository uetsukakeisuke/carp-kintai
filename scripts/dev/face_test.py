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
def toast(pg, needle):
    pg.wait_for_selector(f'.toast >> text={needle}', timeout=90000); t=pg.inner_text('.toast'); pg.wait_for_timeout(600); return t
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    s=ctx(b).new_page(); s.on('pageerror',lambda e: errs.append(str(e)))
    s.goto(BASE+'/login'); s.locator('.namegrid button',has_text='井上 朝日').click(); s.wait_for_url('**/me/punch')
    s.click('.pbtn.p-in'); keypad(s,'1111'); s.wait_for_selector('.consent')
    ok('はじめての端末では、本人が顔を登録する画面が出る', 'この端末で、はじめに自分の顔を登録します' in s.inner_text('.modal'))
    ok('同意しないと登録できない', s.locator('button', has_text='顔を登録して打刻').is_disabled())
    s.screenshot(path=SP+'/at/face_reg.png')
    s.check('.consent input'); s.click('button:has-text("顔を登録して打刻")'); face_file(s,'face0.jpg')
    ok('顔を登録して打刻できる（上塚の操作なし）', 'この端末に顔を登録しました' in toast(s,'記録しました'))
    s.click('.pbtn.p-break_start'); keypad(s,'1111'); face_file(s,'face1.jpg')
    ok('次からはこの端末の顔と照合（本人→OK）', '本人確認OK' in toast(s,'本人確認OK'))
    s.click('.pbtn.p-break_end'); keypad(s,'1111'); face_file(s,'face2.jpg')
    ok('別人なら記録して要確認', '一致しなかった' in toast(s,'一致しなかった'))
    s.click('.pbtn.p-out'); keypad(s,'1111'); s.wait_for_selector('text=顔なしで打刻'); s.click('text=顔なしで打刻')
    ok('顔なしでも打刻でき要確認', '顔なし' in toast(s,'顔なしのため'))
    s.click('.pbtn.p-in'); keypad(s,'1111'); s.click('text=この端末の顔を登録し直す'); s.check('.consent input'); s.click('button:has-text("顔を登録して打刻")'); face_file(s,'face2.jpg')
    ok('登録し直せる（店長に伝わる）', '登録し直しました' in toast(s,'登録し直しました'))
    s.goto(BASE+'/me/settings'); s.wait_for_load_state('networkidle')
    ok('設定にこの端末の顔の登録が出て、消せる', 'に登録' in s.inner_text('body') and s.locator('button', has_text='消す').count()==1)
    # 別の端末は独立
    s2=ctx(b).new_page(); s2.goto(BASE+'/login'); s2.locator('.namegrid button',has_text='井上 朝日').click(); s2.wait_for_url('**/me/punch')
    s2.click('.pbtn.p-out'); keypad(s2,'1111'); s2.wait_for_selector('.consent')
    ok('別の端末ではその端末で改めて登録（端末ごとに独立）', 'はじめに自分の顔を登録' in s2.inner_text('.modal'))
    # 管理者
    a=ctx(b,1300,900).new_page(); a.on('pageerror',lambda e: errs.append(str(e)))
    a.goto(BASE+'/login'); a.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(a,'1111'); a.wait_for_url(re.compile('/manage/'))
    a.goto(BASE+'/manage/staff'); a.wait_for_load_state('networkidle')
    ok('スタッフ・時給に顔の登録ボタンはない', a.locator('tr', has_text='井上 朝日').locator('button', has_text=re.compile('^顔$')).count()==0)
    a.goto(BASE+'/manage/attendance'); a.wait_for_load_state('networkidle')
    row=a.locator('table.dense tbody tr', has_text='井上 朝日').inner_text()
    ok('勤怠実績に照合結果が出る', all(x in row for x in ['顔を登録','顔 要確認','顔なし','顔を再登録']), row.replace('\n',' '))
    ok('顔の確認が必要な打刻の案内', a.locator('.banner', has_text='顔の確認が必要な打刻').count()==1)
    # 店舗端末（端末ごとに独立して登録）
    a.goto(BASE+'/manage/settings'); a.click('button:has-text("この端末を店舗端末にする")'); a.wait_for_url('**/terminal')
    a.locator('.tcard', has_text='大西 希望').click(); keypad(a,'1111'); a.wait_for_selector('.modal .pbtns')
    a.click('.modal .pbtn.p-in'); a.wait_for_selector('.consent'); a.check('.consent input'); a.click('button:has-text("顔を登録して打刻")'); face_file(a,'face1.jpg')
    ok('店舗端末でも本人がその場で登録', 'この端末に顔を登録しました' in toast(a,'記録しました'))
    a.locator('.tcard', has_text='大西 希望').click(); keypad(a,'1111'); a.wait_for_selector('.modal .pbtns')
    a.click('.modal .pbtn.p-break_start'); face_file(a,'face0.jpg')
    ok('店舗端末で次からは照合（同じ人の別写真→OK）', '本人確認OK' in toast(a,'本人確認OK'))
    ok('JSエラーなし', not errs, ';'.join(errs)[:300])
    b.close()
print('RESULT',sum(res),'/',len(res))
