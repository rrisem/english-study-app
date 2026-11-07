// iPad を想定したブラウザでの通し確認： node tests/e2e.mjs
// 診断 → 結果 → 解説 → 解き直し → 類題 → まとめ → 再読み込み → 日付を進めて復習 まで
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
  const p = join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  try { res.writeHead(200, { 'content-type': (types[extname(p)] || 'text/plain') + '; charset=utf-8' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPad (gen 7) landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.EA.app.getState())));
const curQ = async () => {
  const s = await state();
  const item = s.activeSession.items[s.activeSession.index];
  const q = await page.evaluate((id) => JSON.parse(JSON.stringify(window.EA.findQuestion(window.EA.banks.infinitive, id))), item.questionId);
  return { item, q };
};
const tap = (sel) => page.locator(sel).first().tap();
const shot = (name) => page.screenshot({ path: join(outDir, name + '.png'), fullPage: true });
const log = (m) => console.log('✓', m);

async function placeTokens(q, order) {
  for (const word of order) {
    await page.locator('.order-pool button.chip', { hasText: new RegExp('^' + word.replace(/[.*+?^${}()|[\]\\']/g, '\\$&') + '$') }).first().tap();
  }
}
async function answerCorrect(q) {
  if (q.format === 'fill' || q.format === 'meaning') await tap(`[data-act="choose"][data-choice="${q.answer}"]`);
  else if (q.format === 'order') await placeTokens(q, q.tokens.length && q.answers[0] ? splitAnswer(q) : []);
  else await page.fill('#ja2en-input', q.accepted[0]);
}
function splitAnswer(q) {
  // 正答文を語句（tokens）に分ける
  let rest = q.answers[0]; const out = [];
  while (rest.length) {
    const t = q.tokens.filter((x) => rest.startsWith(x + ' ') || rest === x).sort((a, b) => b.length - a.length)[0];
    out.push(t); rest = rest.slice(t.length).trim();
  }
  return out;
}

await page.goto(url);
await page.waitForSelector('.hero');
await shot('01-home-first');
assert.match(await page.textContent('.hero-title'), /初回診断/);
log('ホームに「不定詞の初回診断」が表示される');

await tap('[data-act="task-diagnostic"]');
// Q1 不正解（play）
let { q } = await curQ();
assert.equal(q.id, 'inf-d1');
assert.equal(await page.locator('#submit-btn').isDisabled(), true);
await tap('[data-act="choose"][data-choice="a"]');
await shot('02-question-fill');
await tap('#submit-btn');
assert.equal(await page.locator('.verdict').count(), 0, '診断中は正誤を出さない');
log('診断中は1問ごとの正誤・解説を表示しない');
// Q2 自信がない＋正解
({ q } = await curQ());
await tap('[data-act="unsure"]');
await answerCorrect(q);
await tap('#submit-btn');
// Q3 並び替え（タップ）正解
({ q } = await curQ());
await answerCorrect(q);
await shot('03-question-order');
await tap('#submit-btn');
// Q4 並び替え：途中で再読み込み
({ q } = await curQ());
await placeTokens(q, ['Ken', 'went']);
await page.reload();
await page.waitForSelector('.hero');
assert.match(await page.textContent('.hero-title'), /続き/);
await tap('[data-act="task-resume"]');
assert.equal((await page.locator('.order-answer .chip').allTextContents()).join(' '), 'Ken went');
assert.match(await page.textContent('.q-count'), /4 \/ 6/);
log('途中で再読み込みしても、続き（並べかけの語句まで）から再開できる');
// 残りの語句をドラッグで1つ入れてみる
const poolChip = page.locator('.order-pool button.chip', { hasText: /^the park$/ });
const box = await poolChip.boundingBox();
const target = await page.locator('.order-answer').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 30, box.y - 40, { steps: 5 });
await page.mouse.move(target.x + target.width - 20, target.y + target.height / 2, { steps: 8 });
await page.mouse.up();
let placed = await page.locator('.order-answer .chip').allTextContents();
assert.deepEqual(placed, ['Ken', 'went', 'the park']);
log('並び替えはドラッグでも操作できる');
await page.waitForTimeout(500);
// 解答欄の chip をタップで戻す
await page.locator('.order-answer .chip', { hasText: 'the park' }).tap();
assert.deepEqual(await page.locator('.order-answer .chip').allTextContents(), ['Ken', 'went']);
await placeTokens(q, ['to', 'the park', 'to', 'play', 'soccer']);
await tap('#submit-btn');
// Q5 動名詞（別の正しい表現）
({ q } = await curQ());
await page.fill('#ja2en-input', '  my dream is BEING a teacher ');
await shot('04-question-ja2en');
await tap('#submit-btn');
// Q6 ヒントを見てから正解
({ q } = await curQ());
await tap('[data-act="hint"]');
assert.ok(await page.locator('.hint').isVisible());
await page.fill('#ja2en-input', "I'd like a book to read.");
await tap('#submit-btn');

await page.waitForSelector('.result-list');
await shot('05-results');
const badges = await page.locator('.result-row .badge').allTextContents();
assert.match(badges[0], /×不正解/); assert.match(badges[4], /△別の正しい表現/); assert.match(badges[5], /○正解/);
const flags = await page.locator('.result-row').nth(5).textContent();
assert.match(flags, /ヒントあり/);
assert.match(await page.locator('.result-row').nth(1).textContent(), /自信がない/);
log('結果画面：○×△の記号と文字で表示、ヒント・自信がないも区別');

let s = await state();
assert.equal(s.attempts.length, 6);
assert.ok(s.attempts.every((a) => a.attemptType === 'diagnostic' && a.questionVersion === 1 && a.skillId && a.format && a.answeredAt && a.activeMs >= 0));
assert.equal(s.attempts[1].confidence, 'unsure');
assert.equal(s.attempts[0].confidence, 'none');
assert.equal(s.attempts[5].hintUsed, true);
log('回答・問題の版・形式・自信・ヒント・日時・時間が保存される');

// 解説と類題
await tap('[data-act="task-practice"]');
let retryCount = 0, similarCount = 0;
for (let guard = 0; guard < 30; guard++) {
  if (await page.locator('.plan-list').count()) break;
  const st = await state();
  const sess = st.activeSession; const item = sess.items[sess.index];
  if (item.kind === 'explain') {
    if (guard === 0) await shot('06-explanation');
    await tap('[data-act="next"]'); continue;
  }
  ({ q } = await curQ());
  await answerCorrect(q);
  await tap('#submit-btn');
  if (await page.locator('[data-act="reason"]').count()) {
    if (similarCount === 0) await shot('07-reason');
    await tap(`[data-act="reason"][data-choice="${q.reason.answer}"]`);
  }
  await page.waitForSelector('.verdict');
  if (item.attemptType === 'retry') retryCount++; else similarCount++;
  if (similarCount === 1 && item.attemptType === 'similar') await shot('08-feedback');
  await tap('[data-act="next"]');
}
await page.waitForSelector('.plan-list');
await shot('09-summary');
assert.equal(retryCount, 2, '誤答 d1 と別表現 d5 は解き直し'); assert.equal(similarCount, 4);
s = await state();
const d1 = s.attempts.filter((a) => a.questionId === 'inf-d1').map((a) => a.attemptType + ':' + a.result);
assert.deepEqual(d1, ['diagnostic:incorrect', 'retry:correct']);
assert.ok(s.attempts.filter((a) => a.attemptType === 'similar').every((a) => !a.questionId.startsWith('inf-d')));
log('初回の誤答と解説後の解き直しの正解が別々に記録され、類題は別の問題が出る');
const sched = s.schedule;
const t = await page.evaluate(() => window.EA.clock.now());
const days = (k) => Math.round((new Date(sched[k].dueAt).setHours(0) - new Date(t).setHours(0, 0, 0, 0)) / 864e5);
console.log('  復習予定（日後）:', Object.fromEntries(Object.keys(sched).map((k) => [k, days(k)])));
assert.equal(days('inf-noun'), 1); assert.equal(days('inf-adv'), 1); assert.equal(days('inf-adj'), 1);
log('解説直後の正解だけでは間隔を延ばさない（全項目 1日後）');

await page.reload();
await page.waitForSelector('.hero');
assert.match(await page.textContent('.hero-title'), /完了/);
assert.match(await page.textContent('.hero-detail'), /明日/);
s = await state();
assert.equal(s.attempts.length, 12);
await shot('10-home-done');
log('再読み込み後も記録が残り、ホームに次の復習日が出る');

// 日付を進めて復習
await tap('[data-go="settings"]');
await tap('[data-act="dev-add"][data-days="1"]');
assert.ok(await page.locator('.devbar').isVisible());
await tap('[data-go="home"]');
assert.match(await page.textContent('.hero-title'), /復習/);
await shot('11-home-review');
log('日付を1日進めると、ホームに「今日の復習」が出る');
await tap('[data-act="task-review"]');
s = await state();
const reviewIds = s.activeSession.items.map((i) => i.questionId);
console.log('  復習の問題:', reviewIds.join(', '));
assert.equal(s.activeSession.items.length, 6);
for (let guard = 0; guard < 20; guard++) {
  if (await page.locator('.plan-list').count()) break;
  ({ q } = await curQ());
  await answerCorrect(q);
  await tap('#submit-btn');
  if (await page.locator('[data-act="reason"]').count()) await tap(`[data-act="reason"][data-choice="${q.reason.answer}"]`);
  await page.waitForSelector('.verdict');
  await tap('[data-act="next"]');
}
s = await state();
const t2 = await page.evaluate(() => window.EA.clock.now());
const days2 = (k) => Math.round((new Date(s.schedule[k].dueAt).setHours(0) - new Date(t2).setHours(0, 0, 0, 0)) / 864e5);
assert.equal(days2('inf-noun'), 3);
log('復習で自力正解すると、間隔が 1日 → 3日に延びる');
assert.ok(await page.evaluate(() => window.EA.banks.infinitive.skills.every((sk) => window.EA.mastery.computeSkillStatus(sk.id, window.EA.app.getState().attempts, window.EA.banks.infinitive).level === 2)));
log('1日後の復習だけでは「時間を空けても解けた」にしない（「別の問題でも自力で解けた」まで）');
await tap('[data-go="settings"]');
await tap('[data-act="dev-add"][data-days="3"]');
await tap('[data-go="home"]');
await tap('[data-act="task-review"]');
for (let guard = 0; guard < 20; guard++) {
  if (await page.locator('.plan-list').count()) break;
  ({ q } = await curQ());
  await answerCorrect(q);
  await tap('#submit-btn');
  if (await page.locator('[data-act="reason"]').count()) await tap(`[data-act="reason"][data-choice="${q.reason.answer}"]`);
  await page.waitForSelector('.verdict');
  await tap('[data-act="next"]');
}
assert.match(await page.textContent('.plan-list'), /時間を空けても解けた/);
log('さらに3日後の復習で自力正解 →「時間を空けても解けた」');
await tap('[data-go="home"]');
await shot('12-home-after-review');
await tap('[data-go="history"]');
await shot('13-history');
await tap('[data-act="tab"][data-tab="answers"]');
assert.ok((await page.locator('.att-row').count()) >= 24);
await page.locator('.att-row').first().tap();
await shot('14-question-detail');
log('履歴・復習一覧で解説と過去の回答を見返せる');

// 縦画面・スマホ幅で横スクロールが出ないか
for (const [name, dev] of [['portrait', devices['iPad (gen 7)']], ['phone', devices['iPhone 13']]]) {
  const c2 = await browser.newContext({ ...dev });
  const p2 = await c2.newPage();
  await p2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p2.goto(url);
  await p2.waitForSelector('.hero');
  await p2.screenshot({ path: join(outDir, `20-${name}-home.png`), fullPage: true });
  await p2.locator('[data-act="task-diagnostic"]').tap();
  await p2.locator('[data-act="choose"]').first().tap(); await p2.locator('#submit-btn').tap();
  await p2.locator('[data-act="choose"]').first().tap(); await p2.locator('#submit-btn').tap();
  await p2.screenshot({ path: join(outDir, `21-${name}-order.png`), fullPage: true });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, name + ' で横スクロールが出ている: ' + overflow);
  log(name + '：横スクロールなし');
  await c2.close();
}

assert.deepEqual(errors, [], 'ページのエラー: ' + errors.join('\n'));
log('ページのエラーなし');
await browser.close();
server.close();
console.log('\nすべての確認が通りました。スクリーンショット:', outDir);
