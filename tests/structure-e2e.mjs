// 英文構造の段階解説を、iPad（縦・横）・Android・狭いスマホ幅のブラウザで操作して確かめる
//   使い方： node tests/structure-e2e.mjs   （端末の画面サイズとタッチ操作を再現したもので、実機ではない）
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-output');
mkdirSync(outDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const p = join(root, path === '/' ? 'index.html' : path);
  try { res.writeHead(200, { 'content-type': types[extname(p)] + '; charset=utf-8' }); res.end(readFileSync(p)); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();
const errors = [];
const log = (m) => console.log('✓', m);
const NARROW = { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['Pixel 7'].userAgent };
const DEVICES = [['ipad-portrait', devices['iPad (gen 7)']], ['ipad-landscape', devices['iPad (gen 7) landscape']], ['android', devices['Pixel 7']], ['narrow-360', NARROW]];

/** 文字や操作が重なっていないか・横にはみ出していないか */
async function assertNoOverlap(page, where) {
  const r = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.sx-panel .sx-words, .sx-panel .sx-label, .sx-panel .sx-plain, .sx-controls button, .sx-trans button, .sx-open')]
      .filter((e) => e.offsetParent).map((e) => ({ t: e.textContent.trim().slice(0, 20), r: e.getBoundingClientRect() }));
    const hits = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) hits.push(boxes[i].t + ' × ' + boxes[j].t);
    }
    const panel = document.querySelector('.sx-panel').getBoundingClientRect();
    const outside = boxes.filter((b) => b.r.right > panel.right + 1 || b.r.left < panel.left - 1).map((b) => b.t);
    return { hits, outside, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  assert.deepEqual(r.hits, [], where + '：重なり ' + r.hits.join(', '));
  assert.deepEqual(r.outside, [], where + '：枠からはみ出し ' + r.outside.join(', '));
  assert.ok(r.overflow <= 0, where + '：横スクロール ' + r.overflow);
}

async function start(dev, opts = {}) {
  const ctx = await browser.newContext({ ...dev, reducedMotion: opts.reduce ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForSelector('.hero');
  return { ctx, page };
}
const settle = (page) => page.waitForFunction(() => !window.EA.app.isTapGuarded());
const step = (page) => page.textContent('.sx-count');
const roleTexts = (page) => page.$$eval('.sx-panel > .sx-sentence .sx-seg', (els) => els.map((e) => e.className.match(/sx-(\w+)/g)[1].slice(3) + ':' + e.querySelector('.sx-words').textContent.trim() + ':' + e.querySelector('.sx-label').textContent.trim()));

for (const [name, dev] of DEVICES) {
  console.log(`\n■ ${name}（${dev.viewport.width}×${dev.viewport.height}）`);
  const { ctx, page } = await start(dev);
  const attemptsBefore = await page.evaluate(() => window.EA.app.getState().attempts.length);
  await page.locator('[data-go="units"]').tap();
  await page.locator('[data-act="task-trial"]').tap();
  await page.waitForSelector('[data-act="choose"]');

  // 回答前：構造・訳・解説を見せない
  const pre = await page.textContent('main');
  assert.ok(!pre.includes('構造を見る') && !pre.includes('主語の中心') && !pre.includes('私が昨日買った本はおもしろい') && !pre.includes('骨格'), '回答前に構造・訳を出さない');
  log('回答前は、構造の解説・日本語訳・正答を表示しない');

  // 誤答で確定（正誤とは関係なく構造は見られる）
  await page.locator('[data-act="choose"][data-choice="b"]').tap();
  await settle(page);
  await page.locator('#submit-btn').tap();
  await page.waitForSelector('[data-act="sx-toggle"]');
  assert.equal(await page.locator('[data-act="sx-toggle"]').getAttribute('aria-expanded'), 'false');
  assert.ok(!(await page.textContent('main')).includes('私が昨日買った本はおもしろい'), '訳は任意（開くまで出さない）');
  assert.equal(await page.locator('.sx-panel').isVisible(), false);
  log('回答後に「構造を見る」が出る。最初は閉じていて、訳も出ていない');

  // 段階1
  await page.locator('[data-act="sx-toggle"]').tap();
  assert.match(await step(page), /段階 1 \/ 3/);
  assert.deepEqual(await roleTexts(page), ['subject:The book:主語の中心（何が）', 'verb:is:文の動詞']);
  assert.equal(await page.locator('[data-act="sx-prev"]').isDisabled(), true);
  await assertNoOverlap(page, name + ' 段階1');
  await page.locator('.sx').screenshot({ path: join(outDir, `sx-${name}-1.png`) });
  log('段階1：The book（主語の中心）と is（文の動詞）をラベルつきで示す');

  // 段階2
  await page.locator('[data-act="sx-next"]').tap();
  assert.match(await step(page), /段階 2 \/ 3/);
  const r2 = await roleTexts(page);
  assert.deepEqual(r2, ['subject:The book:主語の中心（何が）', 'modifier:（that I bought yesterday）:← book を説明', 'verb:is:文の動詞']);
  await assertNoOverlap(page, name + ' 段階2');
  await page.locator('.sx').screenshot({ path: join(outDir, `sx-${name}-2.png`) });
  log('段階2：（that I bought yesterday）を括弧と枠でまとめ、「← book を説明」と示す');

  // 段階3
  await page.locator('[data-act="sx-next"]').tap();
  assert.match(await step(page), /段階 3 \/ 3/);
  assert.equal((await page.textContent('.sx-skeleton .sx-sentence')).replace(/主語|動詞|どんなだ（補語）/g, '').replace(/\s+/g, ' ').trim(), 'The book is interesting.');
  assert.equal(await page.locator('[data-act="sx-next"]').isDisabled(), true);
  await assertNoOverlap(page, name + ' 段階3');
  log('段階3：骨格 The book is interesting. を示す（最後の段階では「次へ」は押せない）');

  // 前へ・最初から
  await page.locator('[data-act="sx-prev"]').tap();
  assert.match(await step(page), /段階 2 \/ 3/);
  await page.locator('[data-act="sx-restart"]').tap();
  assert.match(await step(page), /段階 1 \/ 3/);
  log('「前へ」「最初から」で段階を戻せる');

  // 日本語訳（任意）
  await page.locator('[data-act="sx-trans"]').tap();
  assert.equal(await page.locator('#sx-trans-text').isVisible(), true);
  assert.equal((await page.textContent('#sx-trans-text')).trim(), '私が昨日買った本はおもしろい。');
  await assertNoOverlap(page, name + ' 訳を表示');
  log('日本語訳は「日本語訳を見る」を押したときだけ表示');

  // 閉じて再開：段階2で閉じ、開くと段階2から
  await page.locator('[data-act="sx-next"]').tap();
  await page.locator('[data-act="sx-toggle"]').tap();
  assert.equal(await page.locator('.sx-panel').isVisible(), false);
  await page.locator('[data-act="sx-toggle"]').tap();
  assert.match(await step(page), /段階 2 \/ 3/);
  log('閉じて開き直すと、見ていた段階から再開');

  // 再読み込みしても、正誤の画面と段階が残る
  await page.reload();
  await page.waitForSelector('.hero');
  await page.locator('[data-act="task-resume"]').tap();
  await page.waitForSelector('.sx-panel');
  assert.match(await step(page), /段階 2 \/ 3/);
  assert.equal(await page.locator('#sx-trans-text').isVisible(), true);
  log('再読み込みして再開しても、同じ段階・訳の表示状態から');

  // 画面幅の変更（iPad の縦横の切り替え）
  if (name.startsWith('ipad')) {
    const v = dev.viewport;
    await page.setViewportSize({ width: v.height, height: v.width });
    await assertNoOverlap(page, name + ' 回転後');
    await page.setViewportSize(v);
    log('開いたまま縦横を切り替えても、重なり・はみ出しなし');
  }

  // 記録：閲覧は記録するが、正誤は変わらない。確定は1件・復習予定に入らない
  const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.EA.app.getState())));
  const a = s.attempts[s.attempts.length - 1];
  assert.equal(s.attempts.length, attemptsBefore + 1);
  assert.equal(a.result, 'incorrect', '構造を最後まで見ても正解にはならない');
  assert.equal(a.structureView.completed, true);
  assert.equal(a.structureView.maxStepSeen, 3);
  assert.equal(a.structureView.translationOpened, true);
  assert.ok(a.structureView.openCount >= 2);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ea-study-v1')).attempts.slice(-1)[0].structureView);
  assert.equal(stored.completed, true, '既存の保存領域（localStorage）に保存されている');
  await page.locator('[data-act="next"]').tap();
  await page.waitForSelector('.att-list');
  const s2 = await page.evaluate(() => JSON.parse(JSON.stringify(window.EA.app.getState())));
  assert.equal(s2.schedule['structure-svo'], undefined, '試作は復習予定に入らない');
  assert.match(await page.textContent('main'), /構造の解説：開いた（3 \/ 3 段階まで・訳を見た）/);
  await page.screenshot({ path: join(outDir, `sx-${name}-summary.png`), fullPage: true });
  log('閲覧の記録は残すが、正誤・確認状況・復習予定は変えない');
  await ctx.close();
}

/* 動きを減らす設定：動きは止まり、静止表示でも同じ内容 */
{
  console.log('\n■ 動きを減らす設定（Android）');
  const { ctx, page } = await start(devices['Pixel 7'], { reduce: true });
  await page.locator('[data-go="units"]').tap();
  await page.locator('[data-act="task-trial"]').tap();
  await page.locator('[data-act="choose"][data-choice="a"]').tap();
  await settle(page);
  await page.locator('#submit-btn').tap();
  await page.locator('[data-act="sx-toggle"]').tap();
  await page.locator('[data-act="sx-next"]').tap();
  const anim = await page.locator('.sx-seg.is-new .sx-words').first().evaluate((el) => getComputedStyle(el).animationName);
  assert.equal(anim, 'none');
  assert.deepEqual((await roleTexts(page)).map((x) => x.split(':')[0]), ['subject', 'modifier', 'verb']);
  log('動きを減らす設定では強調の動きを止め、括弧・ラベルで同じ内容を表示');
  await ctx.close();
}

assert.deepEqual(errors, [], 'ページのエラー: ' + errors.join('\n'));
log('ページのエラーなし');
await browser.close();
server.close();
console.log('\nすべての確認が通りました。');
