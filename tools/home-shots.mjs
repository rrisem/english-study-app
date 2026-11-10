// ホーム画面を、学習の状態 × 端末の大きさ で撮影する（デザイン変更の前後比較用）
// 使い方： node tools/home-shots.mjs <出力先フォルダ> [calm|bold]
//   2つ目の引数でホームの見た目を指定（省略時は calm＝標準。設定画面の切り替えと同じ保存先を使う）
//   状態：初回 / 途中で中断 / 復習あり（再確認の項目あり） / 今日の課題完了
//   端末：スマホ（iPhone 13 相当）/ iPad 縦 / iPad 横
// 学習記録は実際の判定ロジック（tests/helpers.mjs）で作り、localStorage に入れてから表示します。
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from '../tests/helpers.mjs';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] || join(root, 'test-output', 'home'));
const homeStyle = process.argv[3] === 'bold' ? 'bold' : 'calm';
mkdirSync(outDir, { recursive: true });

/* ---------- 学習記録をつくる ---------- */
function run(c, decide = () => ({})) {
  while (c.state.activeSession) {
    const it = c.current();
    const d = it.kind === 'explain' ? {} : decide(it);
    c.answer(d.how || 'correct', d);
  }
}
const clone = (c) => ({ state: JSON.parse(JSON.stringify(c.state)), now: c.t().app + 60000 });

const scenes = {};
{ const c = setup(); scenes['1-new'] = clone(c); }
{
  const c = setup();
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  for (let i = 0; i < 3; i++) c.answer(i === 1 ? 'wrong' : 'correct');
  scenes['2-resume'] = clone(c);
}
{
  // 生徒A：診断で1問間違え、類題の意味の問いを取り違える → 翌日に復習が来る
  const c = setup();
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  run(c, (it) => (it.questionId === 'inf-d1' ? { how: 'wrong' } : {}));
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  run(c, (it) => (it.attemptType === 'similar' ? { reason: false } : {}));
  c.setDay(1);
  scenes['3-review'] = clone(c);
  c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
  run(c);
  scenes['4-done'] = clone(c);
}

/* ---------- 撮影 ---------- */
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const p = join(root, path === '/' ? 'index.html' : path);
  try { res.writeHead(200, { 'content-type': (types[extname(p)] || 'text/plain') + '; charset=utf-8' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const strip = ({ defaultBrowserType, ...d }) => d;
const sizes = {
  phone: strip(devices['iPhone 13']),
  'ipad-portrait': strip(devices['iPad (gen 7)']),
  'ipad-landscape': strip(devices['iPad (gen 7) landscape']),
};

const browser = await chromium.launch();
const errors = [];
for (const [sceneName, scene] of Object.entries(scenes)) {
  for (const [sizeName, dev] of Object.entries(sizes)) {
    const ctx = await browser.newContext({ ...dev });
    await ctx.clock.setSystemTime(scene.now);
    await ctx.addInitScript(([s, style]) => { localStorage.setItem('ea-study-v1', s); localStorage.setItem('ea-home-style', style); }, [JSON.stringify(scene.state), homeStyle]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${sceneName}/${sizeName}: ${e.message}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto(url);
    await page.waitForSelector('.hero');
    // 横にはみ出していないか
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) errors.push(`${sceneName}/${sizeName}: 横に ${overflow}px はみ出し`);
    await page.screenshot({ path: join(outDir, `${sceneName}_${sizeName}.png`), fullPage: true });
    await ctx.close();
  }
}
await browser.close();
server.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('撮影しました:', outDir);
