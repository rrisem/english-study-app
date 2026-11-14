/*
 * 今日の学習・今日の記録・講師の日別確認の動作確認（Chromium・ヘッドレス、iPad の画面幅）。 node tests/daily.check.cjs
 * 端末の時刻帯を America/New_York にして、日本時間で日付を数えていることも確かめます。
 * iPad の Safari 実機での確認ではありません。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve(__dirname, '..', 'eibunpo-drill.html');
const OUT = path.resolve(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function ok(name, cond, detail) { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE); await page.waitForSelector('.topbar');

  ok('記録がない日は「今日の学習記録はまだありません」', (await page.textContent('.today-card')).includes('今日の学習記録はまだありません'));
  ok('既存の開始ボタンが使える', await page.isVisible('[data-act="task-diagnostic"]'));

  const cur = () => page.evaluate(() => {
    const s = EA.app.getState().activeSession; const it = s.items[s.index]; const q = EA.findQuestion(EA.banks[s.unitId], it.questionId);
    return { id: q.id, answer: q.answer, ids: q.choices.map((c) => c.id), retryOf: it.retryOf || null };
  });
  const answer = async (right) => {
    const q = await cur();
    const id = right ? q.answer : q.ids.find((x) => x !== q.answer);
    await page.click(`[data-act="choose"][data-choice="${id}"]`);
    await page.click('#submit-btn'); await page.waitForTimeout(300);
    return q;
  };
  const next = async () => { await page.click('[data-act="next"]'); await page.waitForTimeout(300); };
  const giveup = async () => { const q = await cur(); await page.click('[data-act="giveup"]'); await page.click('[data-cx="open"]'); await page.waitForTimeout(300); return q; };

  // Lv1：1問目 誤答 → 解き直し（別の問題）で正解／2問目「解説をみる」→ 解き直しも「解説をみる」
  await page.click('[data-act="task-diagnostic"]'); await page.waitForTimeout(300);
  const q1 = await answer(false); await next();
  const r1 = await answer(true); await next();
  ok('1問目の解き直しは別の問題（retryOf）', r1.retryOf === q1.id && r1.id !== q1.id, r1.id);
  const q2 = await giveup(); await next();
  const r2 = await giveup(); await next();
  ok('2問目の解き直しも出た', r2.retryOf === q2.id);
  await page.click('[data-act="save-home"]'); await page.waitForTimeout(300);

  const card = (await page.textContent('.today-card')).replace(/\s+/g, '');
  ok('ホーム：2問取り組んだ', card.includes('2問取り組んだ'), card);
  ok('ホーム：解き直しで1問正解', card.includes('解き直しで1問正解'), card);
  await page.screenshot({ path: path.join(OUT, 'daily-home.png') });

  await page.click('[data-act="today-open"]'); await page.waitForTimeout(200);
  const rows = await page.$$eval('.rec-row', (els) => els.map((e) => e.textContent.replace(/\s+/g, '')));
  ok('今日の記録：2行', rows.length === 2, rows.join(' | '));
  ok('1問目：初回は誤答 → 解き直しで正解', rows[0] && rows[0].includes('初回は誤答') && rows[0].includes('解き直しで正解'));
  ok('2問目：解説を読んだ', rows[1] && rows[1].includes('解説を読んだ'));
  await page.screenshot({ path: path.join(OUT, 'daily-today.png'), fullPage: true });
  await page.click('.rec-row >> nth=0'); await page.waitForTimeout(200);
  const det = await page.textContent('#main');
  ok('詳細：最初の回答と解き直しの両方', det.includes('1回目（最初の回答）') && det.includes('解き直し（同じ形の別の問題）'));
  ok('詳細：正答・解説', det.includes('正答') && (await page.$$('.rec-explain')).length === 2);
  ok('詳細：自分の誤答と解き直しの正解', det.includes('× あなたの答え') && det.includes('✓ 正解・あなたの答え'));
  await page.screenshot({ path: path.join(OUT, 'daily-record.png'), fullPage: true });

  // 生徒：コードを作る
  await page.click('[data-go="settings"]');
  await page.fill('#profile-name', '山田 花子');
  await page.click('[data-act="send-make"]'); await page.waitForSelector('#send-box');
  const code = await page.inputValue('#send-box');
  ok('コードができた', /^EAREC1[ZP]\./.test(code), code.length + '文字');

  // 講師：暗証番号 → 生徒の記録 → 取り込み
  const openTeacher = async () => { await page.click('details:has([data-act="teacher-records"]) > summary'); await page.click('[data-act="teacher-records"]'); };
  await openTeacher();
  await page.fill('#pin-new', '1234'); await page.fill('#pin-new2', '1234'); await page.click('.pin-form button[type="submit"]'); await page.waitForTimeout(200);
  ok('講師：生徒の記録タブ', (await page.textContent('#tt-title')) === '生徒の記録');
  await page.fill('#tr-code', code); await page.click('[data-act="tr-import"]'); await page.waitForSelector('.tr-card');
  const stats = async () => page.$$eval('.tr-card .tr-num', (e) => e.map((x) => +x.textContent));
  let s = await stats();
  ok('講師：取り組んだ2・誤答1・解説1', s.join(',') === '2,1,1', s.join(','));
  const nAtt = () => page.evaluate(() => { const st = EA.storage.getTeacherRecords(); return Object.values(st.students).map((x) => Object.keys(x.attempts).length + '/' + x.imports.length); });
  const before = await nAtt();
  await page.fill('#tr-code', code); await page.click('[data-act="tr-import"]'); await page.waitForTimeout(400);
  s = await stats();
  ok('再取り込みで件数が増えない', s.join(',') === '2,1,1' && JSON.stringify(await nAtt()) === JSON.stringify(before), (await nAtt()).join());
  ok('再取り込みの案内', (await page.textContent('#main')).includes('前にも取り込んでいます'));
  // 作り直したコード（同じ記録）でも増えない
  await page.click('[data-act="teacher-back"]'); await page.click('[data-act="send-make"]'); await page.waitForSelector('#send-box');
  const code2 = await page.inputValue('#send-box');
  await openTeacher(); await page.fill('#pin-input', '1234'); await page.click('.pin-form button[type="submit"]'); await page.waitForTimeout(200);
  await page.fill('#tr-code', code2); await page.click('[data-act="tr-import"]'); await page.waitForTimeout(400);
  ok('作り直したコードでも回答数は増えない', (await stats()).join(',') === '2,1,1' && (await nAtt())[0].split('/')[0] === before[0].split('/')[0]);
  await page.screenshot({ path: path.join(OUT, 'daily-teacher-list.png'), fullPage: true });

  await page.click('.tr-card'); await page.waitForTimeout(200);
  ok('講師：生徒の詳細に2問', (await page.$$('.tr-item')).length === 2);
  await page.click('.tr-item >> nth=0 >> summary');
  const t1 = await page.textContent('.tr-item >> nth=0');
  ok('講師：誤答の問題に、実際の回答・正答・解き直しの結果・自信・ヒント', t1.includes('× あなたの答え') && t1.includes('解き直し（同じ形の別の問題）') && t1.includes('自信') && t1.includes('ヒント'));
  await page.screenshot({ path: path.join(OUT, 'daily-teacher-student.png'), fullPage: true });

  // 前の日：記録未受領（このコードは今日始めた記録）
  await page.click('[data-act="tr-student"][data-student=""]'); await page.click('[data-act="tr-day"] >> nth=0'); await page.waitForTimeout(200);
  ok('前の日は「記録未受領」', (await page.textContent('.tr-card')).includes('記録未受領'));

  // 集計ルール（日本時間の午前0時・同じ問題の複数回・日時なし・受領状況）
  const logic = await page.evaluate(() => {
    const D = EA.daily;
    const mk = (id, q, t, result, extra) => Object.assign({ id, questionId: q, answeredAt: t ? Date.parse(t) : undefined, result, activeMs: 30000 }, extra || {});
    const atts = [
      mk('a1', 'inf-lv1-01', '2026-11-14T14:59:59Z', 'incorrect'),                                // 日本時間 11/14 23:59:59
      mk('a2', 'inf-lv1-01-r1', '2026-11-14T15:00:01Z', 'correct', { retryOf: 'inf-lv1-01' }),     // 日本時間 11/15 0:00:01
      mk('a3', 'inf-lv1-02', '2026-11-15T01:00:00Z', 'incorrect'),
      mk('a4', 'inf-lv1-02', '2026-11-15T02:00:00Z', 'incorrect'),
      mk('a5', 'inf-lv1-02-r1', '2026-11-15T02:01:00Z', 'correct', { retryOf: 'inf-lv1-02' }),
      mk('a6', 'inf-lv1-03', null, 'correct')
    ];
    const s14 = D.summarize(D.dayGroups(atts, '2026-11-14')), s15 = D.summarize(D.dayGroups(atts, '2026-11-15'));
    const st = { imports: [{ from: Date.parse('2026-11-10T00:00:00Z'), to: Date.parse('2026-11-16T03:00:00Z') }] };
    return { s14, s15, undated: D.undated(atts), key: D.dayKey(Date.parse('2026-11-14T15:00:00Z')),
      cov12: D.coverage(st, '2026-11-12').kind, cov16: D.coverage(st, '2026-11-16').kind, cov09: D.coverage(st, '2026-11-09').kind };
  });
  ok('午前0時（日本時間）をまたいだ回答は別の日', logic.s14.problems === 1 && logic.s14.recovered === 0 && logic.s15.problems === 2, JSON.stringify([logic.s14, logic.s15]));
  ok('同じ日に同じ問題を複数回：1問・誤答も1問', logic.s15.wrong === 1 && logic.s15.recovered === 1, JSON.stringify(logic.s15));
  ok('日時がない古い記録はどの日にも入れない', logic.undated === 1 && logic.key === '2026-11-15');
  ok('受領状況：期間内 full（0問と確認できる）・当日途中 partial・期間外 none', logic.cov12 === 'full' && logic.cov16 === 'partial' && logic.cov09 === 'none');

  ok('ページのエラーなし', errs.length === 0, errs.join(' / '));
  await browser.close();
  const fail = results.filter((x) => !x).length;
  console.log(fail ? fail + ' FAILED' : 'ALL PASS (' + results.length + ')');
  process.exit(fail ? 1 : 0);
})();
