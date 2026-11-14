/*
 * 不定詞 Lv3 の動作確認（Chromium・ヘッドレス）。 node tests/lv3.check.cjs
 * iPad の Safari 実機での確認ではありません（画面幅を iPad に合わせた Chromium での確認です）。
 */
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'eibunpo-drill.html');
const ITEM_LABELS = ['be made to do', 'too ～ to do', 'forget to do と forget doing', '原形不定詞'];
const results = [];
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
const W = (page, ms) => page.waitForTimeout(ms);

function splitAnswer(q, tokens) {
  const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[’]/g, "'").replace(/[,.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  let core = norm(q.answers[0]);
  if (q.fixedStart) core = core.slice(norm(q.fixedStart).length).trim();
  if (q.fixedEnd) core = core.slice(0, core.length - norm(q.fixedEnd).length).trim();
  const out = [], used = tokens.map(() => false);
  (function rec(rest) {
    if (!rest) return true;
    for (let i = 0; i < tokens.length; i++) {
      if (used[i]) continue;
      const t = norm(tokens[i]);
      if (rest === t || rest.startsWith(t + ' ')) {
        used[i] = true; out.push(tokens[i]);
        if (rec(rest.slice(t.length).trim())) return true;
        used[i] = false; out.pop();
      }
    }
    return false;
  })(core);
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE); await page.waitForSelector('.topbar');

  // 1. 取り込み
  const info = await page.evaluate(() => {
    const B = EA.banks['infinitive-lv3'], c = EA.lv3.check(), c2 = EA.lv2.check();
    const qs = B.questions;
    return {
      check: c, lv2: { ok: c2.ok, total: c2.total }, n: qs.length, skills: B.skills.map((s) => s.label), parent: B.unit.parent,
      idsOk: qs.every((q) => /^inf-lv3-[1-4]-[abc]0[1-8]$/.test(q.id)),
      groupsOk: qs.every((q) => q.sourceGroup === q.id.replace(/^inf-(lv3-\d)-[abc](\d\d)$/, '$1-$2')),
      formats: qs.reduce((a, q) => { a[q.formatGroup] = (a[q.formatGroup] || 0) + 1; return a; }, {}),
      extra7: qs.filter((q) => q.orderKind === 'extra').map((q) => q.no), missing8: qs.filter((q) => q.orderKind === 'missing').map((q) => q.no),
      ex: {
        tr: qs.filter((q) => q.explanation.translation).length, ch: qs.filter((q) => (q.explanation.chunks || []).some((x) => x.mark)).length,
        term: qs.filter((q) => q.explanation.term && q.explanation.term !== EA.findSkill(B, q.skill).term).length, also: qs.filter((q) => q.explanation.also).length,
        others: qs.filter((q) => q.choices && q.choices.filter((c) => c.id !== q.answer).every((c) => c.feedback)).length,
        aPoint: qs.filter((q) => q.formatGroup === 'ord').every((q) => /^語順は「.+」です。/.test(q.explanation.point)),
        chunkErr: (EA.lv2ExplainErrors || []).filter((id) => /lv3/.test(id))
      },
      inBase: EA.banks.infinitive.questions.filter((q) => /lv3/.test(q.id)).length + EA.banks['infinitive-lv2'].questions.filter((q) => /lv3/.test(q.id)).length
    };
  });
  ok('Lv3 の検査で問題なし（96問）', info.check.ok && info.n === 96, info.check.errors.join('、'));
  ok('Lv2 は今までどおり（128問・検査で問題なし）', info.lv2.ok && info.lv2.total === 128);
  ok('学習項目は4つ', JSON.stringify(info.skills) === JSON.stringify(ITEM_LABELS), info.skills.join(' / '));
  ok('形式は並べ替え・英文から分かること・語順 各32問', info.formats.ord === 32 && info.formats.fact === 32 && info.formats.wo === 32, JSON.stringify(info.formats));
  ok('問題IDは原本の番号（inf-lv3-1-a01 など）、組は lv3-<項目>-<番号>', info.idsOk && info.groupsOk);
  ok('余分な語は第7問、不足語は第8問（各項目）', info.extra7.length === 4 && info.extra7.every((n) => n === 7) && info.missing8.length === 4 && info.missing8.every((n) => n === 8));
  ok('親の単元は不定詞、ほかの問題集に Lv3 は混ざらない', info.parent === 'infinitive' && info.inBase === 0);
  ok('解説：96問すべてに和訳・強調つきの語句の表・具体的な文法の名前', info.ex.tr === 96 && info.ex.ch === 96 && info.ex.term === 96 && !info.ex.chunkErr.length, JSON.stringify(info.ex));
  ok('解説：選択問題64問すべてに、ほかの選択肢がちがう理由', info.ex.others === 64);
  ok('解説：並べ替えは「語順は「…」です。」から始まる（原本どおり）', info.ex.aPoint);

  // 2. 採点
  const all = await page.evaluate(() => JSON.parse(JSON.stringify(EA.banks['infinitive-lv3'].questions)));
  const wrong = [];
  for (const q of all) {
    let good, bad;
    if (q.format === 'order') {
      const pieces = q.tokens.filter((t) => !(q.orderKind === 'extra' && t === q.extraToken)).concat(q.orderKind === 'missing' ? [q.missingWord] : []);
      good = splitAnswer(q, pieces);
      if (good.length !== pieces.length) wrong.push(q.id + '（語句から正答を作れない）');
      bad = q.orderKind === 'extra' ? q.tokens.slice() : q.orderKind === 'missing' ? good.filter((t) => t !== q.missingWord) : good.slice().reverse();
    } else { good = q.answer; bad = q.choices.find((c) => c.id !== q.answer).id; }
    const r = await page.evaluate(([id, g, b]) => { const Q = EA.findQuestion(EA.banks['infinitive-lv3'], id); return [EA.grading.grade(Q, g).result, EA.grading.grade(Q, b).result]; }, [q.id, good, bad]);
    if (r[0] !== 'correct' || r[1] !== 'incorrect') wrong.push(q.id + ' ' + r.join('/'));
  }
  ok('全96問：正答を正解、誤答を不正解と採点', !wrong.length, wrong.join('、'));

  // 3. 出題：同じ組を同じ回に出さない・問題数
  const picks = await page.evaluate(() => {
    const st = EA.app.getState(), B = EA.banks['infinitive-lv3'], out = { dup: 0, counts: {}, skillsAll: 0, mixed: 0 };
    ['all'].concat(B.skills.map((s) => s.id)).forEach((r) => {
      for (let i = 0; i < 300; i++) {
        const qs = EA.planner.practiceSetQuestions(st, B, r);
        const g = qs.map((q) => q.sourceGroup);
        if (new Set(g).size !== g.length) out.dup++;
        out.counts[r] = qs.length;
        if (r === 'all' && new Set(qs.map((q) => q.skill)).size === 4) out.skillsAll++;
        if (r !== 'all' && new Set(qs.map((q) => q.formatGroup)).size === 3) out.mixed++;
      }
    });
    return out;
  });
  ok('同じ英文の組（A・B・C）は同じ回に出ない（1500回の抽出）', picks.dup === 0, 'dup=' + picks.dup);
  ok('問題数は既存の自主練習と同じ6問', Object.values(picks.counts).every((n) => n === 6), JSON.stringify(picks.counts));
  ok('全範囲は4項目すべてから出す・項目別は3形式を混ぜる', picks.skillsAll === 300 && picks.mixed === 1200, picks.skillsAll + ' / ' + picks.mixed);

  // 4. 画面：単元タブ → Lv3 → 解答 → 結果
  const before = await page.evaluate(() => { const s = EA.app.getState(); return JSON.stringify({ sch: s.schedule, u: s.units }); });
  await page.click('[data-go="units"]'); await W(page, 350);
  ok('単元タブに「Lv2を練習する」「Lv3を練習する」がある（初回の前でも開ける）', await page.locator('[data-act="lv2-open"]').isEnabled() && await page.locator('[data-act="lv3-open"]').isEnabled());
  await page.click('[data-act="lv3-open"]'); await W(page, 350);
  const labels = await page.locator('[data-act="lv3-range"]').allInnerTexts();
  ok('Lv3の範囲：全範囲＋4項目', JSON.stringify(labels) === JSON.stringify(['全範囲'].concat(ITEM_LABELS)), labels.join(' / '));
  ok('Lv3の開始ボタンに問題数', /Lv3の練習をはじめる（6問）/.test(await page.locator('[data-act="lv3-start"]').innerText()));
  await page.click('[data-act="lv3-range"][data-range="lv3-forget"]'); await W(page, 350);
  await page.click('[data-act="lv3-start"]'); await W(page, 400);
  const head = await page.evaluate(() => document.querySelector('.sheet').innerText);
  ok('問題画面：Lv3練習と表示し、項目名は出さない', /Lv3練習/.test(head) && !/forget to do と forget doing/.test(head));
  let shots = 0;
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => { const s = EA.app.getState().activeSession; return s && s.current && s.current.phase; });
    if (!st) break;
    if (st === 'feedback') {
      if (shots < 1 && process.env.SHOT_DIR) { await page.screenshot({ path: process.env.SHOT_DIR + '/lv3-ex.png', fullPage: true }); shots++; }
      await page.click('[data-act="next"]'); await W(page, 380);
    } else { await page.click('[data-act="giveup"]'); await W(page, 120); if (await page.locator('[data-cx="open"]').count()) await page.click('[data-cx="open"]'); await W(page, 380); }
  }
  const res = await page.evaluate(() => document.querySelector('#app').innerText);
  ok('結果：学習項目ごとの結果に Lv3 の項目名', /学習項目ごとの結果/.test(res) && /forget to do と forget doing：6問中/.test(res));
  const rec = await page.evaluate(() => { const s = EA.app.getState(); return { a: s.attempts.filter((a) => a.practiceSet === 'lv3').map((a) => [a.attemptType, a.questionId.slice(0, 9)]), sch: s.schedule, u: s.units, home: EA.planner.homeTask(s, EA.banks.infinitive, Date.now()).kind }; });
  ok('回答は自分で始めた練習（lv3）として6件記録', rec.a.length === 6 && rec.a.every((x) => x[0] === 'self' && x[1] === 'inf-lv3-3'));
  ok('確認状況・復習予定は変わらない', JSON.stringify({ sch: rec.sch, u: rec.u }) === before);
  await page.click('[data-go="history"]'); await W(page, 350);
  await page.click('[data-act="history-unit"][data-unit="infinitive"]'); await W(page, 350);
  ok('履歴・復習（不定詞）に Lv3練習の回答が並ぶ', (await page.locator('.history-log').innerText()).includes('Lv3練習'));
  ok('ページでエラーが出ない', !errs.length, errs.join(' / '));

  await browser.close();
  const pass = results.filter((r) => r.pass).length;
  console.log('\n' + pass + ' / ' + results.length + ' 件 合格');
  process.exit(pass === results.length ? 0 : 1);
})();
