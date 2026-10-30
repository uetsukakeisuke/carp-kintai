"""通信が切れたときに「保存されたように見えて実は保存されていない」ことが起きないかの確認"""
from playwright.sync_api import sync_playwright
import re, datetime
BASE='http://127.0.0.1:3100'
res=[]
def ok(n,c,x=''): res.append(c); print('PASS' if c else 'FAIL', n, x, flush=True)
def keypad(pg,d):
    for ch in d: pg.locator('.keypad button', has_text=re.compile(f'^{ch}$')).first.click()
today=datetime.date.today()
nm=(today.replace(day=1)+datetime.timedelta(days=62)).replace(day=1); ym=nm.strftime('%Y-%m')
def block(route):
    if route.request.method=='POST': route.abort()
    else: route.continue_()
with sync_playwright() as p:
    b=p.chromium.launch()
    c=b.new_context(viewport={'width':1300,'height':900},timezone_id='Asia/Tokyo'); c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    pg=c.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto(BASE+'/login'); pg.locator('.namegrid button',has_text='上塚 佳祐').click(); keypad(pg,'1111'); pg.wait_for_url(re.compile('/manage/'))
    pg.goto(f'{BASE}/manage/shifts?ym={ym}'); pg.wait_for_load_state('networkidle')
    n0=pg.locator('.chip').count()
    # 1) 通信を切った状態でシフトを保存
    pg.route('**/manage/shifts**', block)
    pg.get_by_label(f'佐藤 美咲 {nm.month}月5日').click(); pg.wait_for_selector('.modal')
    pg.locator('.pats button').first.click(); pg.click('.modal button.primary')
    pg.wait_for_selector('.toast'); t=pg.inner_text('.toast')
    ok('通信できないと「保存されていません」と出る', '保存されていません' in t, t)
    pg.wait_for_timeout(500)
    ok('画面のシフトも元に戻る（保存されたように見えない）', pg.locator('.chip').count()==n0, f'{n0} -> {pg.locator(".chip").count()}')
    ok('保存済みの表示に戻る', '保存済み' in pg.inner_text('.savestate'))
    # 2) 通信を戻して保存 → 再読み込みしても残る
    pg.unroute('**/manage/shifts**', block)
    pg.get_by_label(f'佐藤 美咲 {nm.month}月5日').click(); pg.wait_for_selector('.modal')
    pg.locator('.pats button').first.click(); pg.click('.modal button.primary'); pg.wait_for_timeout(1500)
    pg.reload(); pg.wait_for_load_state('networkidle')
    ok('通信が戻れば保存され、再読み込みしても残る', pg.locator('.chip').count()==n0+1, f'{n0} -> {pg.locator(".chip").count()}')
    # 3) スタッフの打刻・希望提出も同様
    s=b.new_context(viewport={'width':390,'height':844},timezone_id='Asia/Tokyo'); s.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    sp=s.new_page(); sp.on('pageerror',lambda e: errs.append(str(e)))
    sp.goto(BASE+'/login'); sp.locator('.namegrid button',has_text='山本 葵').click(); sp.wait_for_url('**/me/**')
    sp.goto(BASE+'/me/punch'); sp.wait_for_load_state('networkidle')
    sp.route('**/me/punch**', block)
    sp.click('.pbtn.p-in'); keypad(sp,'1111'); sp.wait_for_selector('.modal .err')
    ok('打刻：通信できないと記録されていないと出る', '保存されていません' in sp.inner_text('.modal .err'))
    sp.unroute('**/me/punch**', block)
    sp.goto(f'{BASE}/me/hopes?ym={ym}'); sp.wait_for_load_state('networkidle')
    sp.route('**/me/hopes**', block)
    sp.locator('.addbtn').nth(1).click(); sp.click('text=希望を提出する'); sp.wait_for_selector('.toast')
    ok('希望：通信できないと保存されていないと出る', '保存されていません' in sp.inner_text('.toast'))
    ok('希望：未保存の変更があると表示', 'まだ保存していない' in sp.inner_text('.submitbar'))
    ok('JSエラーなし', not errs, ';'.join(errs))
    b.close()
print('RESULT',sum(res),'/',len(res))
