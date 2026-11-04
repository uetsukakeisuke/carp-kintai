from playwright.sync_api import sync_playwright
import re, json
BASE='http://127.0.0.1:3100'; SP='/tmp/claude-0/-home-claude/20c525ae-8887-5652-81f4-9c6d1abadba7/scratchpad'
res=[]
def ok(n,c,x=''): res.append(c); print('PASS' if c else 'FAIL', n, x, flush=True)
def keypad(pg,d):
    for ch in d: pg.locator('.keypad button', has_text=re.compile(f'^{ch}$')).first.click()
def browser(p, cam):
    return p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={SP}/{cam}.y4m'])
def ctx(b, state=None):
    c=b.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Tokyo',permissions=['camera'],storage_state=state)
    c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css')); return c
errs=[]
with sync_playwright() as p:
    # 1) 管理者が会社のiPhoneを店舗端末にする → 顔パスが既定
    b=browser(p,'face1'); c=ctx(b); pg=c.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'/login'); pg.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(pg,'1111'); pg.wait_for_url(re.compile('/manage/'))
    pg.goto(BASE+'/manage/settings'); pg.click('button:has-text("この端末を店舗端末にする")'); pg.wait_for_url('**/terminal')
    pg.wait_for_selector('.fp-cam video')
    ok('店舗端末は顔パスで始まる', pg.locator('.seg a[aria-current=page]').inner_text()=='顔パス')
    # 2) 未登録の顔 → 登録をうながす
    pg.wait_for_selector('text=この端末に登録されていない顔です', timeout=90000)
    ok('登録されていない顔は「登録されていない」と出る', True)
    pg.click('button:has-text("顔を登録する")'); pg.locator('.fp-panel .tcard', has_text='井上 朝日').click()
    keypad(pg,'9999'); pg.wait_for_selector('.fp-panel .err'); ok('登録には打刻コードが必要', 'コード' in pg.inner_text('.fp-panel .err'))
    keypad(pg,'1111'); pg.wait_for_selector('.consent')
    ok('同意しないと登録できない', pg.locator('button', has_text='カメラで顔を登録').is_disabled())
    pg.check('.consent input'); pg.click('button:has-text("カメラで顔を登録")')
    pg.wait_for_selector('.fp-count', timeout=60000)
    ok('登録するとすぐ本人と判定され、自動出勤のカウントダウン', '秒後に出勤' in pg.inner_text('.fp-card'), pg.inner_text('.fp-card').replace('\n',' '))
    pg.screenshot(path=SP+'/at/fp_count.png')
    pg.wait_for_selector('.fp-done', timeout=15000); t=pg.inner_text('.fp-done')
    ok('3秒後に自動で出勤を記録', '出勤' in t and '記録しました' in t, t)
    pg.screenshot(path=SP+'/at/fp_done.png')
    state=c.storage_state(); b.close()
    # 3) 同じ人の別の写真（別の日のイメージ）→ 勤務中なのでボタン
    b=browser(p,'face0'); c=ctx(b,state); pg=c.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'/terminal'); pg.wait_for_selector('.fp-card .fp-btns', timeout=90000)
    card=pg.inner_text('.fp-card')
    ok('登録済みの人は立つだけで本人と判定（別の写真でも）', '井上 朝日さん' in card, card.replace('\n',' '))
    ok('勤務中なら自動出勤せず、休憩・退勤ボタンが出る', pg.locator('.fp-card .fp-count').count()==0 and pg.locator('.fp-btns .pbtn.p-out').count()==1)
    pg.screenshot(path=SP+'/at/fp_btns.png')
    pg.click('.fp-btns .pbtn.p-out'); pg.wait_for_selector('.fp-done', timeout=15000); t=pg.inner_text('.fp-done')
    ok('退勤ボタンで退勤（本人確認OK）', '退勤' in t and '本人確認OK' in t, t)
    state=c.storage_state(); b.close()
    # 4) 退勤したあとに前を通っても自動で出勤しない
    b=browser(p,'face0'); c=ctx(b,state); pg=c.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'/terminal'); pg.wait_for_selector('.fp-card .fp-btns', timeout=90000)
    ok('退勤後は自動で出勤せず「もう一度出勤」ボタンだけ', pg.locator('.fp-count').count()==0 and 'もう一度出勤' in pg.inner_text('.fp-btns'))
    pg.click('button:has-text("閉じる")'); pg.wait_for_timeout(500)
    ok('閉じるとカメラの待ち受けに戻る', pg.locator('.fp-card').count()==0)
    b.close()
    # 5) 別人（未登録）は井上さんと間違えない
    b=browser(p,'face2'); c=ctx(b,state); pg=c.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'/terminal'); pg.wait_for_selector('text=この端末に登録されていない顔です', timeout=90000)
    ok('別人を登録済みの人と間違えない', pg.locator('.fp-card').count()==0)
    # 6) 別人を大西さんとして登録 → カウントダウン中に「やめる」→ 打刻されない
    pg.click('button:has-text("顔を登録する")'); pg.locator('.fp-panel .tcard', has_text='大西 希望').click(); keypad(pg,'1111'); pg.check('.consent input'); pg.click('button:has-text("カメラで顔を登録")')
    pg.wait_for_selector('.fp-count', timeout=60000); pg.click('button:has-text("やめる")'); pg.wait_for_timeout(4500)
    ok('カウントダウン中に「やめる」と打刻しない', pg.locator('.fp-done').count()==0)
    # 7) 名前を選ぶ方式にも切り替えられる
    pg.click('.seg a:has-text("名前を選ぶ")'); ok('名前を選ぶ方式に切り替えられる', pg.locator('.termgrid .tcard').count()>=10)
    pg.reload(); pg.wait_for_load_state('networkidle'); ok('切り替えを端末が覚えている', pg.locator('.seg a[aria-current=page]').inner_text()=='名前を選ぶ')
    b.close()
    # 8) 管理者の勤怠実績
    b=p.chromium.launch(); c=ctx(b); a=c.new_page()
    a.goto(BASE+'/login'); a.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(a,'1111'); a.wait_for_url(re.compile('/manage/'))
    a.goto(BASE+'/manage/attendance'); a.wait_for_load_state('networkidle')
    r1=a.locator('table.dense tbody tr', has_text='井上 朝日').inner_text(); r2=a.locator('table.dense tbody tr', has_text='大西 希望').inner_text() if a.locator('table.dense tbody tr', has_text='大西 希望').count() else ''
    ok('勤怠実績：井上さんは出勤（顔を登録）と退勤', '顔を登録' in r1 and '退勤' in r1, r1.replace('\n',' '))
    ok('勤怠実績：大西さんは打刻なし（やめたので）', '出勤 ' not in r2, r2.replace('\n',' '))
    b.close()
ok('JSエラーなし', not errs, ';'.join(errs)[:300])
print('RESULT',sum(res),'/',len(res))
