// 問題画面の操作への反応を、Android スマホと iPad を想定したブラウザで確かめる
//   使い方： node tests/interaction-e2e.mjs
// ※ Playwright の Chromium で端末の画面サイズ・タッチ操作を再現したもので、実機ではない
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
const LONG = '長い解説の表示確認用の文です。'.repeat(60);

async function openPractice(dev, opts = {}) {
  const ctx = await browser.newContext({ ...dev, reducedMotion: opts.reduce ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForSelector('.hero');
  // 診断を済ませ（inf-d1 だけ誤答）、解説と類題を始める。類題の解説は長い文にしておく（欠けずに開閉できるかの確認用）
  await page.evaluate((LONG) => {
    const EA = window.EA, s = EA.app.getState(), B = EA.banks.infinitive, t = () => ({ app: Date.now(), real: Date.now() });
    EA.findQuestion(B, 'inf-p-n1').explanation.point = LONG;
    EA.session.start(s, B, EA.planner.buildDiagnosticSession(B, Date.now()), t());
    while (s.activeSession) {
      const q = EA.findQuestion(B, s.activeSession.items[s.activeSession.index].questionId);
      EA.session.ensureCurrent(s, B, t());
      s.activeSession.current.draft = q.format === 'fill' ? (q.id === 'inf-d1' ? 'a' : q.answer) : null;
      EA.session.submit(s, B, !s.activeSession.current.draft, t());
    }
    EA.session.start(s, B, EA.planner.buildPracticeSession(s, B, Date.now()), t());
    EA.app.go('session');
  }, LONG);
  const settle = () => page.waitForFunction(() => !window.EA.app.isTapGuarded());
  return { ctx, page, settle };
}
const st = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.EA.app.getState())));
const qOf = (page, id) => page.evaluate((id) => JSON.parse(JSON.stringify(window.EA.findQuestion(window.EA.banks.infinitive, id))), id);

for (const [name, dev] of [['android', devices['Pixel 7']], ['ipad', devices['iPad (gen 7)']]]) {
  console.log(`\n■ ${name}（${dev.viewport.width}×${dev.viewport.height}、タッチ操作）`);
  const { ctx, page, settle } = await openPractice(dev);
  console.log('  （hover が使える端末として判定されたか：' + await page.evaluate(() => matchMedia('(hover: hover)').matches) + '）');
  await page.locator('[data-act="next"]').tap(); // 解説 → 解き直し（inf-d1）
  await settle();

  /* ---- 1. 選択：すぐに選択状態が見える・描き直さずその場で変わる ---- */
  const first = page.locator('[data-act="choose"]').nth(0);
  const second = page.locator('[data-act="choose"]').nth(1);
  await first.evaluate((el) => { el.dataset.sameNode = '1'; });
  const ms = await first.evaluate((el) => { const t0 = performance.now(); el.click(); return { dt: performance.now() - t0, on: el.classList.contains('is-selected'), aria: el.getAttribute('aria-checked') }; });
  assert.equal(ms.on, true); assert.equal(ms.aria, 'true');
  assert.equal(await page.locator('[data-same-node="1"]').count(), 1, '選択肢を描き直していない（同じ要素のまま）');
  console.log(`  タップ処理から選択表示まで：${ms.dt.toFixed(1)}ms（同じ処理の中で表示を変更）`);
  await second.tap();
  assert.equal(await page.locator('[aria-checked="true"]').count(), 1, '選択中は1つだけ');
  assert.equal(await second.getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#submit-btn').isDisabled(), false);
  const blank = await page.textContent('.q-sentence .blank');
  assert.equal(blank.trim(), (await second.textContent()).trim(), '空所に選んだ語句が入る');
  await page.screenshot({ path: join(outDir, `ui-${name}-1-selected.png`) });
  log('選択肢をタップすると、その場ですぐ選択状態になる（丸の塗り＋枠の色、選べるのは1つ）');

  /* ---- 2. 確定：二重確定しない／採点後の正誤を記号と文字で示す ---- */
  let s0 = await st(page);
  const idx0 = s0.activeSession.index, n0 = s0.attempts.length;
  // 誤答を選んで確定。確定の直後（0.25秒以内）に「次へ」が押されても進まない
  const q1 = await qOf(page, s0.activeSession.items[idx0].questionId);
  const wrongId = q1.choices.find((c) => c.id !== q1.answer).id;
  await page.locator(`[data-act="choose"][data-choice="${wrongId}"]`).tap();
  await settle();
  const saved = await page.evaluate(() => {
    document.getElementById('submit-btn').click();
    const stored = JSON.parse(localStorage.getItem('ea-study-v1')).attempts.length; // 確定直後（動きの前）に保存済みか
    const nextBtn = document.querySelector('[data-act="next"]'); if (nextBtn) nextBtn.click(); // 二重タップが「次へ」に当たった場合
    const bar = document.querySelector('.q-bar');
    return { stored, valuenow: +bar.getAttribute('aria-valuenow'), to: document.querySelector('.q-bar-fill').dataset.to };
  });
  await page.locator('#submit-btn, [data-act="submit"]').count();
  let s1 = await st(page);
  assert.equal(s1.attempts.length, n0 + 1, '記録は1件だけ');
  assert.equal(saved.stored, n0 + 1, '確定した時点で保存済み（動きを待たない）');
  assert.equal(s1.activeSession.index, idx0, '確定直後の「次へ」は無視され、正誤の画面にとどまる');
  assert.ok(await page.locator('.verdict').isVisible());
  log('確定は1回だけ記録され、確定した時点で保存される。直後の連続タップで正誤画面を飛ばさない');
  // dblclick でも二重にならない（次の問題で確かめる）
  assert.equal(saved.valuenow, idx0 + 1, '進捗は確定後に「終えた項目」として1つ増える');
  log(`進捗バーは確定直後に更新（aria-valuenow ${idx0} → ${saved.valuenow}、幅 ${saved.to}%）`);
  const wrongItem = page.locator('.choice-result.is-wrong');
  const rightItem = page.locator('.choice-result.is-correct');
  assert.match(await wrongItem.textContent(), /×.*あなたの答え/);
  assert.match(await rightItem.textContent(), /✓.*正解/);
  assert.equal(await page.locator('[data-act="choose"]').count(), 0, '採点後は選び直せない');
  await page.screenshot({ path: join(outDir, `ui-${name}-2-result.png`), fullPage: true });
  log('採点後は「✓ 正解」「× あなたの答え」を記号・文字・色で表示し、選択中の見た目と区別');

  /* ---- 3. 次の問題では選択状態が初期化される ---- */
  await settle();
  const nextBox = await page.locator('[data-act="next"]').boundingBox();
  await page.locator('[data-act="next"]').tap();
  await settle();
  s1 = await st(page);
  const item = s1.activeSession.items[s1.activeSession.index];
  assert.equal(item.attemptType, 'similar');
  assert.equal(await page.locator('[aria-checked="true"], .choice.is-selected').count(), 0, '選択状態は残らない');
  assert.equal(await page.locator('#submit-btn').isDisabled(), true);
  assert.equal(await page.locator('.q-sentence .blank.filled').count(), 0);
  const underFinger = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y)?.closest('.choice'); return el ? getComputedStyle(el).borderTopColor : null; }, { x: nextBox.x + nextBox.width / 2, y: nextBox.y + nextBox.height / 2 });
  const plain = await page.locator('[data-act="choose"]').last().evaluate((el) => getComputedStyle(el).borderTopColor);
  if (underFinger) assert.equal(underFinger, plain, '直前にタップした位置の選択肢が、選択中のように見えない');
  log('次の問題では選択なし・確定ボタン無効・空所は空で始まる');

  /* ---- 4. 解説の開閉（長い解説） ---- */
  const q2 = await qOf(page, item.questionId);
  await page.locator(`[data-act="choose"][data-choice="${q2.answer}"]`).tap();
  const n2 = (await st(page)).attempts.length;
  await settle();
  await page.locator('#submit-btn').dblclick();
  assert.equal((await st(page)).attempts.length, n2 + 1, 'ダブルクリックでも記録は1件');
  log('確定ボタンのダブルタップでも記録は1件');
  if (await page.locator('[data-act="reason"]').count()) { await settle(); await page.locator(`[data-act="reason"][data-choice="${q2.reason.answer}"]`).tap(); }
  await page.waitForSelector('.explain-toggle');
  const toggle = page.locator('.explain-toggle');
  const inner = page.locator('#ex-body .collapse-inner');
  const fullyShown = () => inner.evaluate((el) => el.clientHeight >= el.scrollHeight - 1 && el.scrollHeight > 0);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(await fullyShown(), '最初から長い解説が欠けずに表示');
  assert.ok((await page.textContent('#ex-body')).includes(LONG.slice(0, 40)));
  await toggle.tap();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#ex-body').evaluate((el) => [getComputedStyle(el).visibility, Math.round(el.getBoundingClientRect().height)].join()), 'hidden,0');
  await page.screenshot({ path: join(outDir, `ui-${name}-3-explain-closed.png`), fullPage: true });
  // 開く：ボタンの位置が動かない・押した直後から中身が見える（動きの終わりを待たない）
  await toggle.scrollIntoViewIfNeeded();
  const before = (await toggle.boundingBox()).y;
  const immediate = await page.evaluate(() => {
    document.querySelector('.explain-toggle').click();
    const body = document.getElementById('ex-body');
    return getComputedStyle(body).visibility;
  });
  const during = (await toggle.boundingBox()).y;
  await page.waitForTimeout(400);
  const after = (await toggle.boundingBox()).y;
  assert.equal(immediate, 'visible', '開いた直後から読める（動きの終了を待たない）');
  assert.ok(Math.abs(during - before) < 2 && Math.abs(after - before) < 2, `開くときに位置が飛ばない（${before}→${during}→${after}）`);
  assert.ok(await fullyShown(), '開き終わると長い解説が欠けずに表示');
  log(`解説：長い文も欠けずに開閉。開くときボタンの位置は動かない（ずれ ${Math.abs(after - before).toFixed(1)}px）。開いた直後から読める`);
  // 動きの途中でもう一度押しても、最後に押した状態になる
  await page.evaluate(() => { const b = document.querySelector('.explain-toggle'); b.click(); b.click(); b.click(); });
  await page.waitForTimeout(400);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#ex-body').evaluate((el) => getComputedStyle(el).visibility), 'hidden');
  await toggle.tap();
  log('開閉の途中で続けて押しても、最後に押した状態で止まる');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(outDir, `ui-${name}-4-explain-open.png`), fullPage: true });

  /* ---- 5. 進捗バーの動きは表示だけ（保存は先に終わっている） ---- */
  const barAnim = await page.evaluate(() => getComputedStyle(document.querySelector('.q-bar-fill')).transitionDuration);
  assert.notEqual(barAnim, '0s');
  log('進捗バーは動きつきで伸びる（' + barAnim + '）。記録の保存は確定時に済んでいる');
  await ctx.close();
}

/* ---- 6. 「動きを減らす」設定 ---- */
{
  console.log('\n■ 端末の「動きを減らす」設定（iPad）');
  const { ctx, page, settle } = await openPractice(devices['iPad (gen 7)'], { reduce: true });
  await page.locator('[data-act="next"]').tap();
  await settle();
  const dot = await page.locator('[data-act="choose"]').first().evaluate((el) => getComputedStyle(el.querySelector('.choice-dot'), '::after').transitionDuration);
  await page.locator('[data-act="choose"]').first().tap();
  await settle();
  const before = await page.evaluate(() => document.querySelector('.q-bar-fill').style.width);
  await page.locator('#submit-btn').tap();
  const r = await page.evaluate(() => ({
    bar: getComputedStyle(document.querySelector('.q-bar-fill')).transitionDuration,
    collapse: getComputedStyle(document.querySelector('.collapse')).transitionDuration,
    result: getComputedStyle(document.querySelector('.choice-result')).animationName,
    width: document.querySelector('.q-bar-fill').style.width, to: document.querySelector('.q-bar-fill').dataset.to,
  }));
  assert.equal(dot, '0s'); assert.equal(r.bar, '0s'); assert.match(r.collapse, /^0s/); assert.equal(r.result, 'none');
  await page.waitForTimeout(50);
  const w = await page.evaluate(() => document.querySelector('.q-bar-fill').style.width);
  assert.equal(w, r.to + '%', '動きなしで新しい値になる');
  await page.locator('.explain-toggle').tap();
  assert.equal(await page.locator('#ex-body').evaluate((el) => getComputedStyle(el).visibility), 'hidden', '動きなしで閉じる');
  log(`動きを減らす設定では、選択・正誤表示・解説の開閉・進捗バーの動きをすべて止める（進捗 ${before} → ${w}）`);
  await ctx.close();
}

assert.deepEqual(errors, [], 'ページのエラー: ' + errors.join('\n'));
log('ページのエラーなし');
await browser.close();
server.close();
console.log('\nすべての確認が通りました。');
