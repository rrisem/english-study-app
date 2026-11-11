/*
 * browser.check.cjs — 画面での確認（Playwright）。実行：node tests/browser.check.cjs [出力フォルダ]
 * app フォルダを簡易サーバーで開き、保存してホームへ・再開・意味の問いの表示を確かめる。
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain' }); res.end(d); });
});
let n = 0;
async function step(name, fn) { await fn(); n++; console.log('ok  ' + name); }

(async () => {
  await new Promise(r => server.listen(0, r));
  const URL = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Google Fonts はこの環境では読めないので止める（見た目の確認には代替フォントを使う）
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const text = () => page.innerText('#app');
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('ea-study-v1')));
  const reload = async () => { await page.reload(); await page.waitForSelector('.hero'); };

  await page.goto(URL); await page.waitForSelector('.hero');

  await step('学習画面の退出ボタンは「保存してホームへ」1つ（初回診断）', async () => {
    await page.click('[data-act="task-diagnostic"]');
    const btns = await page.$$eval('.session-btns button', bs => bs.map(b => b.textContent));
    assert.deepStrictEqual(btns, ['保存してホームへ']);
    const t = await text();
    assert.ok(!t.includes('今日はここまで') && !t.includes('中断'));
  });

  await step('回答入力中（選択だけ）に保存してホームへ → 開き直して同じ問題・同じ選択で再開', async () => {
    const choice = await page.$eval('[data-act="choose"]', b => b.textContent);
    await page.click('[data-act="choose"]');
    await page.click('[data-act="save-home"]');
    assert.ok((await text()).includes('保存しました'));
    assert.ok((await text()).includes('続きから再開'));
    const st = await state();
    assert.strictEqual(st.sessions.length, 0); assert.strictEqual(JSON.stringify(st.schedule), '{}');
    await reload();
    await page.click('[data-act="task-resume"]');
    const sel = await page.$eval('.choice.is-selected', b => b.textContent);
    assert.strictEqual(sel, choice);
    assert.ok(!(await page.$eval('#submit-btn', b => b.disabled)));
  });

  // 診断を最後まで（すべて「わからない」）→ 結果画面のボタンの文言
  await step('診断の結果画面：「ホームへ戻る（解説と類題はあとで）」で記録を変えずにホームへ', async () => {
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(300); await page.click('[data-act="giveup"]'); }
    await page.waitForSelector('[data-act="skip-practice-later"]');
    assert.strictEqual(await page.$eval('[data-act="skip-practice-later"]', b => b.textContent), 'ホームへ戻る（解説と類題はあとで）');
    const before = await state();
    await page.click('[data-act="skip-practice-later"]');
    const after = await state();
    assert.strictEqual(JSON.stringify(after.schedule), JSON.stringify(before.schedule));
    assert.strictEqual(after.sessions.length, 1);
  });

  // 意味の問いが出る類題を1問目にした学習回を用意する（画面から作るのと同じ関数を使う）
  async function prepareReason() {
    await page.evaluate(() => {
      const EA = window.EA, st = EA.app.getState(), b = EA.banks.infinitive, now = Date.now();
      const s = EA.planner.buildPracticeSession(st, b, now);
      s.items = [{ kind: 'question', questionId: 'inf-p-v1', attemptType: 'similar' }, { kind: 'question', questionId: 'inf-p-a2', attemptType: 'similar' }];
      EA.session.start(st, b, s, { app: now, real: now });
      EA.storage.save(st);
    });
    await reload();
  }

  await step('意味の問い：回答前は訳・正誤・解説を出さず、聞いている部分を太字で示す（スマホ幅）', async () => {
    await prepareReason();
    await page.click('[data-act="task-resume"]');
    await page.click('[data-act="choose"][data-choice="b"]');
    await page.click('#submit-btn');
    await page.waitForSelector('.reason');
    const t = await text();
    assert.ok(!t.includes('始発電車に乗るために'), '全文訳を出さない');
    assert.ok(!t.includes('正解') && !t.includes('解説\n'), '正誤・解説を出さない');
    assert.strictEqual(await page.$eval('.reason-target', e => e.textContent), 'to take the first train');
    assert.ok(t.includes('太字の部分は、何を説明していますか？'));
    assert.strictEqual(await page.$$eval('.reason .choice', bs => bs.length), 3);
    await page.screenshot({ path: path.join(OUT, 'reason-phone.png'), fullPage: true });
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.screenshot({ path: path.join(OUT, 'reason-ipad.png'), fullPage: true });
    // 横にはみ出さない
    for (const w of [390, 820]) {
      await page.setViewportSize({ width: w, height: 900 });
      const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.ok(!over, w + 'px で横にはみ出さない');
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await step('意味の問いの回答前（選択済み）に離れる → 開き直して同じ問い・同じ選択。未回答の間は確認済みにしない', async () => {
    await page.waitForTimeout(300); // 画面が切り替わった直後のタップは無視される（二重タップ対策）
    await page.click('[data-act="reason-choose"][data-choice="a"]');
    await page.click('[data-act="save-home"]');
    let st = await state();
    assert.strictEqual(st.attempts.filter(a => a.questionId === 'inf-p-v1')[0].reasonPending, true);
    await reload();
    assert.ok((await text()).includes('（意味の問いの回答前）から再開します'));
    await page.click('[data-act="task-resume"]');
    assert.strictEqual(await page.$eval('.reason .choice.is-selected', b => b.getAttribute('data-choice')), 'a');
    const n = (await state()).attempts.length;
    await page.click('[data-act="reason-choose"][data-choice="b"]');
    await page.click('#reason-submit');
    await page.waitForSelector('.reason-result');
    st = await state();
    assert.strictEqual(st.attempts.length, n, '回答を二重に記録しない');
    const a = st.attempts.filter(x => x.questionId === 'inf-p-v1')[0];
    assert.strictEqual(a.reason.correct, true); assert.ok(!a.reasonPending);
    const t = await text();
    assert.ok(t.includes('トムが早く起きた目的') && t.includes('got up early') && t.includes('副詞的用法'));
    await page.screenshot({ path: path.join(OUT, 'reason-result-phone.png'), fullPage: true });
  });

  await step('解説表示中に離れる → 開き直して解説表示のまま。復習予定・完了状態は変わらない', async () => {
    const before = await state();
    await page.click('[data-act="save-home"]');
    await reload();
    assert.ok((await text()).includes('（解説の表示中）から再開します'));
    await page.click('[data-act="task-resume"]');
    assert.ok(await page.$('.reason-result'));
    const after = await state();
    assert.strictEqual(JSON.stringify(after.schedule), JSON.stringify(before.schedule));
    assert.strictEqual(after.sessions.length, before.sessions.length);
  });

  await step('保存に失敗 → 学習画面にとどまり失敗を知らせる。入力を保ったまま再試行できる', async () => {
    await page.click('[data-act="next"]');
    await page.waitForSelector('[data-act="choose"]');
    await page.click('[data-act="choose"][data-choice="c"]');
    await page.evaluate(() => { window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error('QuotaExceeded'); }; });
    await page.click('[data-act="save-home"]');
    const t = await text();
    assert.ok(t.includes('保存できませんでした') && !t.includes('保存しました'));
    assert.ok(await page.$('.choice.is-selected[data-choice="c"]'), '選択が残る');
    await page.evaluate(() => { Storage.prototype.setItem = window.__set; });
    await page.click('[data-act="save-home"]');
    assert.ok((await text()).includes('保存しました'));
  });

  await step('最後まで進んだときだけ、まとめを表示し復習予定を1回更新', async () => {
    const before = await state();
    await page.click('[data-act="task-resume"]');
    await page.waitForTimeout(300);
    await page.click('#submit-btn');
    await page.waitForTimeout(300);
    await page.click('[data-act="next"]');
    await page.waitForSelector('.view-summary');
    const after = await state();
    assert.strictEqual(after.sessions.length, before.sessions.length + 1);
    assert.strictEqual(after.activeSession, null);
    assert.ok(after.schedule['inf-adv'].history.length === before.schedule['inf-adv'].history.length + 1);
    assert.ok(after.schedule['inf-adj'].history.length === before.schedule['inf-adj'].history.length + 1);
  });

  await step('日付が変わって再開（デモモードで +3日）→ 期限の来た復習の件数を「続きから再開」の近くに表示', async () => {
    await page.click('[data-go="settings"]');
    await page.click('details.dev summary');
    await page.click('[data-act="demo-enter"]');
    await page.evaluate(() => {
      const EA = window.EA, st = EA.app.getState(), b = EA.banks.infinitive, now = EA.clock.now();
      st.units.infinitive = { diagnosticDoneAt: now, practiceDoneAt: now };
      ['inf-noun', 'inf-adj'].forEach(k => { st.schedule[k] = { skillId: k, step: 0, intervalDays: 1, dueAt: EA.util.addDays(now, 1), history: [] }; });
      const s = EA.planner.buildPracticeSession(st, b, now);
      s.items = [{ kind: 'question', questionId: 'inf-p-v1', attemptType: 'similar' }];
      EA.session.start(st, b, s, { app: now, real: now });
      EA.storage.save(st);
    });
    await reload();
    assert.ok(!(await text()).includes('期限を迎えた復習'), '当日は期限前');
    await page.click('[data-go="settings"]');
    await page.click('[data-act="dev-add"][data-days="3"]');
    await page.click('[data-go="home"]');
    const t = await text();
    assert.ok(t.includes('続きから再開') && t.includes('期限を迎えた復習が 2件'), t.slice(0, 400));
    await page.screenshot({ path: path.join(OUT, 'home-resume-due-phone.png'), fullPage: false });
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.screenshot({ path: path.join(OUT, 'home-resume-due-ipad.png'), fullPage: false });
    await page.click('[data-act="task-resume"]');
    assert.ok(await page.$('[data-act="choose"]'));
  });

  assert.deepStrictEqual(errors, []);
  console.log('\n' + n + ' 件 ok（スクリーンショット：' + OUT + '）');
  await browser.close(); server.close();
})().catch(e => { console.error('NG ', e); process.exit(1); });
