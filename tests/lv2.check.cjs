/*
 * 不定詞 Lv2 の動作確認（Chromium・ヘッドレス）。
 *   node tests/lv2.check.cjs            … アプリに収録した原本のデータで確認
 *   LV2_FIXTURE=1 node tests/lv2.check.cjs … 確認用の仮データ（tests/fixtures/lv2-fixture.js）で確認
 * iPad の Safari 実機での確認ではありません（画面幅を iPad に合わせた Chromium での確認です）。
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const FILE = 'file://' + path.resolve(__dirname, '..', 'eibunpo-drill.html');
const FIXTURE = process.env.LV2_FIXTURE === '1' ? fs.readFileSync(path.join(__dirname, 'fixtures', 'lv2-fixture.js'), 'utf8') : null;
const ITEM_LABELS = ['動名詞 or 不定詞', 'not to do', 'enough to do', 'in order to do', '疑問詞＋不定詞'];

const results = [];
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  if (FIXTURE) await ctx.addInitScript(FIXTURE);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => ok('ページでエラーが出ない', false, e.message));
  await page.goto(FILE);
  await page.waitForSelector('.topbar');
  return { ctx, page };
}

/** いまの学習回の問題を、指定の問題IDだけの Lv2 練習に差し替えて開く（採点の確認用） */
async function openSessionWith(page, ids) {
  await page.evaluate((ids) => {
    const st = EA.app.getState();
    const bank = EA.banks['infinitive-lv2'];
    const s = EA.planner.buildPracticeSetSession(st, bank, 'all', Date.now());
    s.items = ids.map((id) => ({ kind: 'question', questionId: id, attemptType: 'self' }));
    st.activeSession = null;
    EA.session.start(st, bank, s, { app: Date.now(), real: Date.now() });
    EA.app.go('session');
  }, ids);
  await page.waitForSelector('.sheet');
}

async function curQ(page) {
  return page.evaluate(() => {
    const s = EA.app.getState().activeSession;
    return JSON.parse(JSON.stringify(EA.findQuestion(EA.banks['infinitive-lv2'], s.items[s.index].questionId)));
  });
}

async function tapChip(page, text, zone) {
  const chips = page.locator(`[data-zone="${zone || 'pool'}"] [data-tok]`);
  const n = await chips.count();
  for (let i = 0; i < n; i++) {
    if ((await chips.nth(i).innerText()).trim() === text) { await chips.nth(i).click(); return true; }
  }
  throw new Error('語句が見つかりません：' + text);
}

/** 正答の英文（固定部分を除く）を、語句の並びに分ける */
function splitAnswer(q, tokens) {
  const norm = (s) => s.normalize('NFKC').toLowerCase().replace(/[’]/g, "'").replace(/[,.!?]/g, ' ').replace(/\s+/g, ' ').trim();
  let core = norm(q.answers[0]);
  if (q.fixedStart) core = core.slice(norm(q.fixedStart).length).trim();
  if (q.fixedEnd) core = core.slice(0, core.length - norm(q.fixedEnd).length).trim();
  const out = [];
  const used = tokens.map(() => false);
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

async function verdict(page) {
  await page.waitForSelector('.verdict');
  return (await page.locator('.verdict .badge').innerText()).trim();
}
async function submit(page) {
  await page.waitForTimeout(300); // 画面切り替え直後の連続タップ防止（250ms）を待つ
  await page.click('#submit-btn');
}
async function next(page) { await page.waitForTimeout(300); await page.click('[data-act="next"]'); }

/** 並べ替えに答える（correct=false なら最初の2語句を入れ替える） */
async function answerOrder(page, q, correct, addedRaw) {
  if (q.orderKind === 'missing') {
    await page.fill('#add-word-input', addedRaw != null ? addedRaw : q.missingWord);
    await page.click('[data-act="add-word-set"]');
    await page.waitForSelector('.chip-added');
  }
  const pieces = q.tokens.filter((t) => !(q.orderKind === 'extra' && t === q.extraToken));
  if (q.orderKind === 'missing') pieces.push(q.missingWord);
  let seq = splitAnswer(q, pieces);
  if (!correct) seq = [seq[1], seq[0]].concat(seq.slice(2));
  for (const t of seq) {
    const shown = q.orderKind === 'missing' && t === q.missingWord ? await page.locator('.order-pool .chip-added').innerText() : t;
    await tapChip(page, shown.trim());
  }
}

async function answerChoice(page, q, correct) {
  const id = correct ? q.answer : q.choices.find((c) => c.id !== q.answer).id;
  await page.click(`[data-act="choose"][data-choice="${id}"]`);
}

(async () => {
  const browser = await chromium.launch();
  let { ctx, page } = await newPage(browser);

  /* 1. 収録数・ID・正答の参照先 */
  const chk = await page.evaluate(() => {
    const c = EA.lv2.check();
    const ids = EA.banks['infinitive-lv2'].questions.map((q) => q.id);
    const inBase = EA.banks.infinitive.questions.filter((q) => q.set === 'lv2' || /^inf-lv2-/.test(q.id)).length;
    return { c, unique: new Set(ids).size, n: ids.length, inBase };
  });
  ok('項目×形式ごとの収録数と合計128問', chk.c.total === 128 && chk.c.ok, '合計 ' + chk.c.total + '問' + (chk.c.errors.length ? '／' + chk.c.errors.join('／') : ''));
  ok('問題IDの重複なし', chk.unique === chk.n, chk.unique + ' / ' + chk.n);
  ok('Lv2の問題は不定詞（基本）の問題集に入っていない', chk.inBase === 0);

  /* 2. 既存の出題（初回診断・類題・確認問題・復習・もう一度練習・Lv1）に Lv2 が入らない */
  const leak = await page.evaluate(() => {
    const B = EA.banks.infinitive, P = EA.planner, st = JSON.parse(JSON.stringify(EA.app.getState()));
    const ids = [];
    const now = Date.now();
    ids.push(...P.buildDiagnosticSession(B, now).items.map((x) => x.questionId));
    ids.push(...P.buildFixedSetSession(B, 'lv1', 'Lv1', now).items.map((x) => x.questionId));
    for (let i = 0; i < 30; i++) P.selfPracticeRanges(B).forEach((r) => ids.push(...P.buildSelfPracticeSession(st, B, r.id, now).items.map((x) => x.questionId)));
    st.units = { infinitive: { diagnosticDoneAt: now - 864e5 * 10, diagnosticSessionId: 'x' } };
    B.skills.forEach((sk) => { st.schedule[sk.id] = { dueAt: now - 864e5, step: 0, intervalDays: 1 }; });
    for (let i = 0; i < 10; i++) ids.push(...P.buildReviewSession(st, B, now).items.map((x) => x.questionId));
    ids.push(...P.buildPracticeSession(st, B, now).items.map((x) => x.questionId));
    const fake = P.buildReviewSession(st, B, now);
    B.skills.forEach((sk) => { const f = P.pickFollowUp(st, B, fake, { skillId: sk.id, questionId: 'none' }, 'error'); if (f) ids.push(f.id); });
    return { n: ids.length, lv2: ids.filter((id) => /^inf-lv2-/.test(id)) };
  });
  ok('初回診断・Lv1・もう一度練習・類題・復習・確認問題に Lv2 が出ない', leak.lv2.length === 0, '確認した出題 ' + leak.n + '件');

  /* 3. 単元タブ（初回診断の前）から Lv2 を開く：全範囲 */
  await page.click('[data-go="units"]');
  const diagBefore = await page.evaluate(() => JSON.stringify(EA.app.getState().units));
  ok('初回診断の前でも「Lv2を練習する」がある', await page.locator('[data-act="lv2-open"]').isEnabled());
  await page.click('[data-act="lv2-open"]');
  const rangeLabels = await page.locator('[data-act="lv2-range"]').allInnerTexts();
  ok('範囲は「全範囲」＋5項目', JSON.stringify(rangeLabels) === JSON.stringify(['全範囲'].concat(ITEM_LABELS)), rangeLabels.join('｜'));
  const shownN = +(await page.locator('#lv2-count .num').innerText());
  await page.click('[data-act="lv2-start"]');
  await page.waitForSelector('.sheet');
  const sAll = await page.evaluate(() => {
    const s = EA.app.getState().activeSession, B = EA.banks['infinitive-lv2'];
    return { n: s.items.length, ids: s.items.map((x) => x.questionId), skills: s.items.map((x) => EA.findQuestion(B, x.questionId).skill), rangeLabel: s.rangeLabel };
  });
  ok('全範囲：表示した問題数と実際の出題数が一致', shownN === sAll.n, '表示 ' + shownN + '問・出題 ' + sAll.n + '問（設定 ' + (await page.evaluate(() => EA.config.selfPracticeQuestions)) + '問）');
  ok('全範囲：5項目すべてから出題', new Set(sAll.skills).size === 5, sAll.skills.join(','));
  ok('全範囲：同じ問題を出さない', new Set(sAll.ids).size === sAll.ids.length);
  // 回答前の画面に項目名を出さない
  const leakLabel = [];
  for (let i = 0; i < sAll.n; i++) {
    const txt = await page.locator('.q-progress, .sheet .eyebrow, .q-instruction, .q-question, .q-rule, .helpers').allInnerTexts();
    ITEM_LABELS.forEach((l) => { if (txt.join(' ').includes(l)) leakLabel.push(l); });
    const q = await curQ(page);
    if (i < sAll.n - 1) {
      if (q.format === 'order') await answerOrder(page, q, true); else await answerChoice(page, q, true);
      await submit(page); await verdict(page); await next(page); await page.waitForSelector('.sheet');
    }
  }
  ok('回答前の問題画面に学習項目名を出さない', leakLabel.length === 0, leakLabel.join(','));

  // 途中の学習があるとき、Lv2 は始められず再開へ案内する
  await page.click('[data-act="save-home"]');
  await page.click('[data-go="units"]');
  await page.click('[data-act="lv2-open"]');
  ok('途中の学習があるときは再開へ案内する', (await page.locator('#lv2-practice [data-act="task-resume"]').count()) === 1 && (await page.locator('[data-act="lv2-start"]').count()) === 0);
  await page.click('#lv2-practice [data-act="task-resume"]');
  const qLast = await curQ(page);
  if (qLast.format === 'order') await answerOrder(page, qLast, true); else await answerChoice(page, qLast, true);
  await submit(page); await verdict(page); await next(page);
  await page.waitForSelector('.page-title');
  const sumTxt = await page.locator('main').innerText();
  ok('学習結果で範囲と項目名を確認できる', sumTxt.includes('範囲：全範囲') && sumTxt.includes('学習項目ごとの結果') && ITEM_LABELS.every((l) => sumTxt.includes(l)));

  /* 4. 項目別：表示した問題数と出題数、形式が混ざる */
  for (let k = 0; k < 5; k++) {
    await page.evaluate(() => EA.app.go('units'));
    await page.click('[data-act="lv2-open"]');
    const rid = 'lv2-' + ['gi', 'not', 'enough', 'inorder', 'wh'][k];
    await page.click(`[data-act="lv2-range"][data-range="${rid}"]`);
    const n = +(await page.locator('#lv2-count .num').innerText());
    await page.click('[data-act="lv2-start"]');
    await page.waitForSelector('.sheet');
    const info = await page.evaluate(() => {
      const s = EA.app.getState().activeSession, B = EA.banks['infinitive-lv2'];
      const qs = s.items.map((x) => EA.findQuestion(B, x.questionId));
      return { n: qs.length, skills: [...new Set(qs.map((q) => q.skill))], groups: [...new Set(qs.map((q) => q.formatGroup))], ids: qs.map((q) => q.id) };
    });
    ok(`項目別（${ITEM_LABELS[k]}）：表示 ${n}問＝出題 ${info.n}問・同じ項目だけ・形式が混ざる・重複なし`,
      n === info.n && info.skills.length === 1 && info.skills[0] === rid && info.groups.length >= 3 && new Set(info.ids).size === info.n,
      '形式 ' + info.groups.join(','));
    await page.evaluate(() => { EA.app.getState().activeSession = null; });
  }

  /* 5. 形式ごとの採点（正答・誤答） */
  const pick = await page.evaluate(() => {
    const Q = EA.banks['infinitive-lv2'].questions;
    const f = (fn) => (Q.find(fn) || {}).id;
    return {
      normal: f((q) => q.orderKind === 'normal' && q.fixedStart) || f((q) => q.orderKind === 'normal'),
      normalEnd: f((q) => q.orderKind === 'normal' && q.fixedEnd),
      extra: f((q) => q.orderKind === 'extra'),
      missing: f((q) => q.orderKind === 'missing'),
      enough8: 'inf-lv2-enough-ord-08',
      fact: f((q) => q.lv2Format === 'fact'),
      wo: f((q) => q.lv2Format === 'wo'),
      tfO: f((q) => q.format === 'judge' && q.answer === 'o'),
      tfX: f((q) => q.format === 'judge' && q.answer === 'x')
    };
  });
  const cases = [['normal', '通常の並べ替え'], ['normalEnd', '通常の並べ替え（文末固定）'], ['extra', '余分な語がある並べ替え'], ['missing', '不足語を補う並べ替え'],
    ['fact', '英文から確実に分かること'], ['wo', '正しい語順を選ぶ'], ['tfO', '○×判断（答え○）'], ['tfX', '○×判断（答え×）']];
  for (const [key, label] of cases) {
    if (!pick[key]) { ok(label + '：該当する問題がある', false); continue; }
    for (const correct of [true, false]) {
      await openSessionWith(page, [pick[key]]);
      const q = await curQ(page);
      if (q.format === 'order') {
        if (q.orderKind === 'extra') ok(label + '：「余分な語が1つあります」を表示', (await page.locator('.q-rule').innerText()).includes('余分な語が1つあります'));
        if (q.orderKind === 'missing') ok(label + '：「不足している語を1つ補ってください」を表示', (await page.locator('.q-rule').innerText()).includes('不足している語を1つ補ってください'));
        if (q.fixedStart || q.fixedEnd) ok(label + '：固定部分を動かせない部品として表示', (await page.locator('.order-answer .chip-fixed').count()) === (q.fixedStart ? 1 : 0) + (q.fixedEnd ? 1 : 0));
        await answerOrder(page, q, correct, correct && q.orderKind === 'missing' ? '　' + q.missingWord.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)) + ' ' : null);
      } else {
        if (q.format === 'judge') ok(label + '：判断の基準を明記', (await page.locator('.q-question').innerText()).includes('文法的に正しく、日本語の意味も表していれば○'));
        if (q.lv2Format === 'fact') {
          // 回答前は、和訳・解説の欄を出さない（選択肢の中の日本語は除いて確かめる）
          const outside = await page.evaluate(() => { const c = document.querySelector('.sheet').cloneNode(true); c.querySelectorAll('.choices').forEach((x) => x.remove()); return c.innerText; });
          ok(label + '：回答前に全文の和訳・解説を出さない', (await page.locator('.sheet .ex-translation, .sheet .explain').count()) === 0 && !(q.explanation.translation && outside.includes(q.explanation.translation)));
        }
        if (q.lv2Format === 'wo') ok(label + '：日本語の意味まで含めて選ぶ指示', (await page.locator('.q-question').innerText()).includes('日本語の意味'));
        await answerChoice(page, q, correct);
      }
      await submit(page);
      const v = await verdict(page);
      ok(`${label}：${correct ? '正答' : '誤答'}を${correct ? '正解' : '不正解'}と採点`, v.includes(correct ? '正解' : '不正解') && (correct ? !v.includes('不正解') : true), v);
      const a = await page.evaluate(() => { const st = EA.app.getState(); return st.attempts[st.attempts.length - 1]; });
      if (q.format === 'order') ok(`${label}：回答履歴は固定部分を含む英文全体`, (!q.fixedStart || a.responseText.startsWith(q.fixedStart)) && (!q.fixedEnd || a.responseText.endsWith(q.fixedEnd)), a.responseText);
      if (q.format === 'judge' && q.answer === 'x') {
        const t = await page.locator('.tf-correction').innerText();
        ok(`${label}：採点後に訂正例と、文法・意味のどちらが違ったかを表示`, t.includes(q.correction) && t.includes(q.wrongLabel), t.replace(/\s+/g, ' '));
      }
      await page.evaluate(() => { EA.app.getState().activeSession = null; });
    }
  }
  // 全128問：正答は正解、誤答は不正解（採点の規則で確かめる。並べ替えは語句の並び、選択式は選択肢ID）
  const all = await page.evaluate(() => JSON.parse(JSON.stringify(EA.banks['infinitive-lv2'].questions)));
  const wrongAll = [];
  for (const q of all) {
    let good, bad;
    if (q.format === 'order') {
      const pieces = q.tokens.filter((t) => !(q.orderKind === 'extra' && t === q.extraToken)).concat(q.orderKind === 'missing' ? [q.missingWord] : []);
      good = splitAnswer(q, pieces);
      bad = q.orderKind === 'extra' ? q.tokens.slice() : q.orderKind === 'missing' ? good.filter((t) => t !== q.missingWord).concat([q.missingWord]).reverse() : good.slice().reverse();
      if (good.length !== pieces.length) wrongAll.push(q.id + '（語句から正答を作れない）');
    } else { good = q.answer; bad = q.choices.find((c) => c.id !== q.answer).id; }
    const r = await page.evaluate(([id, g, b]) => { const Q = EA.findQuestion(EA.banks['infinitive-lv2'], id); return [EA.grading.grade(Q, g).result, EA.grading.grade(Q, b).result]; }, [q.id, good, bad]);
    if (r[0] !== 'correct' || r[1] !== 'incorrect') wrongAll.push(q.id + ' ' + r.join('/'));
  }
  ok('全' + all.length + '問：正答を正解、誤答を不正解と採点', wrongAll.length === 0, wrongAll.join('、'));
  // 選択肢の表示順を変えても ID で採点
  await openSessionWith(page, [pick.fact]);
  const orders = await page.evaluate(() => {
    const st = EA.app.getState(), s = st.activeSession, B = EA.banks['infinitive-lv2'];
    const q = EA.findQuestion(B, s.items[0].questionId);
    s.current.choiceOrder = q.choices.map((c) => c.id).reverse();
    s.current.draft = q.answer;
    const r = EA.session.submit(st, B, false, { app: Date.now(), real: Date.now() });
    return { result: r.attempt.result, order: r.attempt.choiceOrder };
  });
  ok('選択式：表示順を入れ替えても選択肢IDで採点', orders.result === 'correct', '表示順 ' + orders.order.join(','));
  await page.evaluate(() => { EA.app.getState().activeSession = null; });

  /* 6. 不足語を置いた状態で途中保存 → 再読み込み → 復元 → 採点 → 結果 */
  await openSessionWith(page, [pick.enough8, pick.fact]);
  const q8 = await curQ(page);
  ok('enough to do 第8問の正答', q8.answers[0] === 'The sound was loud enough to be heard in the next room.' && q8.missingWord === 'enough', q8.answers[0] + '／不足語 ' + q8.missingWord);
  // いったん別の語を補ってから直す・消す（確定前に編集・削除できる）
  await page.fill('#add-word-input', 'much');
  await page.click('[data-act="add-word-set"]');
  await page.click('[data-act="add-word-del"]');
  ok('補った語を確定前に消せる', (await page.locator('.chip-added').count()) === 0);
  await page.fill('#add-word-input', ' ｅｎｏｕｇｈ ');
  await page.click('[data-act="add-word-set"]');
  ok('全角・前後の空白を整えて語句に加える', (await page.locator('.order-pool .chip-added').innerText()).trim() === 'enough');
  const seq = splitAnswer(q8, q8.tokens.concat(['enough']));
  for (const t of seq) await tapChip(page, t);
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(EA.app.getState().activeSession.current)));
  await page.click('[data-act="save-home"]');
  await page.reload();
  await page.waitForSelector('.topbar');
  await page.click('[data-act="task-resume"]');
  await page.waitForSelector('#order-mount .order-answer');
  const after = await page.evaluate(() => JSON.parse(JSON.stringify(EA.app.getState().activeSession.current)));
  const placedText = (await page.locator('.order-answer [data-tok]').allInnerTexts()).map((x) => x.trim()).join(' ');
  ok('再読み込み後に、補った語・その位置・並べた語句を復元', after.added === 'enough' && JSON.stringify(after.draft) === JSON.stringify(before.draft) &&
    placedText === seq.join(' ') && (await page.inputValue('#add-word-input')) === 'enough', placedText);
  ok('再開後も「回答を確定」できる', await page.locator('#submit-btn').isEnabled());
  await submit(page);
  const v8 = await verdict(page);
  const a8 = await page.evaluate(() => { const st = EA.app.getState(); return st.attempts[st.attempts.length - 1]; });
  ok('復元後の採点が正解', v8.includes('正解') && !v8.includes('不正解'), a8.responseText);
  ok('補った語とその位置を回答に記録', a8.orderInfo && a8.orderInfo.added === 'enough' && a8.orderInfo.addedPos === seq.indexOf('enough') + 1, JSON.stringify(a8.orderInfo));
  await next(page);
  // 2問目：選択肢を選んだ状態で途中保存 → 復元
  const qf = await curQ(page);
  await page.click(`[data-act="choose"][data-choice="${qf.answer}"]`);
  await page.waitForTimeout(50);
  await page.click('[data-act="save-home"]');
  await page.reload();
  await page.waitForSelector('.topbar');
  await page.click('[data-act="task-resume"]');
  await page.waitForSelector('.choices');
  ok('再読み込み後に、選んだ回答を復元', (await page.locator(`[data-act="choose"][data-choice="${qf.answer}"]`).getAttribute('aria-checked')) === 'true');
  await submit(page); await verdict(page); await next(page);
  await page.waitForSelector('.page-title');
  ok('最後まで進めると結果を表示', (await page.locator('main').innerText()).includes('不定詞Lv2の練習のまとめ'));

  /* 7. 履歴・既存機能への影響 */
  await page.click('[data-go="home"]');
  const after7 = await page.evaluate(() => {
    const st = EA.app.getState();
    const lv2 = st.attempts.filter((a) => /^inf-lv2-/.test(a.questionId));
    const statuses = EA.banks.infinitive.skills.map((sk) => EA.mastery.analyze(sk.id, st.attempts, EA.banks.infinitive).attemptCount);
    return { n: lv2.length, allSelf: lv2.every((a) => a.attemptType === 'self' && a.sessionType === 'self' && a.practiceSet === 'lv2'),
      timed: lv2.every((a) => typeof a.activeMs === 'number'), units: JSON.stringify(st.units), schedule: Object.keys(st.schedule).length,
      sessions: st.sessions.filter((s) => s.practiceSet === 'lv2').length, statuses, home: EA.planner.homeTask(st, EA.banks.infinitive, Date.now()).kind };
  });
  ok('Lv2 の回答が自主練習（self）として履歴に残る', after7.n > 0 && after7.allSelf && after7.sessions > 0, '回答 ' + after7.n + '件・学習回 ' + after7.sessions + '回');
  ok('Lv2 の回答に学習時間（activeMs）が残る', after7.timed);
  ok('初回診断の状態・復習予定・確認状況が変わらない', after7.units === diagBefore && after7.schedule === 0 && after7.statuses.every((n) => n === 0) && after7.home === 'diagnostic',
    'units=' + after7.units + ' schedule=' + after7.schedule + ' home=' + after7.home);
  await page.click('[data-go="history"]');
  await page.click('[data-act="history-unit"][data-unit="infinitive"]');
  const hist = await page.locator('.history-log').innerText();
  ok('履歴・復習（不定詞）に Lv2練習の回答が並ぶ', hist.includes('Lv2練習'));
  // Lv1：初回の Lv1 はホームの課題（単元タブの「Lv1をもう一度」は初回の Lv1 を終えてから出る）
  await page.click('[data-go="units"]');
  ok('初回の Lv1 の前は、単元タブに「Lv1をもう一度」を出さない', (await page.locator('[data-act="lv1-start"]').count()) === 0);
  await page.click('[data-go="home"]');
  ok('ホームの課題は「不定詞 Lv1（8問）」のまま', (await page.locator('.hero-title').innerText()) === '不定詞 Lv1' && (await page.locator('.hero-size').innerText()).includes('8問'));
  await page.click('[data-go="units"]');

  await page.screenshot({ path: path.join(__dirname, 'out', 'lv2-units.png') }).catch(() => {});
  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log('\n' + (results.length - failed.length) + ' / ' + results.length + ' 件 合格');
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'lv2-check-result.json'), JSON.stringify({ fixture: !!FIXTURE, at: new Date().toISOString(), results }, null, 1));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
