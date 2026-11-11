/*
 * home.check.cjs — ホームの表示の確認（初回診断前・診断の途中から再開・復習予定あり・復習期限）を
 * iPad横・iPad縦・スマホ幅で。説明の開閉と主ボタンの操作も確かめる。実行：node tests/home.check.cjs
 */
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = process.argv[2] || path.join(__dirname, '..'), OUT = process.argv[3] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0].replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] }); r.end(d); }); });
const VIEWS = [['ipad-land', 1180, 820], ['ipad-port', 820, 1180], ['phone', 390, 844]];
(async () => {
  await new Promise(r => server.listen(0, r)); const URL = 'http://localhost:' + server.address().port + '/';
  const b = await chromium.launch(); const errs = []; let n = 0;
  const ok = (m) => { n++; console.log('ok  ' + m); };
  for (const [vn, w, h] of VIEWS) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(vn + ': ' + e.message)); await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    const hero = () => p.innerText('.hero'); const dash = () => p.innerText('.dash');
    const inFirstScreen = async (sel) => { const bb = await p.locator(sel).boundingBox(); return bb && bb.y + bb.height <= h; };
    await p.goto(URL); await p.waitForSelector('.hero');

    // 1. 初回診断前
    let t = await hero();
    const order = ['次にやること', '不定詞の初回診断', '6問・約10分', '診断をはじめる'].map(x => t.indexOf(x));
    assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), vn + ' 順番 ' + order);
    assert.ok(!t.includes('まず今の状態') && !t.includes('結果と解説は全問に答えたあとに出ます'), '常時の説明文なし');
    assert.ok(!(await dash()).includes('復習の予定') && !(await dash()).includes('次の復習'), '復習予定の行なし');
    assert.ok(!(await dash()).includes('目標まであと'), '目標まであと なし');
    assert.ok((await dash()).includes('目標を変更') && (await dash()).includes('今日の学習時間'));
    assert.ok(await inFirstScreen('[data-act="task-diagnostic"]'), '主ボタンが最初の画面に入る');
    const hb = await p.locator('[data-act="toggle-help"]').boundingBox(); assert.ok(hb.height >= 44, 'help 44px');
    assert.ok(!(await p.isVisible('.hero-help-text')), '説明は閉じている');
    await p.screenshot({ path: path.join(OUT, vn + '-1-before.png') });
    await p.tap('[data-act="toggle-help"]'); await p.waitForTimeout(350);
    assert.ok(await p.isVisible('.hero-help-text')); assert.ok((await hero()).includes('答えに応じて、次に取り組む問題が決まります。'));
    assert.strictEqual(await p.getAttribute('[data-act="toggle-help"]', 'aria-expanded'), 'true');
    assert.ok(await inFirstScreen('[data-act="task-diagnostic"]'), '開いても主ボタンが最初の画面に入る');
    await p.screenshot({ path: path.join(OUT, vn + '-2-help-open.png') });
    await p.tap('[data-act="toggle-help"]'); await p.waitForTimeout(350);
    assert.ok(!(await p.isVisible('.hero-help-text')), '閉じる');
    ok(vn + ' 初回診断前：順番・説明の開閉・主ボタン');

    // 主ボタン → 1問目の案内（閉じずにそのまま回答できる）
    await p.tap('[data-act="task-diagnostic"]'); await p.waitForSelector('.first-note');
    assert.ok((await p.innerText('.first-note')).includes('結果と解説は全問回答後に表示されます'));
    await p.screenshot({ path: path.join(OUT, vn + '-3-first-q.png') });
    await p.waitForTimeout(300); await p.tap('[data-act="choose"]'); await p.waitForTimeout(100); await p.tap('#submit-btn');
    await p.waitForTimeout(300);
    assert.ok(!(await p.$('.first-note')), '2問目には出ない');
    ok(vn + ' 1問目だけ案内・そのまま回答できる');

    // 2. 診断の途中から再開
    await p.tap('[data-act="save-home"]'); await p.waitForSelector('.hero');
    t = await hero(); assert.ok(t.includes('初回診断の続き') && t.includes('続きから再開') && !t.includes('初回診断とは？'));
    assert.ok(await inFirstScreen('[data-act="task-resume"]'));
    await p.screenshot({ path: path.join(OUT, vn + '-4-resume.png') });
    await p.tap('[data-act="task-resume"]'); await p.waitForSelector('.sheet'); assert.ok((await p.innerText('.q-count')).startsWith('2 /'));
    ok(vn + ' 診断の途中から再開');

    // 3. 復習予定がある（診断を最後まで → 解説と類題はあとで）
    for (let i = 0; i < 5; i++) { await p.waitForTimeout(300); await p.tap('[data-act="giveup"]'); }
    await p.waitForSelector('[data-act="skip-practice-later"]'); await p.tap('[data-act="skip-practice-later"]'); await p.waitForSelector('.hero');
    const sched = await p.evaluate(() => { const s = EA.app.getState().schedule; const k = Object.keys(s)[0]; const d = new Date(s[k].dueAt); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; });
    t = await dash(); assert.ok(t.includes('次の復習') && t.includes(sched), '次の復習 ' + sched + ' / ' + t);
    await p.screenshot({ path: path.join(OUT, vn + '-5-scheduled.png') });
    ok(vn + ' 復習予定あり：次の復習 ' + sched);

    // 4. 復習期限（解説と類題は見送り済み・期限を過去にする）
    await p.evaluate(() => { const st = EA.app.getState(); st.units.infinitive.practiceSkippedAt = Date.now(); Object.values(st.schedule).forEach(e => e.dueAt = EA.util.addDays(Date.now(), -1)); EA.storage.save(st); EA.app.go('home'); });
    t = await dash(); assert.ok(t.includes('今日の復習') && t.includes('復習をはじめる') && t.includes('次の復習') && t.includes('今日'), t);
    assert.ok(await inFirstScreen('[data-act="task-review"]'));
    await p.screenshot({ path: path.join(OUT, vn + '-6-due.png') });
    await p.tap('[data-act="task-review"]'); await p.waitForSelector('.sheet'); assert.ok((await p.innerText('.q-type')).includes('復習'));
    ok(vn + ' 復習期限：既存の「復習をはじめる」から開始できる');
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.ok(!over, vn + ' overflow');
    await ctx.close();
  }
  assert.deepStrictEqual(errs, []); console.log('\n' + n + ' 件 ok'); await b.close(); server.close();
})().catch(e => { console.error('NG', e.message); process.exit(1); });
