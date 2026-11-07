// iPad を想定したブラウザでの通し確認： node tests/e2e.mjs
// 通常モード：診断 → 結果 → 解説 → 解き直し → 類題（意味の問いの取り違え → 確認問題）→ まとめ → 再読み込み → 翌日の復習（誤答 → 確認問題）
// デモモード：通常の記録と分離、日付送り、「今日はここまで」
// そのほか：旧形式の記録の読み込み、保存失敗の表示、縦画面・スマホ幅の操作
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
  try { res.writeHead(200, { 'content-type': (types[extname(p)] || 'text/plain') + '; charset=utf-8' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const DAY = 864e5;
const START = new Date(2026, 10, 9, 16, 0).getTime();

const browser = await chromium.launch();
const errors = [];
async function newPage(dev, init) {
  const ctx = await browser.newContext({ ...dev });
  await ctx.clock.setSystemTime(START);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  return { ctx, page };
}
const log = (m) => console.log('✓', m);

let { ctx, page } = await newPage(devices['iPad (gen 7) landscape']);
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.EA.app.getState())));
const curQ = async () => {
  const s = await state();
  const item = s.activeSession.items[s.activeSession.index];
  const q = await page.evaluate((id) => JSON.parse(JSON.stringify(window.EA.findQuestion(window.EA.banks.infinitive, id))), item.questionId);
  return { item, q };
};
const tap = (sel) => page.locator(sel).first().tap();
const shot = (name, p = page) => p.screenshot({ path: join(outDir, name + '.png'), fullPage: true });
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\']/g, '\\$&');
async function placeTokens(words, p = page) {
  for (const w of words) await p.locator('.order-pool button.chip', { hasText: new RegExp('^' + esc(w) + '$') }).first().tap();
}
function splitAnswer(q) {
  let rest = q.answers[0]; const out = [];
  while (rest.length) {
    const t = q.tokens.filter((x) => rest.startsWith(x + ' ') || rest === x).sort((a, b) => b.length - a.length)[0];
    out.push(t); rest = rest.slice(t.length).trim();
  }
  return out;
}
async function answer(q, how = 'correct', p = page) {
  if (q.format === 'fill' || q.format === 'meaning') {
    const id = how === 'correct' ? q.answer : q.choices.find((c) => c.id !== q.answer).id;
    await p.locator(`[data-act="choose"][data-choice="${id}"]`).tap();
  } else if (q.format === 'order') {
    const words = splitAnswer(q); await placeTokens(how === 'correct' ? words : words.reverse(), p);
  } else await p.fill('#ja2en-input', how === 'correct' ? q.accepted[0] : 'I think so.');
}
async function reasonIfAsked(q, correct = true) {
  if (await page.locator('[data-act="reason"]').count()) {
    const id = correct ? q.reason.answer : q.reason.choices.find((c) => c.id !== q.reason.answer).id;
    await page.locator(`[data-act="reason"][data-choice="${id}"]`).tap();
    return true;
  }
  return false;
}

/* ============ 通常モード：初回診断 ============ */
await page.goto(url);
await page.waitForSelector('.hero');
await shot('01-home-first');
assert.match(await page.textContent('.hero-title'), /初回診断/);
log('ホームに「不定詞の初回診断」が表示される');

await tap('[data-act="task-diagnostic"]');
let { q } = await curQ();
assert.equal(await page.locator('#submit-btn').isDisabled(), true);
await tap('[data-act="choose"][data-choice="a"]');
await shot('02-question-fill');
await tap('#submit-btn');
assert.equal(await page.locator('.verdict').count(), 0, '診断中は正誤を出さない');
log('診断中は1問ごとの正誤・解説を表示しない');
({ q } = await curQ());
await tap('[data-act="unsure"]');
await answer(q);
await tap('#submit-btn');
({ q } = await curQ());
await answer(q);
await shot('03-question-order');
await tap('#submit-btn');
({ q } = await curQ());
await placeTokens(['Ken', 'went']);
await page.reload();
await page.waitForSelector('.hero');
assert.match(await page.textContent('.hero-title'), /続き/);
await tap('[data-act="task-resume"]');
assert.equal((await page.locator('.order-answer .chip').allTextContents()).join(' '), 'Ken went');
assert.match(await page.textContent('.q-count'), /4 \/ 6/);
log('途中で再読み込みしても、並べかけの語句まで続きから再開できる');
const box = await page.locator('.order-pool button.chip', { hasText: /^the park$/ }).boundingBox();
const target = await page.locator('.order-answer').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 30, box.y - 40, { steps: 5 });
await page.mouse.move(target.x + target.width - 20, target.y + target.height / 2, { steps: 8 });
await page.mouse.up();
assert.deepEqual(await page.locator('.order-answer .chip').allTextContents(), ['Ken', 'went', 'the park']);
log('並び替えはドラッグでも操作できる');
await page.waitForTimeout(500);
await page.locator('.order-answer .chip', { hasText: 'the park' }).tap();
await placeTokens(['to', 'the park', 'to', 'play', 'soccer']);
await tap('#submit-btn');
({ q } = await curQ());
assert.match(await page.textContent('.q-instruction'), /to＋動詞の原形 を使って/);
log('英作文の指示に「to＋動詞の原形を使って」が最初から書かれている');
await page.fill('#ja2en-input', '  my dream is BEING a teacher ');
await shot('04-question-ja2en');
await tap('#submit-btn');
await tap('[data-act="hint"]');
await page.fill('#ja2en-input', "I'd like a book to read.");
await tap('#submit-btn');

await page.waitForSelector('.result-list');
await shot('05-results');
const badges = await page.locator('.result-row .badge').allTextContents();
assert.match(badges[0], /×不正解/); assert.match(badges[4], /△指定の形/); assert.match(badges[5], /○正解/);
assert.ok(!badges.join('').includes('正しい英文'), '別の形の答えを「正しい英文」と表示しない');
assert.match(await page.locator('.result-row').nth(5).textContent(), /ヒントあり/);
assert.match(await page.locator('.result-row').nth(1).textContent(), /自信がない/);
let s = await state();
assert.equal(s.attempts[0].confidence, 'none');
assert.equal(s.attempts[1].confidence, 'unsure');
assert.ok(s.attempts.every((a) => a.reason === null), '診断では理由を聞かない');
log('結果画面：○×△の記号と文字、ヒント・自信がないを区別。押さなかった自信は「申告なし」');

/* ============ 解説と類題：意味の問いを取り違える → 確認問題 ============ */
await tap('[data-act="task-practice"]');
let shotExplain = false, reasonDone = false, sawFollowupNote = false, followupAnswered = false;
for (let guard = 0; guard < 40; guard++) {
  if (await page.locator('.plan-list').count()) break;
  const st = await state();
  const it = st.activeSession.items[st.activeSession.index];
  if (it.kind === 'explain') {
    if (!shotExplain) { await shot('06-explanation'); shotExplain = true; }
    await tap('[data-act="next"]'); continue;
  }
  ({ q } = await curQ());
  await answer(q);
  await tap('#submit-btn');
  if (await page.locator('[data-act="reason"]').count()) {
    if (!reasonDone) {
      await shot('07-reason');
      const prompt = await page.textContent('.reason-q');
      assert.ok(!prompt.includes(q.choices?.find((c) => c.id === q.answer)?.text ?? '@@'), '意味の問いに正答が書かれていない');
      await reasonIfAsked(q, false); reasonDone = true;
      await page.waitForSelector('.verdict');
      assert.match(await page.textContent('.reason-result'), /選んだ意味とは違います/);
      assert.match(await page.textContent('.verdict'), /○正解/);
      assert.match(await page.textContent('.next-note'), /もう一度確かめます/);
      sawFollowupNote = true;
      await shot('08-feedback-reason-wrong');
    } else await reasonIfAsked(q, true);
  }
  await page.waitForSelector('.verdict');
  if (it.attemptType === 'followup') { followupAnswered = true; }
  await tap('[data-act="next"]');
  if (!followupAnswered && sawFollowupNote && (await state()).activeSession?.items[(await state()).activeSession.index]?.attemptType === 'followup') {
    await shot('09-followup-question');
  }
}
await page.waitForSelector('.plan-list');
await shot('10-summary');
assert.ok(sawFollowupNote && followupAnswered, '意味の取り違えのあと、確認問題が出た');
s = await state();
const d1 = s.attempts.filter((a) => a.questionId === 'inf-d1').map((a) => a.attemptType + ':' + a.result);
assert.deepEqual(d1, ['diagnostic:incorrect', 'retry:correct']);
assert.ok(s.attempts.filter((a) => a.sessionType === 'practice').every((a) => a.afterExplanation));
log('初回の誤答と解説後の解き直しが別々に記録され、解説後の回答には「解説後」の印がつく');
log('答えは正解・意味の問いが違う → その場で説明し、意味の確認問題が出る');
const days = (k) => Math.round((new Date(s.schedule[k].dueAt).setHours(0) - new Date(START).setHours(0, 0, 0, 0)) / DAY);
assert.deepEqual([days('inf-noun'), days('inf-adj'), days('inf-adv')], [1, 1, 1]);
log('つまずき・ヒント・自信なしがある項目は、すべて翌日に再確認');

await page.reload();
await page.waitForSelector('.hero');
assert.match(await page.textContent('.hero-title'), /完了/);
await shot('11-home-done');
await tap('[data-go="settings"]');
assert.equal(await page.locator('[data-act="dev-add"]').count(), 0, '通常の利用では日付操作を出さない');
log('通常の利用では、開発用の日付操作が表示されない');

/* ============ 翌日：復習（1問目を間違える） ============ */
await ctx.clock.setSystemTime(START + DAY);
await page.goto(url);
await page.waitForSelector('.hero');
assert.match(await page.textContent('.hero-title'), /今日の復習/);
await shot('12-home-review');
log('翌日、ホームに「今日の復習」が出る');
await tap('[data-act="task-review"]');
s = await state();
const firstReview = s.activeSession.items[0];
const issueQs = s.attempts.filter((a) => a.skillId === firstReview.forSkill && a.result === 'incorrect').map((a) => a.questionId);
assert.ok(!issueQs.includes(firstReview.questionId), '1問目はつまずいた問題とは別の問題');
({ q } = await curQ());
await answer(q, 'wrong');
await tap('#submit-btn');
await page.waitForSelector('.verdict');
assert.match(await page.textContent('.next-note'), /もう一度確かめます/);
await shot('13-review-wrong-feedback');
await tap('[data-act="next"]');
for (let guard = 0; guard < 20; guard++) {
  if (await page.locator('.plan-list').count()) break;
  ({ q } = await curQ());
  await answer(q);
  await tap('#submit-btn');
  await reasonIfAsked(q, true);
  await page.waitForSelector('.verdict');
  await tap('[data-act="next"]');
}
s = await state();
assert.ok(s.attempts.some((a) => a.sessionType === 'review' && a.attemptType === 'followup'), '復習でも確認問題が出る');
const st = await page.evaluate((sk) => JSON.parse(JSON.stringify(window.EA.mastery.analyze(sk, window.EA.app.getState().attempts, window.EA.banks.infinitive))), firstReview.forSkill);
assert.ok(st.needsRecheck, '直後の確認問題に正解しても、最近の誤答は残る');
log('復習で誤答 → 説明と確認問題。直後の正解だけでは「再確認が必要」は消えない');
await shot('14-review-summary');
await tap('[data-go="history"]');
await shot('15-history');
await page.locator('.skill-panel details summary', { hasText: '判定の根拠' }).first().tap();
await shot('16-history-evidence');
await tap('[data-act="tab"][data-tab="answers"]');
await page.locator('.att-row').first().tap();
await shot('17-question-detail');
await tap('[data-go="home"]');
await shot('18-home-after-review');
log('履歴・復習一覧で、いまの状態・実績・根拠・過去の回答を見返せる');
const normalCount = (await state()).attempts.length;

/* ============ デモモード：通常の記録と分離 ============ */
await tap('[data-go="settings"]');
await page.locator('details.dev summary').tap();
await tap('[data-act="demo-enter"]');
assert.ok(await page.locator('.devbar').isVisible());
assert.equal((await state()).attempts.length, 0, 'デモは空の記録から');
await tap('[data-act="task-diagnostic"]');
for (let i = 0; i < 6; i++) { ({ q } = await curQ()); await answer(q); await tap('#submit-btn'); }
await page.waitForSelector('.result-list');
await tap('[data-act="skip-practice"]');
await tap('[data-go="settings"]');
await tap('[data-act="dev-add"][data-days="3"]');
await tap('[data-go="home"]');
assert.match(await page.textContent('.hero-title'), /今日の復習/);
await tap('[data-act="task-review"]');
({ q } = await curQ()); await answer(q); await tap('#submit-btn'); await reasonIfAsked(q, true);
await tap('[data-act="stop-today"]');
await page.waitForSelector('.plan-list');
assert.match(await page.textContent('main'), /今日はここまで/);
await shot('19-demo-stop-today');
log('デモモード：日付を進めて復習が出る。「今日はここまで」で終えられる');
await tap('[data-go="settings"]');
await tap('[data-act="demo-exit"]');
s = await state();
assert.equal(s.mode, 'normal');
assert.equal(s.attempts.length, normalCount, '通常の記録はデモの前と同じ');
assert.equal(await page.evaluate(() => localStorage.getItem('ea-study-demo-v1')), null);
log('デモを終えると、通常の記録は元のまま・デモの記録は削除');
await ctx.close();

/* ============ 旧形式の記録を読み込む ============ */
const v1 = { schemaVersion: 1, settings: { dailyGoalMinutes: 10, devDayOffset: 2 },
  attempts: [{ id: 'old1', questionId: 'inf-d1', questionVersion: 1, skillId: 'inf-noun', format: 'fill', attemptType: 'diagnostic', sessionId: 'x', result: 'correct', confidence: 'none', hintUsed: false, reason: null, answeredAt: START - DAY, activeMs: 20000, responseText: 'to play' }],
  schedule: {}, units: { infinitive: { diagnosticDoneAt: START - DAY, diagnosticSessionId: 'x' } }, activeSession: null, sessions: [] };
({ ctx, page } = await newPage(devices['iPad (gen 7) landscape'], `if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ea-study-v1', ${JSON.stringify(JSON.stringify(v1))}); sessionStorage.setItem('seeded', '1'); }`));
await page.goto(url);
await page.waitForSelector('.hero');
assert.match(await page.textContent('.warnbar'), /引き継ぎました/);
s = await state();
assert.equal(s.schemaVersion, 2); assert.equal(s.attempts.length, 1);
assert.ok(await page.evaluate(() => !!localStorage.getItem('ea-study-backup-schema1-normal')));
log('旧形式の記録を読み込み、元データの控えを残す');
await ctx.close();

/* ============ 保存に失敗したとき ============ */
({ ctx, page } = await newPage(devices['iPad (gen 7) landscape'], `Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); };`));
await page.goto(url);
await page.waitForSelector('.hero');
assert.match(await page.textContent('.warnbar'), /保存できませんでした/);
await tap('[data-act="task-diagnostic"]');
await tap('[data-act="quit"]');
assert.ok(!(await page.textContent('main')).includes('途中まで保存しました'), '保存できていないのに「保存しました」と出さない');
log('保存に失敗したときは警告を出し、「保存しました」とは表示しない');
await ctx.close();

/* ============ 縦画面・スマホ幅 ============ */
for (const [name, dev] of [['portrait', devices['iPad (gen 7)']], ['phone', devices['iPhone 13']]]) {
  const r = await newPage(dev);
  const p2 = r.page;
  await p2.goto(url);
  await p2.waitForSelector('.hero');
  await p2.screenshot({ path: join(outDir, `20-${name}-home.png`), fullPage: true });
  await p2.locator('[data-act="task-diagnostic"]').tap();
  await p2.locator('[data-act="choose"]').first().tap(); await p2.locator('#submit-btn').tap();
  await p2.locator('[data-act="choose"]').first().tap(); await p2.locator('#submit-btn').tap();
  await placeTokens(['I', "don't", 'have'], p2);
  assert.deepEqual(await p2.locator('.order-answer .chip').allTextContents(), ['I', "don't", 'have']);
  await p2.screenshot({ path: join(outDir, `21-${name}-order.png`), fullPage: true });
  await placeTokens(['time', 'to', 'watch', 'TV'], p2); await p2.locator('#submit-btn').tap();
  await p2.locator('.order-pool button.chip').first().tap();
  await p2.locator('[data-act="giveup"]').tap();
  await p2.fill('#ja2en-input', 'My dream is to be a teacher.');
  assert.equal(await p2.locator('#submit-btn').isDisabled(), false);
  await p2.screenshot({ path: join(outDir, `22-${name}-ja2en.png`), fullPage: true });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, name + ' で横スクロール: ' + overflow);
  // 押せないボタンがないか：主なボタンが他の要素に隠れていない
  for (const sel of ['#submit-btn', '[data-act="unsure"]', '[data-act="hint"]', '[data-act="giveup"]', '[data-act="quit"]']) {
    const ok = await p2.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (el === top || el.contains(top)); }).catch(() => 'offscreen');
    if (ok === 'offscreen') continue;
    if (!ok) { await p2.locator(sel).first().scrollIntoViewIfNeeded(); }
    const ok2 = await p2.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (el === top || el.contains(top)); });
    assert.ok(ok2, name + '：' + sel + ' が他の要素に隠れている');
  }
  log(name + '：入力欄・ボタン・並び替えを操作でき、横スクロールや重なりなし');
  await r.ctx.close();
}

assert.deepEqual(errors, [], 'ページのエラー: ' + errors.join('\n'));
log('ページのエラーなし');
await browser.close();
server.close();
console.log('\nすべての確認が通りました。スクリーンショット:', outDir);
