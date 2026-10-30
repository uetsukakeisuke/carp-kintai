from playwright.sync_api import sync_playwright
import re
BASE='http://127.0.0.1:3100'; SP='/tmp/claude-0/-home-claude/20c525ae-8887-5652-81f4-9c6d1abadba7/scratchpad'
res=[]
def ok(n,c,x=''): res.append(c); print('PASS' if c else 'FAIL', n, x, flush=True)
def keypad(pg,d):
    for ch in d: pg.locator('.keypad button', has_text=re.compile(f'^{ch}$')).first.click()
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    for w,h,tag in [(390,844,'sp'),(1300,900,'pc')]:
        c=b.new_context(viewport={'width':w,'height':h},timezone_id='Asia/Tokyo'); c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
        a=c.new_page(); a.on('pageerror',lambda e: errs.append(str(e)))
        a.goto(BASE+'/login'); a.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(a,'1111'); a.wait_for_url(re.compile('/manage/'))
        if tag=='sp':
            a.goto(BASE+'/manage/attendance'); a.wait_for_load_state('networkidle')
            a.fill('input[name=d]','2026-10-16'); a.click('form button:has-text("表示")'); a.wait_for_load_state('networkidle'); a.wait_for_timeout(500)
            ok('日付を選んで2週間より前の日も開ける', '10/16' in a.inner_text('body'))
            row=a.locator('table.dense tbody tr', has_text='増田 馨')
            ok('退勤の打刻なしと表示', '退勤の打刻なし' in row.inner_text())
            row.locator('button', has_text='直す').click(); a.wait_for_selector('.modal')
            a.screenshot(path=SP+'/at/pe_open.png')
            # 退勤を足す（最後の打刻の次＝退勤）
            a.click('.modal >> text=＋ 打刻を足す'); a.wait_for_timeout(200)
            last=a.locator('.pe-row').last
            ok('足した打刻は退勤になる', last.locator('select').nth(0).input_value()=='out')
            last.locator('select').nth(1).select_option('20'); last.locator('select').nth(2).select_option('10')
            a.fill('#peR','閉店作業のあと押し忘れ'); a.screenshot(path=SP+'/at/pe_edit.png')
            a.click('.modal button.primary'); a.wait_for_selector('.toast'); a.wait_for_timeout(1200)
            row=a.locator('table.dense tbody tr', has_text='増田 馨')
            ok('保存すると退勤済みになり、修正済みと出る', '退勤済み' in row.inner_text() and '修正済み' in row.inner_text() and '20:10' in row.inner_text(), row.inner_text().replace('\n',' '))
            # 順番の誤り
            row.locator('button', has_text='直す').click(); a.wait_for_selector('.modal')
            first=a.locator('.pe-row').first; first.locator('select').nth(0).select_option('out')
            ok('順番が正しくないと保存できない', a.locator('.modal .err').count()==1 and a.locator('.modal button.primary').is_disabled())
            a.click('.modal >> text=キャンセル')
        else:
            a.goto(BASE+'/manage/attendance'); a.wait_for_load_state('networkidle')
            # 出勤時刻を直す（修正前が残る）
            a.goto(BASE+'/manage/attendance?d=2026-10-29'); a.wait_for_load_state('networkidle'); r=a.locator('table.dense tbody tr').filter(has=a.locator('.lg')).first
            nm=r.locator('td.head').inner_text()
            r.locator('button', has_text='直す').click(); a.wait_for_selector('.modal')
            f=a.locator('.pe-row').first; before=f.locator('select').nth(1).input_value()+':'+f.locator('select').nth(2).input_value()
            f.locator('select').nth(2).select_option('0'); a.click('.modal button.primary'); a.wait_for_selector('.toast'); a.wait_for_timeout(1200)
            r=a.locator('table.dense tbody tr', has_text=nm)
            ed=r.locator('.ed').first
            ok('時刻を直すと修正前の時刻が記録に残る', ed.count()==1 and '修正前' in (ed.get_attribute('title') or ''), (ed.get_attribute('title') or '') + ' / before ' + before)
            # 予定にない人の勤務を入れる
            card=a.locator('.card', has_text='予定にない人の勤務を入れる')
            if card.count():
                opt=card.locator('select option').nth(1).inner_text()
                card.locator('select').select_option(label=opt); a.wait_for_timeout(400); card.locator('button', has_text='勤務を入れる').click(); a.wait_for_selector('.modal .pe-rows')
                a.locator('.modal button', has_text='＋ 打刻を足す').click(); a.wait_for_timeout(200); a.locator('.modal button', has_text='＋ 打刻を足す').click(); a.wait_for_timeout(200)
                kinds=[x.input_value() for x in a.locator('.pe-row select:first-child').all()]
                a.click('.modal button.primary'); a.wait_for_selector('.toast'); a.wait_for_timeout(1200)
                ok('予定にない人の勤務を入れられる', a.locator('table.dense tbody tr', has_text=opt).count()==1, f'{opt} {kinds}')
            a.screenshot(path=SP+'/at/pe_pc.png', full_page=True)
    ok('JSエラーなし', not errs, ';'.join(errs))
    b.close()
print('RESULT',sum(res),'/',len(res))
