// 学習履歴を次の復習に生かす仕組みの、ブラウザでの確認： node tests/history-e2e.mjs
//   1. 画面から答えた記録（正誤・回答内容・自信度・ヒント・項目）が、再読み込み後も残る
//   2. 「自信がない」と申告なしを区別して保存する
//   3. 既存の記録（いまの形式・旧形式・自信度の項目がない記録）をそのまま読み込み、復習を選べる
//   4. 翌日の復習で、間違えた問題・自信がなかった問題を優先して出し、選んだ理由を記録する
//   5. ホームを開いたまま日付が変わっても、画面に戻ると今日の課題に描き直す
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const p = join(root, path === '/' ? 'index.html' : path);
  try { res.writeHead(200, { 'content-type': (types[extname(p)] || 'text/plain') + '; charset=utf-8' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const DAY = 864e5;
const START = new Date(2026, 10, 9, 16, 0).getTime();
const log = (m) => console.log('✓', m);
const errors = [];
const browser = await chromium.launch();
const strip = ({ defaultBrowserType, ...d }) => d;

async function open(dev, seed, at = START) {
  const ctx = await browser.newContext({ ...strip(dev) });
  await ctx.clock.setSystemTime(at);
  if (seed) await ctx.addInitScript(`if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ea-study-v1', ${JSON.stringify(seed)}); sessionStorage.setItem('seeded', '1'); }`);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForSelector('.hero');
  return { ctx, page };
}
const getState = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.EA.app.getState())));
const settle = (p) => p.waitForFunction(() => !window.EA.app.isTapGuarded());
const tap = async (p, sel) => { await settle(p); await p.locator(sel).first().tap(); };
const curQ = (p) => p.evaluate(() => {
  const s = window.EA.app.getState(); const it = s.activeSession.items[s.activeSession.index];
  return JSON.parse(JSON.stringify(window.EA.findQuestion(window.EA.banks.infinitive, it.questionId)));
});
function splitAnswer(q) {
  let rest = q.answers[0]; const out = [];
  while (rest.length) { const t = q.tokens.filter((x) => rest.startsWith(x + ' ') || rest === x).sort((a, b) => b.length - a.length)[0]; out.push(t); rest = rest.slice(t.length).trim(); }
  return out;
}
async function answer(p, q, how) {
  if (q.format === 'fill' || q.format === 'meaning') {
    const id = how === 'correct' ? q.answer : q.choices.find((c) => c.id !== q.answer).id;
    await tap(p, `[data-act="choose"][data-choice="${id}"]`);
  } else if (q.format === 'order') {
    for (const w of splitAnswer(q)) await p.locator('.order-pool button.chip', { hasText: new RegExp('^' + w.replace(/[.*+?^${}()|[\]\\']/g, '\\$&') + '$') }).first().tap();
  } else await p.fill('#ja2en-input', how === 'correct' ? q.accepted[0] : 'I think so.');
}

/* ---------- 1・2・4：画面から学習し、再読み込み・翌日の復習まで ---------- */
{
  const { ctx, page } = await open(devices['iPhone 13']);
  await tap(page, '[data-act="task-diagnostic"]');
  // 1問目：誤答 / 2問目：「自信がない」で正解 / 3問目：ヒントを見て正解 / 残り：正解
  for (let i = 0; i < 6; i++) {
    const q = await curQ(page);
    if (i === 1) await tap(page, '[data-act="unsure"]');
    if (i === 2) await tap(page, '[data-act="hint"]');
    await answer(page, q, i === 0 ? 'wrong' : 'correct');
    await tap(page, '#submit-btn');
  }
  await page.waitForSelector('.result-list');
  await page.reload();
  await page.waitForSelector('.hero');
  let s = await getState(page);
  assert.equal(s.attempts.length, 6);
  const [a0, a1, a2, a3] = s.attempts;
  for (const a of s.attempts) {
    for (const k of ['questionId', 'answeredAt', 'result', 'confidence', 'hintUsed', 'skillId', 'unitId']) assert.ok(a[k] !== undefined, k + ' がある');
    assert.ok('response' in a && 'responseText' in a);
  }
  assert.equal(a0.result, 'incorrect');
  assert.equal(a1.confidence, 'unsure'); assert.equal(a1.result, 'correct');
  assert.equal(a2.hintUsed, true);
  assert.equal(a3.confidence, 'none', '押さなかったときは「申告なし」（自信がないとは区別）');
  log('再読み込み後も、問題ID・日時・正誤・回答内容・自信度・ヒント・項目の記録が残る');
  log('「自信がない」(unsure) と申告なし (none) を区別して保存する');

  // 解説と類題を最後まで（すべて正解）
  await tap(page, '[data-act="task-practice"]');
  for (let guard = 0; guard < 40; guard++) {
    s = await getState(page);
    if (!s.activeSession) break;
    const it = s.activeSession.items[s.activeSession.index];
    if (it.kind === 'explain') { await tap(page, '[data-act="next"]'); continue; }
    if (await page.locator('[data-act="reason"]').count()) {
      const q = await curQ(page);
      await tap(page, `[data-act="reason"][data-choice="${q.reason.answer}"]`);
      continue;
    }
    if (await page.locator('.verdict').count()) { await tap(page, '[data-act="next"]'); continue; }
    await answer(page, await curQ(page), 'correct');
    await tap(page, '#submit-btn');
  }
  await page.waitForSelector('.view-summary');

  // 翌日：復習。診断で間違えた問題・自信がなかった問題が「優先の理由」つきで入る
  await ctx.clock.setSystemTime(START + DAY);
  await page.goto(url);
  await page.waitForSelector('.hero');
  assert.match(await page.textContent('.hero-title'), /今日の復習/);
  await tap(page, '[data-act="task-review"]');
  s = await getState(page);
  const items = s.activeSession.items;
  const why = Object.fromEntries(items.map((it) => [it.questionId, it.pickWhy]));
  assert.ok(items.every((it) => typeof it.pickWhy === 'string'), 'すべての復習問題に選んだ理由がある');
  assert.equal(why[a0.questionId], 'recent-error', '診断で間違えた問題を出す');
  for (const sk of new Set(items.map((it) => it.forSkill))) {
    assert.equal(items.find((it) => it.forSkill === sk).pickWhy, 'other-question', '各項目の1問目は別の問題で確かめる');
  }
  log('翌日の復習：各項目の1問目は別の問題、2問目に間違えた問題を理由つきで出す');
  const firstQ = await curQ(page);
  await answer(page, firstQ, 'correct');
  await tap(page, '#submit-btn');
  await page.reload();
  await page.waitForSelector('.hero');
  s = await getState(page);
  const rev = s.attempts.filter((a) => a.attemptType === 'review');
  assert.equal(rev.length, 1); assert.equal(rev[0].pickWhy, 'other-question');
  log('復習の回答に、その問題を選んだ理由 (pickWhy) が残り、再読み込み後も保持される');
  await ctx.close();
}

/* ---------- 3：既存の記録の読み込み ---------- */
{
  // 旧形式（v1）・自信度の項目がない回答を含む
  const v1 = { schemaVersion: 1, settings: { dailyGoalMinutes: 10 },
    attempts: [
      { id: 'o1', questionId: 'inf-d1', questionVersion: 3, skillId: 'inf-noun', format: 'fill', attemptType: 'diagnostic', sessionId: 'x', result: 'incorrect', hintUsed: false, reason: null, answeredAt: START - 2 * DAY, activeMs: 20000, responseText: 'play' },
      { id: 'o2', questionId: 'inf-d5', questionVersion: 2, skillId: 'inf-noun', format: 'ja2en', attemptType: 'diagnostic', sessionId: 'x', result: 'correct', hintUsed: false, reason: null, answeredAt: START - 2 * DAY + 1000, activeMs: 20000, responseText: 'my dream is to be a teacher' },
    ],
    schedule: { 'inf-noun': { skillId: 'inf-noun', step: 0, intervalDays: 1, dueAt: START - DAY } }, units: { infinitive: { diagnosticDoneAt: START - 2 * DAY, practiceSkippedAt: START - 2 * DAY } }, sessions: [] };
  const { ctx, page } = await open(devices['iPad (gen 7)'], JSON.stringify(v1));
  let s = await getState(page);
  assert.equal(s.schemaVersion, 3); assert.equal(s.attempts.length, 2);
  assert.equal(s.attempts[0].confidence, undefined, '記録になかった自信度を勝手に補わない');
  assert.match(await page.textContent('.hero-title'), /今日の復習/);
  await tap(page, '[data-act="task-review"]');
  s = await getState(page);
  const it = s.activeSession.items;
  assert.equal(it.find((x) => x.questionId === 'inf-d1').pickWhy, 'recent-error');
  assert.ok(!it.some((x) => x.pickWhy === 'low-confidence'), '自信度の記録がない回答を「自信がない」と扱わない');
  log('旧形式の記録を読み込み、記録を減らさず、その履歴から復習問題を選べる');
  await page.reload();
  await page.waitForSelector('.hero');
  s = await getState(page);
  assert.equal(s.attempts.length, 2);
  assert.ok(await page.evaluate(() => !!localStorage.getItem('ea-study-backup-schema1-normal')));
  log('読み込み後の再読み込みでも記録が保たれ、元データの控えも残る');
  await ctx.close();
}

/* ---------- 5：ホームを開いたまま日付が変わる ---------- */
{
  // 診断と類題を終え、次の復習は翌日の状態
  const st = { schemaVersion: 3, mode: 'normal', settings: { dailyGoalMinutes: 10 },
    attempts: [{ id: 'd1', questionId: 'inf-d1', questionVersion: 3, unitId: 'infinitive', skillId: 'inf-noun', format: 'fill', attemptType: 'diagnostic', sessionId: 'x', result: 'incorrect', confidence: 'none', hintUsed: false, afterExplanation: false, translationShown: true, reason: null, answeredAt: START - 3600e3, activeMs: 20000 }],
    schedule: { 'inf-noun': { skillId: 'inf-noun', step: 0, intervalDays: 1, dueAt: new Date(2026, 10, 10).getTime() } },
    units: { infinitive: { diagnosticDoneAt: START, practiceSkippedAt: START } }, sessions: [], activeSession: null, migrations: [] };
  const evening = new Date(2026, 10, 9, 23, 58).getTime();
  const { ctx, page } = await open(devices['iPad (gen 7) landscape'], JSON.stringify(st), evening);
  assert.match(await page.textContent('.hero-title'), /完了/);
  await page.clock.setSystemTime(evening + 5 * 60e3); // 日付が変わる
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => /今日の復習/.test(document.querySelector('.hero-title').textContent));
  log('ホームを開いたまま日付が変わっても、画面に戻ると今日の復習に切り替わる');
  await ctx.close();
}

await browser.close();
server.close();
assert.deepEqual(errors, [], 'ページのエラーなし');
log('ページのエラーなし');
console.log('\nすべての確認が通りました。');
