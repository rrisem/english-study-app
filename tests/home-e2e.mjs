// ホーム画面の導線と見た目の切り替えを、スマホ・iPad（縦・横）を想定したブラウザで確かめる
//   使い方： node tests/home-e2e.mjs
//   ・標準（calm）と試作（bold）の両方で：横のはみ出しがない／主ボタンが44px以上で押せる
//   ・主ボタン → 問題画面、「目標を変更」→ 設定、確認状況の項目 → 詳しい予定
//   ・設定の「ホーム画面の見た目」で切り替えると、再読み込み後も保たれ、学習記録は変わらない
// ※ Playwright の Chromium で端末の画面サイズを再現したもので、実機ではない
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const p = join(root, path === '/' ? 'index.html' : path);
  try { res.writeHead(200, { 'content-type': types[extname(p)] + '; charset=utf-8' }); res.end(readFileSync(p)); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const strip = ({ defaultBrowserType, ...d }) => d;
const sizes = { phone: strip(devices['iPhone 13']), 'ipad-portrait': strip(devices['iPad (gen 7)']), 'ipad-landscape': strip(devices['iPad (gen 7) landscape']) };
const browser = await chromium.launch();
const errors = [];
const log = (m) => console.log('✓', m);

async function open(dev, style) {
  const ctx = await browser.newContext({ ...dev });
  if (style) await ctx.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ea-home-style', s); sessionStorage.setItem('seeded', '1'); } }, style);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForSelector('.hero');
  return { ctx, page };
}
const home = (page) => page.click('.nav-item[data-go="home"]').then(() => page.waitForSelector('.hero'));

try {
  for (const style of ['calm', 'bold']) {
    for (const [name, dev] of Object.entries(sizes)) {
      const { ctx, page } = await open(dev, style);
      assert.equal(await page.getAttribute('.home', 'class'), 'home home-' + style);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.equal(overflow, 0, `${style}/${name}: 横にはみ出し`);
      const cta = await page.locator('.hero-cta').boundingBox();
      assert.ok(cta.height >= 44 && cta.width >= 44, `${style}/${name}: 主ボタンが小さい`);
      assert.equal(await page.locator('.hero .btn-primary').count(), 1, '強いボタンは1つだけ');
      // 記録欄・項目一覧の導線
      await page.click('.today [data-go="settings"]');
      await page.waitForSelector('[data-view="settings"]');
      await home(page);
      await page.click('.skill-row');
      await page.waitForSelector('.skill-panel');
      await home(page);
      // 主ボタン → 初回診断の問題画面
      assert.equal(await page.getAttribute('.hero-cta', 'data-act'), 'task-diagnostic');
      await page.click('.hero-cta');
      await page.waitForSelector('[data-view="session"]');
      await ctx.close();
    }
    log(`${style}：3端末で、はみ出しなし・主ボタン44px以上・目標の変更／項目／診断開始の導線が動く`);
  }

  // 設定で切り替え → 再読み込み後も保たれる。学習記録（ea-study-v1）は変わらない
  const { ctx, page } = await open(sizes['ipad-portrait']);
  assert.equal(await page.getAttribute('.home', 'class'), 'home home-calm', '初期は標準');
  const before = await page.evaluate(() => localStorage.getItem('ea-study-v1'));
  await page.click('.nav-item[data-go="settings"]');
  await page.click('[data-act="home-style"][data-style="bold"]');
  assert.equal(await page.getAttribute('[data-act="home-style"][data-style="bold"]', 'aria-checked'), 'true');
  await page.reload();
  await page.waitForSelector('.hero');
  assert.equal(await page.getAttribute('.home', 'class'), 'home home-bold');
  assert.equal(await page.evaluate(() => localStorage.getItem('ea-study-v1')), before, '学習記録が変わっていない');
  await page.click('.nav-item[data-go="settings"]');
  await page.click('[data-act="home-style"][data-style="calm"]');
  await home(page);
  assert.equal(await page.getAttribute('.home', 'class'), 'home home-calm');
  await ctx.close();
  log('設定の切り替えが再読み込み後も保たれ、学習記録は変わらない');

  assert.deepEqual(errors, []);
  log('ページのエラーなし');
  console.log('\nすべての確認が通りました。');
} finally {
  await browser.close();
  server.close();
}
