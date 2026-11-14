/*
 * 短文読解（当日・定着・まとめ復習・今日のおすすめ）と日付別の学習記録の動作確認（Chromium・ヘッドレス、iPad の画面幅）。
 *   node tests/reading.check.cjs
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
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE); await page.waitForSelector('.topbar');

  /* ---------- 0. 問題バンクの点検 ---------- */
  const bank = await page.evaluate(() => {
    const B = EA.banks['infinitive-reading'], qs = B.questions, sk = EA.banks.infinitive.skills.map((s) => s.id);
    const per = {}; sk.forEach((s) => { per[s] = {}; qs.filter((q) => q.skill === s && q.readingUse !== 'summary').forEach((q) => { per[s][q.readingUse] = (per[s][q.readingUse] || 0) + 1; }); });
    const passages = {}; qs.filter((q) => q.passage).forEach((q) => { (passages[q.passage] = passages[q.passage] || []).push(q.skill); });
    return {
      n: qs.length, oneAnswer: qs.every((q) => q.choices.filter((c) => c.id === q.answer).length === 1 && q.choices.length === 3),
      wrongHaveWhy: qs.every((q) => q.choices.filter((c) => c.id !== q.answer).every((c) => c.feedback)),
      gloss: qs.every((q) => q.gloss && q.gloss.length), per,
      passOk: Object.values(passages).every((s) => s.length === 2 && s[0] !== s[1]), nPass: Object.keys(passages).length,
      uniqueText: new Set(qs.filter((q) => !q.passage).map((q) => q.sentence)).size === qs.filter((q) => !q.passage).length
    };
  });
  ok('読解バンク：全問 3択・正解1つ・誤答に理由・語注あり', bank.oneAnswer && bank.wrongHaveWhy && bank.gloss, bank.n + '問');
  ok('読解バンク：各項目に当日1・確認4・基本語2', Object.values(bank.per).every((p) => p.sameDay === 1 && p.check === 4 && p.basic === 2), JSON.stringify(bank.per));
  ok('まとめ復習：英文' + bank.nPass + '本、各2問・別々の項目', bank.passOk && bank.uniqueText);

  /* ---------- 1. 当日の短文：Lv1 で文法問題のあとに出る ---------- */
  const items = await page.evaluate(() => EA.planner.buildDiagnosticSession(EA.banks.infinitive, Date.now()).items.map((x) => x.attemptType + ':' + x.questionId));
  ok('Lv1：各項目の文法問題（2問）のあとに当日の短文1問', items.length === 12 && items[2] === 'reading:rd-n-sd' && items[5] === 'reading:rd-a-sd' && items[11] === 'reading:rd-i-sd', items.join(' '));

  // UI：1問目 誤答 → 解き直しで正解、2問目 正解 → 当日の短文を誤答 → 単語の意味を見て答え直し（正解）
  const cur = () => page.evaluate(() => { const s = EA.app.getState().activeSession; const it = s.items[s.index]; const q = EA.daily.findQ(it.questionId);
    return { id: q.id, answer: q.answer, ids: q.choices.map((c) => c.id), at: it.attemptType }; });
  const answer = async (right) => { const q = await cur(); await page.click(`[data-act="choose"][data-choice="${right ? q.answer : q.ids.find((x) => x !== q.answer)}"]`); await page.click('#submit-btn'); await page.waitForTimeout(250); return q; };
  const next = async () => { await page.click('[data-act="next"]'); await page.waitForTimeout(250); };
  await page.click('[data-act="task-diagnostic"]'); await page.waitForTimeout(250);
  const q1 = await answer(false); await next(); await answer(true); await next();
  await answer(true); await next();
  const rq = await answer(false);
  ok('当日の短文が文法問題のあとに出た', rq.id === 'rd-n-sd');
  const hold = await page.textContent('#main');
  ok('短文の1回目の誤答：正答を見せずに「単語の意味を見て、もう一度答える」', hold.includes('単語の意味を見て、もう一度答える') && !hold.includes('✓ 正解') && !(await page.$('.explain-block')));
  await page.screenshot({ path: path.join(OUT, 'reading-hold.png'), fullPage: true });
  await page.click('[data-act="reading-reread"]'); await page.waitForTimeout(250);
  ok('答え直しでは単語の意味（語注）を表示', !!(await page.$('.gloss')) && (await cur()).at === 'reread');
  await answer(true);
  ok('答え直しの正解は「ヒントあり」', (await page.textContent('#main')).includes('ヒントあり'));
  await page.screenshot({ path: path.join(OUT, 'reading-reread.png'), fullPage: true });
  const st1 = await page.evaluate(() => EA.app.getState().reading.skills['inf-noun']);
  ok('当日・答え直しの正解では定着回数が進まない（0/2）', st1.count === 0 && st1.phase === 'pre', JSON.stringify({ c: st1.count, due: st1.dueDay }));
  await page.click('[data-act="save-home"]'); await page.waitForTimeout(250);

  /* ---------- 2. 日付 → 単元 → 間違えた問題（最初の誤答を見返せる） ---------- */
  await page.click('[data-go="history"]'); await page.waitForTimeout(200);
  const rows = await page.$$eval('.day-row', (e) => e.map((x) => x.textContent.replace(/\s+/g, '')));
  ok('日付一覧：直近7日は全部表示・学習なしの日は「学習なし」', rows.length === 7 && rows.slice(1).every((r) => r.includes('学習なし')) && rows[0].includes('（今日）'), rows[0]);
  await page.click('[data-act="day-open"] >> nth=0'); await page.waitForTimeout(150);
  const unitRow = (await page.textContent('.day-unit')).replace(/\s+/g, '');
  ok('「単元を見る」：単元ごとの問題数・誤答数（既存の集計と同じ数え方）', unitRow.includes('不定詞（基本）') && unitRow.includes('問題3') && unitRow.includes('誤答2'), unitRow);
  await page.click('.day-unit'); await page.waitForTimeout(150);
  const wl = await page.$$eval('.wrong-item', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ')));
  const want = await page.evaluate((id) => EA.findQuestion(EA.banks.infinitive, id), q1.id);
  const firstWrong = await page.evaluate((id) => EA.app.getState().attempts.find((a) => a.questionId === id).responseText, q1.id);
  ok('解き直しで正解した問題も、最初の誤答・正解を見返せる', wl.length === 2 && wl[0].includes('解き直しで正解') && wl[0].includes(firstWrong) && wl[0].includes('She hopes to study abroad.'), wl[0].slice(0, 160));
  ok('短文の誤答も表示（問題文に英文と設問）', wl[1].includes('Mai decided') && wl[1].includes('マイが決めたこと') && wl[1].includes('単語の意味を見て正解'));
  await page.screenshot({ path: path.join(OUT, 'reading-day-unit.png'), fullPage: true });

  /* ---------- 3. 定着の判定（回答の反映ルール） ---------- */
  const logic = await page.evaluate(() => {
    const D = EA.daily, R = EA.reading, today = D.dayKey(Date.now());
    const at = (off) => D.keyStart(D.shiftKey(today, off)) + 12 * 3600e3;
    const st = EA.storage.defaultState('normal');
    st.units.infinitive = { diagnosticDoneAt: at(0) };
    const q = EA.daily.findQ('rd-n-c1');
    const run = (off, purpose, correct, extra) => {
      const a = Object.assign({ questionId: q.id, answeredAt: at(off), result: correct ? 'correct' : 'incorrect', hintUsed: false }, extra || {});
      return R.apply(st, a, q, { readingPurpose: purpose, attemptType: (extra && extra.reread) ? 'reread' : 'reading' });
    };
    const out = [];
    run(0, 'sameDay', true); out.push(st.reading.skills['inf-noun'].count);           // 学習日の正解 → 0
    run(2, 'check', true, { hintUsed: true }); out.push(st.reading.skills['inf-noun'].count); // 語注を見て正解 → 0
    run(3, 'check', true); out.push(st.reading.skills['inf-noun'].count);             // 後日の自力正解 → 1
    run(3, 'check', true); out.push(st.reading.skills['inf-noun'].count);             // 同じ日の2回目 → 1
    const before = st.reading.skills['inf-noun'].dueDay;
    run(6, 'check', false); const r = st.reading.skills['inf-noun']; out.push(r.count, r.dueDay === D.shiftKey(today, 7), before);
    run(7, 'check', true, { reread: true, hintUsed: true }); out.push(r.count);       // 答え直し → 1 のまま
    run(8, 'check', true); out.push(r.count, r.phase);                                // 別の日の自力正解 → 2 → 定着
    return out;
  });
  ok('学習日・ヒントあり・同日2回目・答え直しの正解は数えない（0,0,1,1）', logic[0] === 0 && logic[1] === 0 && logic[2] === 1 && logic[3] === 1, logic.join(','));
  ok('1/2 のあとに誤答しても 1/2 を保持し、次の確認を翌日に早める', logic[4] === 1 && logic[5] === true);
  ok('異なる2つの復習日で初見・ヒントなしの正解 → 定着', logic[8] === 2 && logic[9] === "settled");

  /* ---------- 4. まとめ復習：片方だけ誤答 → その項目だけ単独の再確認 ---------- */
  const sum = await page.evaluate(() => {
    const D = EA.daily, R = EA.reading, today = D.dayKey(Date.now());
    const st = EA.storage.defaultState('normal');
    st.units.infinitive = { diagnosticDoneAt: Date.now() - 30 * 864e5 };
    ['inf-noun', 'inf-adv'].forEach((sk) => { const r = R.ensure(st, sk, today); Object.assign(r, { phase: 'settled', count: 2, step: 2, dueDay: D.shiftKey(today, -1), learnedDay: D.shiftKey(today, -30), settledHistory: [{ day: D.shiftKey(today, -10) }] }); });
    const rec = R.recommend(st, Date.now());
    const qs = rec.items.map((x) => D.findQ(x.questionId));
    qs.forEach((q) => { const a = { questionId: q.id, answeredAt: Date.now(), result: q.skill === 'inf-adv' ? 'incorrect' : 'correct', hintUsed: false };
      st.attempts.push(a); R.apply(st, a, q, { readingPurpose: 'summary', attemptType: 'reading' }); });
    const n = st.reading.skills['inf-noun'], v = st.reading.skills['inf-adv'];
    const tomorrow = Date.now() + 864e5;
    const rec2 = R.recommend(st, tomorrow);
    return { kind: rec.kind, skills: rec.skills, nq: rec.items.length, hideTerm: qs.every((q) => !/名詞的|副詞的|用法/.test(q.question)),
      n: [n.phase, n.dueDay > today], v: [v.phase, v.dueDay === D.shiftKey(today, 1), v.settledHistory.length, R.status(st, 'inf-adv').label],
      rec2: [rec2 && rec2.kind, rec2 && rec2.skills.join()] };
  });
  ok('まとめ復習：定着済み2項目を英文1本・2問で確認（単元名は伏せる）', sum.kind === 'summary' && sum.nq === 2 && sum.skills.includes('inf-noun') && sum.skills.includes('inf-adv') && sum.hideTerm);
  ok('片方の設問だけ誤答 → その項目だけ「短文で再確認」（翌日）、もう片方は間隔をのばす', sum.n[0] === 'settled' && sum.n[1] && sum.v[0] === 'recheck' && sum.v[1], JSON.stringify(sum));
  ok('過去の定着は履歴に残し、現在の状態は「短文で再確認」', sum.v[2] === 1 && sum.v[3].startsWith('短文で再確認') && sum.v[3].includes('定着'));
  ok('翌日のおすすめは、その項目の単独の短文', sum.rec2[0] === 'single' && sum.rec2[1] === 'inf-adv');

  /* ---------- 5. 優先順位：まとめ復習の遅れ6日と7日 ---------- */
  const pri = await page.evaluate(() => {
    const D = EA.daily, R = EA.reading, today = D.dayKey(Date.now());
    function mk(delay) {
      const st = EA.storage.defaultState('normal');
      st.units.infinitive = { diagnosticDoneAt: Date.now() - 40 * 864e5 };
      Object.assign(R.ensure(st, 'inf-adj', today), { phase: 'settled', count: 2, step: 2, dueDay: D.shiftKey(today, -delay) });
      Object.assign(R.ensure(st, 'inf-it', today), { phase: 'pre', count: 1, step: 1, dueDay: D.shiftKey(today, -1) });
      const r = R.recommend(st, Date.now()); return r.kind + ':' + r.skills.join('+');
    }
    return [mk(6), mk(7)];
  });
  ok('まとめ復習の遅れ6日の日は単独確認が先、7日の日はまとめ復習が先', pri[0] === 'single:inf-it' && pri[1].startsWith('summary:inf-adj'), pri.join(' / '));

  /* ---------- 6. 今日のおすすめは英文1本／もう1本／解かなかった項目は元の予定日のまま ---------- */
  await page.evaluate(() => {
    const D = EA.daily, R = EA.reading, today = D.dayKey(Date.now()), st = EA.storage.defaultState('normal');
    st.units.infinitive = { diagnosticDoneAt: Date.now() - 20 * 864e5, diagnosticSessionId: 'x' };
    EA.banks.infinitive.skills.forEach((s) => { st.schedule[s.id] = { skillId: s.id, step: 2, intervalDays: 7, dueAt: Date.now() + 5 * 864e5, history: [] }; });
    Object.assign(R.ensure(st, 'inf-adj', today), { learnedDay: D.shiftKey(today, -20), dueDay: D.shiftKey(today, -3) });
    Object.assign(R.ensure(st, 'inf-adv', today), { learnedDay: D.shiftKey(today, -20), dueDay: D.shiftKey(today, -2) });
    EA.app.getState().activeSession = null; // 再読み込み時に、開いている学習回で上書き保存されないように
    localStorage.setItem('ea-study-v1', JSON.stringify(st));
  });
  await page.reload(); await page.waitForSelector('.topbar');
  ok('ホーム：今日のおすすめは短文読解（英文1本）', (await page.textContent('.hero')).includes('英文1本'));
  await page.click('[data-act="task-reading"]'); await page.waitForTimeout(200);
  let s1 = await cur();
  ok('予定日が古い項目（形容詞的用法・3日遅れ）から', (await page.evaluate(() => EA.app.getState().activeSession.items.length)) === 1 && s1.id.startsWith('rd-a-c'), s1.id);
  // 解かずに保存してホームへ → 予定日はそのまま
  await page.click('[data-act="save-home"]'); await page.waitForTimeout(200);
  let due = await page.evaluate(() => { const r = EA.app.getState().reading.skills; return [r['inf-adj'].dueDay, r['inf-adv'].dueDay]; });
  const expect = await page.evaluate(() => [EA.daily.shiftKey(EA.daily.dayKey(Date.now()), -3), EA.daily.shiftKey(EA.daily.dayKey(Date.now()), -2)]);
  ok('解かなかった項目は元の予定日を保持', due.join() === expect.join(), due.join());
  await page.click('[data-act="task-resume"]'); await page.waitForTimeout(200);
  await answer(true); await next(); await page.waitForTimeout(200);
  await page.click('[data-go="home"]'); await page.waitForTimeout(200);
  const hero = (await page.textContent('.hero')).replace(/\s+/g, '');
  ok('1本終えたら区切れる（今日の課題は完了・「もう１本」を表示）', hero.includes('今日の課題は完了') && hero.includes('もう１本'), hero.slice(0, 60));
  due = await page.evaluate(() => { const r = EA.app.getState().reading.skills; return [r['inf-adj'].count, r['inf-adv'].dueDay]; });
  ok('「もう１本」を押さなくても、残りの対象（副詞的用法）の元の予定日を保持', due[0] === 1 && due[1] === expect[1], due.join());
  await page.screenshot({ path: path.join(OUT, 'reading-home-more.png') });
  await page.click('[data-act="reading-more"]'); await page.waitForTimeout(200);
  s1 = await cur();
  ok('「もう１本」で残りの対象から次の英文へ', s1.id.startsWith('rd-v-c'), s1.id);
  await page.click('[data-act="save-home"]'); await page.waitForTimeout(200);

  /* ---------- 7. 古い記録の読み込みと、8日目より前の日付 ---------- */
  const old = await page.evaluate(() => {
    const D = EA.daily, today = D.dayKey(Date.now()), at = (off, h) => D.keyStart(D.shiftKey(today, off)) + h * 3600e3;
    // 以前の形式：profile・reading・snapshot なし、questionVersion が古い・問題が削除済みの回答を含む
    const st = { schemaVersion: 3, mode: 'normal', createdAt: at(-30, 9), settings: { dailyGoalMinutes: 10 }, schedule: {}, sessions: [], migrations: [], activeSession: null,
      units: { infinitive: { diagnosticDoneAt: at(-12, 10), diagnosticSessionId: 's-old' } },
      attempts: [
        { id: 'o1', questionId: 'inf-lv1-01', questionVersion: 0, skillId: 'inf-noun', format: 'meaning', attemptType: 'diagnostic', sessionId: 's-old', sessionType: 'diagnostic', response: 'a', responseText: 'She saved money to study abroad.', result: 'incorrect', answeredAt: at(-12, 10), activeMs: 20000 },
        { id: 'o2', questionId: 'inf-d1', questionVersion: 1, skillId: 'inf-noun', format: 'fill', attemptType: 'diagnostic', sessionId: 's-old', sessionType: 'diagnostic', response: 'a', responseText: 'play', result: 'incorrect', answeredAt: at(-12, 11), activeMs: 20000 },
        { id: 'o3', questionId: 'inf-lv1-03', questionVersion: 1, skillId: 'inf-adj', format: 'meaning', attemptType: 'diagnostic', sessionId: 's-old', sessionType: 'diagnostic', response: 'c', responseText: 'x', result: 'correct', answeredAt: at(-9, 10), activeMs: 20000 },
        { id: 'o4', questionId: 'inf-lv1-05', questionVersion: 1, skillId: 'inf-adv', format: 'meaning', attemptType: 'diagnostic', sessionId: 's-old', sessionType: 'diagnostic', response: 'b', responseText: 'y', result: 'correct', answeredAt: at(-2, 23.99), activeMs: 20000 }
      ] };
    EA.app.getState().activeSession = null; // 再読み込み時に、開いている学習回で上書き保存されないように
    localStorage.setItem('ea-study-v1', JSON.stringify(st));
    return [D.shiftKey(today, -12), D.shiftKey(today, -9)];
  });
  await page.reload(); await page.waitForSelector('.topbar');
  const init = await page.evaluate(() => { const s = EA.app.getState(); return { n: s.attempts.length, profile: !!s.profile.studentId, rd: Object.values(s.reading.skills).map((r) => r.phase + r.count).join() }; });
  ok('古い記録を読み込める（回答4件・短文読解は定着前0/2から）', init.n === 4 && init.profile && init.rd === 'pre0,pre0,pre0,pre0', JSON.stringify(init));
  await page.click('[data-go="history"]'); await page.waitForTimeout(200);
  const rows2 = await page.$$eval('.day-row', (e) => e.map((x) => x.textContent.replace(/\s+/g, '')));
  ok('8日目より前は回答した日だけ（12日前・9日前）・直近7日は全部', rows2.length === 9 && rows2[7].startsWith(await page.evaluate((k) => EA.daily.labelOfKey(k), old[1])) && rows2[8].startsWith(await page.evaluate((k) => EA.daily.labelOfKey(k), old[0])), rows2.slice(5).join(' | '));
  ok('日本時間の日付で数える（2日前の23時台の回答は2日前の行）', rows2[2].includes('1問'), rows2[2]);
  await page.screenshot({ path: path.join(OUT, 'reading-days.png'), fullPage: true });
  await page.click('[data-act="day-open"] >> nth=-1'); await page.click('.day-unit'); await page.waitForTimeout(150);
  const oldTxt = await page.textContent('#main');
  ok('旧データ：版が違う回答はその旨を表示・削除済みの問題は「確認できません」', oldTxt.includes('旧データのため当時の問題文・正解は保存されていません') && oldTxt.includes('旧データのため、当時の問題文と正解を確認できません'));

  ok('ページのエラーなし', errs.length === 0, errs.join(' / '));
  await browser.close();
  const fail = results.filter((x) => !x).length;
  console.log(fail ? fail + ' FAILED' : 'ALL PASS (' + results.length + ')');
  process.exit(fail ? 1 : 0);
})();
