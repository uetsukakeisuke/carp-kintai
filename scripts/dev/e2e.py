"""本番アプリの通しテスト（ローカルDB）"""
from playwright.sync_api import sync_playwright, expect
import re, datetime, pathlib

BASE = 'http://127.0.0.1:3100'
SP = pathlib.Path('/tmp/claude-0/-home-claude/20c525ae-8887-5652-81f4-9c6d1abadba7/scratchpad/e2e')
SP.mkdir(exist_ok=True)
results = []
def ok(name, cond, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS ' if cond else 'FAIL ') + name, extra, flush=True)

def ctx_new(b, w=390, h=844):
    c = b.new_context(viewport={'width': w, 'height': h}, timezone_id='Asia/Tokyo', accept_downloads=True)
    c.route('**/fonts.googleapis.com/**', lambda r: r.fulfill(body='', content_type='text/css'))
    return c

def keypad(pg, digits):
    for d in digits:
        pg.locator('.keypad button', has_text=re.compile(f'^{d}$')).first.click()

def login(pg, name, pin=None):
    pg.goto(BASE + '/login')
    if pg.locator('button', has_text='別の人').count(): pg.click('text=別の人')
    pg.locator('.namegrid button', has_text=name).click()
    if pin:
        pg.locator('.keypad').wait_for(); keypad(pg, pin)
    pg.wait_for_timeout(1200); pg.wait_for_load_state('networkidle')

def skipface(pg):
    pg.locator('button', has_text='顔なしで打刻').first.click()

def first_change(pg, new):
    pg.wait_for_url('**/pin')
    keypad(pg, '1111'); keypad(pg, new); keypad(pg, new)
    pg.wait_for_url(re.compile(r'/(me|manage)/'))

today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date()
nm = (today.replace(day=1) + datetime.timedelta(days=62)).replace(day=1)  # 再来月（デモの来月分は締切済みのことがある）
ym_next = nm.strftime('%Y-%m')

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1) スタッフ：初回ログイン→パスワード変更
    c = ctx_new(b); pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    login(pg, '佐藤 美咲')
    pg.wait_for_url('**/me/punch')
    ok('スタッフは名前を押すだけでログイン', pg.url.endswith('/me/punch'))
    pg.screenshot(path=str(SP / '01_punch.png'))

    # 2) 打刻：出勤→退勤→もう一度出勤→退勤
    pg.click('.pbtn.p-in'); keypad(pg, '9999'); pg.wait_for_selector('.modal .err')
    ok('打刻コードが違うと記録されない', '打刻コード' in pg.inner_text('.modal .err'))
    keypad(pg, '1111'); skipface(pg); pg.wait_for_selector('.toast')
    ok('打刻コード1111で出勤できる', '出勤' in pg.inner_text('.toast'))
    pg.wait_for_timeout(300)
    pg.click('.pbtn.p-out'); ok('退勤は打刻コードなしで顔の確認へ', pg.locator('.modal .keypad').count()==0); skipface(pg); pg.wait_for_timeout(1000)
    btn = pg.locator('.pbtn.p-in')
    ok('退勤後は「もう一度出勤」が押せる', btn.is_enabled() and 'もう一度出勤' in btn.inner_text())
    pg.screenshot(path=str(SP / '02_reclockin.png'))
    btn.click(); keypad(pg, '1111'); skipface(pg); pg.wait_for_timeout(1000)
    pg.click('.pbtn.p-out'); skipface(pg); pg.wait_for_timeout(1000)
    ok('打刻が4件記録', pg.locator('.todaylog .lg').count() == 4, str(pg.locator('.todaylog').inner_text()))

    # 3) シフト希望を提出（来月）
    pg.goto(f'{BASE}/me/hopes?ym={ym_next}')
    pg.locator('.addbtn').nth(2).click(); pg.locator('.addbtn').nth(3).click()
    pg.click('text=希望を提出する'); pg.wait_for_selector('.toast')
    ok('シフト希望を提出', '提出' in pg.inner_text('.toast'))
    pg.goto(f'{BASE}/me/hopes?ym={ym_next}')
    ok('提出済みと表示', pg.locator('text=提出済み').count() > 0)
    pg.screenshot(path=str(SP / '03_hopes.png'), full_page=False)
    pg.click('.usermenu summary'); pg.click('.usermenu button:has-text("ログアウト")'); pg.wait_for_url('**/login')
    ok('スタッフ画面でJSエラーなし', not errs, '; '.join(errs))

    # 4) 店長：初回ログイン→シフト作成→公開
    m = ctx_new(b, 1300, 900); mp = m.new_page(); merrs = []; mp.on('pageerror', lambda e: merrs.append(str(e)))
    login(mp, '田中 翔', '1111')
    ok('店長は1111ですぐ管理画面へ（変更は任意）', '/manage/shifts' in mp.url, mp.url)
    mp.goto(BASE + '/pin'); keypad(mp, '1111'); keypad(mp, '3691'); keypad(mp, '3691'); mp.wait_for_url(re.compile(r'/(me|manage)/'))
    mp.goto(f'{BASE}/manage/shifts?ym={ym_next}')
    before = mp.locator('.summary .big').inner_text()
    mp.get_by_label(f'佐藤 美咲 {nm.month}月3日').click()
    mp.wait_for_selector('.modal')
    ok('希望どおりボタンが出る', mp.locator('.pats button', has_text='希望どおり').count() == 1)
    delta = mp.locator('.modal .delta').inner_text()
    mp.click('.modal button.primary'); mp.wait_for_timeout(1200)
    after = mp.locator('.summary .big').inner_text()
    ok('保存前に人件費の増減が表示され、保存で合計が変わる', before != after and '→' in delta, f'{before} -> {after}')
    mp.reload(); mp.wait_for_load_state('networkidle')
    ok('シフトがDBに保存されている', mp.locator('.mchip').count() >= 1)
    mp.screenshot(path=str(SP / '04_shiftboard.png'))
    mp.click('text=シフトを確定・公開'); mp.click('.modal button.primary'); mp.wait_for_selector('.toast')
    ok('シフトを公開', '公開' in mp.inner_text('.toast'))

    # 5) スタッフが全員のシフトを見られる
    login(pg, '佐藤 美咲')
    pg.goto(f'{BASE}/me/shifts?ym={ym_next}&d={nm.strftime("%Y-%m")}-03')
    ok('スタッフが公開シフトを見られる', pg.locator('.seg-bar').count() >= 1)
    ok('スタッフ画面に時給・人件費が出ない', '¥' not in pg.inner_text('main') if pg.locator('main').count() else '¥' not in pg.inner_text('.wrap'))
    pg.screenshot(path=str(SP / '05_allshifts.png'))

    # 6) 修正申請 → 店長が承認
    pg.goto(f'{BASE}/me/calendar')
    pg.click('text=打刻の修正を申請')
    pg.select_option('#ck', 'out'); pg.fill('#cr', 'テスト：退勤時刻の修正')
    pg.click('.card button.primary'); pg.wait_for_selector('.toast')
    ok('修正を申請できる', '申請' in pg.inner_text('.toast'))
    mp.goto(f'{BASE}/manage/attendance')
    ok('店長に申請が届く', mp.locator('text=テスト：退勤時刻の修正').count() == 1)
    ok('2回に分けた勤務の印', mp.locator('.flag.f-re').count() >= 1)
    mp.screenshot(path=str(SP / '06_attendance.png'))
    mp.locator('button', has_text='承認する').first.click(); mp.wait_for_timeout(1200); mp.reload()
    ok('承認すると修正済みになる', mp.locator('.ed').count() >= 1)

    # 7) 時給の変更（最低賃金チェック）
    mp.goto(f'{BASE}/manage/staff')
    row = mp.locator('tr', has_text='鈴木 健太'); row.locator('button', has_text='時給').click()
    mp.fill('#wh', '1000'); mp.click('.modal button.primary'); mp.wait_for_timeout(600)
    ok('最低賃金未満は保存できない', '最低賃金' in mp.locator('.modal .err').inner_text())
    mp.fill('#wh', '1250'); mp.fill('#wf', f'{ym_next}-01'); mp.click('.modal button.primary'); mp.wait_for_selector('.toast')
    ok('適用日つきで時給を変更', '1,250' in mp.inner_text('.toast'))
    mp.screenshot(path=str(SP / '07_staff.png'))

    # 8) 給与報告Excel（前日の勤務をDBに入れておく：通常勤務と日付をまたぐ深夜勤務）
    ym_prev_day = (today - datetime.timedelta(days=1)).strftime('%Y-%m')
    mp.goto(f'{BASE}/manage/report?ym={ym_prev_day}')
    ok('給与報告に佐藤さんの行', mp.locator('tr', has_text='佐藤 美咲').count() == 1)
    with mp.expect_download() as dl:
        mp.click('text=給与報告フォーム（Excel）を出力')
    path = SP / 'report.xlsx'; dl.value.save_as(str(path))
    ok('Excelをダウンロード', path.stat().st_size > 10000, dl.value.suggested_filename)
    mp.screenshot(path=str(SP / '08_report.png'))

    # 9) 店長・管理者はパスワードが必要（5回間違えるとロック）
    lc = ctx_new(b); lp = lc.new_page()
    lp.goto(BASE + '/login'); lp.locator('.namegrid button', has_text='上塚 佳祐').click()
    ok('管理者は名前だけでは入れない', lp.locator('.keypad').count() == 1)
    for i in range(5):
        keypad(lp, '9999'); lp.wait_for_timeout(700)
    ok('5回間違えるとロック', 'ロック' in lp.locator('.err').inner_text(), lp.locator('.err').inner_text())
    keypad(lp, '1111'); lp.wait_for_timeout(700)
    ok('ロック中は正しいパスワードでも入れない', '/login' in lp.url)
    mp.goto(f'{BASE}/manage/staff'); ok('店長画面にロック中と表示', mp.locator('tr', has_text='上塚 佳祐').locator('text=ロック中').count() == 1)

    # 10) 店舗端末
    tc = ctx_new(b, 1024, 768); tp = tc.new_page(); terrs = []; tp.on('pageerror', lambda e: terrs.append(str(e)))
    login(tp, '田中 翔', '3691')
    tp.goto(BASE + '/manage/settings'); tp.click('button:has-text("この端末を店舗端末にする")'); tp.wait_for_url('**/terminal')
    ok('店舗端末モードになる', '/terminal' in tp.url)
    tp.locator('.tcard', has_text='伊藤 さくら').click(); tp.wait_for_selector('.modal .pbtns')
    tp.click('.modal .pbtn.p-in'); keypad(tp, '1111'); skipface(tp); tp.wait_for_selector('.toast')
    ok('端末で出勤できる', '伊藤 さくら' in tp.inner_text('.toast'))
    tp.wait_for_timeout(1000)
    ok('端末の一覧が勤務中になる', '勤務中' in tp.locator('.tcard', has_text='伊藤 さくら').inner_text())
    tp.locator('.tcard', has_text='伊藤 さくら').click(); tp.wait_for_selector('.modal .pbtns'); tp.click('.modal .pbtn.p-out')
    ok('端末でも退勤は打刻コードなし', tp.locator('.modal .keypad').count()==0); skipface(tp); tp.wait_for_selector('.toast >> text=退勤')
    tp.wait_for_timeout(1000)
    tp.screenshot(path=str(SP / '10_terminal.png'))
    tp.goto(BASE + '/manage/shifts'); tp.wait_for_load_state('networkidle')
    ok('店舗端末から管理画面には入れない', '/manage' not in tp.url, tp.url)
    ok('店長画面でJSエラーなし', not merrs and not terrs, '; '.join(merrs + terrs))

    # 11) 権限：スタッフは管理画面・Excelに入れない
    pg.goto(BASE + '/manage/staff'); ok('スタッフは管理画面に入れない', '/manage' not in pg.url, pg.url)
    r = pg.request.get(BASE + '/api/report?ym=' + today.strftime('%Y-%m'))
    ok('スタッフは給与報告をダウンロードできない', r.status == 401, str(r.status))
    b.close()

print('\nRESULT', sum(1 for r in results if r[1]), '/', len(results))
for r in results:
    if not r[1]: print('FAILED:', r[0], r[2])
