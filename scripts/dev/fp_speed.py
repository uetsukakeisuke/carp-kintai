from playwright.sync_api import sync_playwright
import re, time
BASE='http://127.0.0.1:3100'; SP='/tmp/claude-0/-home-claude/20c525ae-8887-5652-81f4-9c6d1abadba7/scratchpad'
def keypad(pg,d):
    for ch in d: pg.locator('.keypad button', has_text=re.compile(f'^{ch}$')).first.click()
def browser(p, cam):
    return p.chromium.launch(args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',f'--use-file-for-fake-video-capture={SP}/{cam}.y4m'])
def ctx(b, state=None):
    c=b.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Tokyo',permissions=['camera'],storage_state=state); c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css')); return c
with sync_playwright() as p:
    b=browser(p,'face1'); c=ctx(b); pg=c.new_page()
    pg.goto(BASE+'/login'); pg.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(pg,'1111'); pg.wait_for_url(re.compile('/manage/'))
    pg.goto(BASE+'/manage/settings'); pg.click('button:has-text("この端末を店舗端末にする")'); pg.wait_for_url('**/terminal')
    pg.click('button:has-text("はじめての方")'); pg.locator('.fp-panel .tcard', has_text='吉村 優太').click(); keypad(pg,'1111'); pg.check('.consent input'); pg.click('button:has-text("カメラで顔を登録")')
    pg.wait_for_selector('.fp-count', timeout=90000); pg.click('button:has-text("すぐ出勤")'); pg.wait_for_selector('.fp-done')
    state=c.storage_state(); b.close()
    # 顔が2秒映って2秒消えるカメラで、打刻→離れる→戻る
    b=browser(p,'alt'); c=ctx(b,state); pg=c.new_page()
    pg.goto(BASE+'/terminal'); pg.wait_for_selector('.fp-speed', timeout=90000)
    t0=time.time(); pg.wait_for_selector('.fp-card .fp-btns', timeout=30000); print('準備完了→本人の画面: %.2f秒' % (time.time()-t0), '/', pg.inner_text('.fp-speed'))
    pg.click('.fp-btns .pbtn.p-break_start'); pg.wait_for_selector('.fp-done'); t1=time.time()
    pg.wait_for_selector('.fp-card .fp-btns', timeout=30000); print('打刻してから、離れて戻ったときに再び画面が出るまで: %.2f秒（映像は2秒ごとに顔が出入り）' % (time.time()-t1))
    print('ボタン:', pg.inner_text('.fp-btns').replace('\n',' / '))
    b.close()
