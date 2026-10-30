from playwright.sync_api import sync_playwright
import re, datetime
BASE='http://127.0.0.1:3100'; SP='/tmp/claude-0/-home-claude/20c525ae-8887-5652-81f4-9c6d1abadba7/scratchpad'
res=[]
def ok(n,c,x=''): res.append(c); print('PASS' if c else 'FAIL', n, x, flush=True)
def keypad(pg,d):
    for ch in d: pg.locator('.keypad button', has_text=re.compile(f'^{ch}$')).first.click()
def ctx(b,w=390,h=844):
    c=b.new_context(viewport={'width':w,'height':h},timezone_id='Asia/Tokyo'); c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css')); return c
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    # Aさん（見る人）
    v=ctx(b).new_page(); v.on('pageerror',lambda e: errs.append(str(e)))
    v.goto(BASE+'/login'); v.locator('.namegrid button',has_text='山口 利珠').click(); v.wait_for_url('**/me/punch')
    n0=int(v.locator('.now-n').inner_text())
    ok('打刻画面に「いま出勤中」が出る', v.locator('.nowcard').count()==1, f'{n0}人')
    # Bさんが出勤
    w=ctx(b).new_page(); w.goto(BASE+'/login'); w.locator('.namegrid button',has_text='吉村 優太').click(); w.wait_for_url('**/me/punch')
    w.click('.pbtn.p-in'); keypad(w,'1111'); w.locator('button', has_text='顔なしで打刻').first.click(); w.wait_for_selector('.toast')
    # Aさんの画面：再読み込みせずに更新される（30秒以内）
    v.wait_for_function("() => [...document.querySelectorAll('.now-list li')].some(li => li.innerText.includes('吉村 優太'))", timeout=40000)
    ok('他の人が出勤すると、再読み込みなしで一覧に出る', True, v.locator('.now-n').inner_text()+'人')
    w.wait_for_timeout(800); w.click('.pbtn.p-break_start'); keypad(w,'1111'); w.locator('button', has_text='顔なしで打刻').first.click(); w.wait_for_selector('.toast >> text=休憩開始')
    v.evaluate("window.dispatchEvent(new Event('focus'))"); v.wait_for_timeout(1500)
    ok('休憩中と表示される', '休憩中' in v.locator('.now-list li', has_text='吉村 優太').inner_text())
    ok('時給・人件費は出ない', '¥' not in v.inner_text('.nowcard'))
    v.screenshot(path=SP+'/at/now_sp.png', full_page=True)
    # 管理者の勤怠実績（今日）にも出る
    a=ctx(b,1300,900).new_page(); a.goto(BASE+'/login'); a.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(a,'1111'); a.wait_for_url(re.compile('/manage/'))
    a.goto(BASE+'/manage/attendance'); a.wait_for_load_state('networkidle')
    ok('管理者の勤怠実績（今日）にも出る', a.locator('.nowcard', has_text='吉村 優太').count()==1)
    r=v.request.get(BASE+'/api/now'); ok('ログインしていないと見られない', ctx(b).request.get(BASE+'/api/now').status==401)
    ok('JSエラーなし', not errs, ';'.join(errs))
    b.close()
print('RESULT',sum(res),'/',len(res))
