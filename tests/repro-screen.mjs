// 画面の再現確認：理由（意味）の問いに答える前に、日本語訳・正答・正誤・解説が見えていないか
// 使い方： node tests/repro-screen.mjs
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const p = join(root, path === '/' ? 'index.html' : path);
  try { res.writeHead(200, { 'content-type': types[extname(p)] + '; charset=utf-8' }); res.end(readFileSync(p)); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices['iPad (gen 7) landscape'] })).newPage();
await page.route(/fonts/, (r) => r.abort());
await page.goto(`http://localhost:${server.address().port}/`);
const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.EA.app.getState())));
const q = (id) => page.evaluate((id) => JSON.parse(JSON.stringify(window.EA.findQuestion(window.EA.banks.infinitive, id))), id);
await page.locator('[data-act="task-diagnostic"]').tap();
for (let i = 0; i < 6; i++) {
  const s = await st(); const qq = await q(s.activeSession.items[s.activeSession.index].questionId);
  if (i === 0) await page.locator('[data-act="choose"]').first().tap();
  else if (qq.format === 'fill') await page.locator(`[data-act="choose"][data-choice="${qq.answer}"]`).tap();
  else if (qq.format === 'order') { for (const w of ['I', "don't", 'have', 'time', 'to', 'watch', 'TV', 'Ken', 'went', 'the park', 'play', 'soccer']) { const l = page.locator('.order-pool button.chip', { hasText: new RegExp('^' + w + '$') }); if (await l.count()) await l.first().tap(); } }
  else await page.fill('#ja2en-input', qq.accepted[0]);
  if (await page.locator('#submit-btn').isDisabled()) await page.locator('[data-act="giveup"]').tap(); else await page.locator('#submit-btn').tap();
}
await page.locator('[data-act="task-practice"]').tap();
const findings = [];
for (let guard = 0; guard < 20; guard++) {
  const s = await st(); if (!s.activeSession) break;
  const it = s.activeSession.items[s.activeSession.index];
  if (it.kind === 'explain') { await page.locator('[data-act="next"]').tap(); continue; }
  const qq = await q(it.questionId);
  if (qq.format === 'fill' || qq.format === 'meaning') await page.locator(`[data-act="choose"][data-choice="${qq.answer}"]`).tap();
  else { await page.locator('[data-act="giveup"]').tap(); await page.locator('[data-act="next"]').tap(); continue; }
  await page.locator('#submit-btn').tap();
  if (await page.locator('[data-act="reason"]').count()) {
    const text = await page.textContent('main');
    const ja = qq.ja || '';
    if (ja && text.includes(ja)) findings.push(`${qq.id}: 理由の画面に日本語訳「${ja}」が表示されている`);
    if (text.includes(qq.explanation.translation)) findings.push(`${qq.id}: 理由の画面に訳（解説の訳）が表示されている`);
    if (await page.locator('.verdict, .explain').count()) findings.push(`${qq.id}: 理由の画面に正誤・解説が表示されている`);
    const prompt = await page.textContent('.reason-q');
    const ans = qq.choices.find((c) => c.id === qq.answer).text;
    if (prompt.includes(ans)) findings.push(`${qq.id}: 理由の質問文に正答「${ans}」が含まれる`);
    const s2 = await st(); const sawJa = s2.attempts[s2.attempts.length - 1].translationShown;
    if (sawJa === undefined) findings.push(`${qq.id}: 日本語訳を見たかどうかが記録されていない`);
    break;
  }
  await page.locator('[data-act="next"]').tap();
}
console.log(findings.length ? '再現：\n- ' + findings.join('\n- ') : '問題は見つかりませんでした');
await browser.close(); server.close();
process.exit(findings.length ? 1 : 0);
