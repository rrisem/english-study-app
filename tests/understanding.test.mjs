// 第3回：理解の確認の妥当性（見た情報に応じた判定・理由を聞く条件・選択肢の手がかり・引き継ぎ）
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, att as mk, T0, DAY } from './helpers.mjs';
import { loadEA } from '../tools/load.mjs';

function diagnose(c, plan = {}) {
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  while (c.state.activeSession) { const id = c.current().questionId; c.answer(plan[id] || 'correct', (plan.opts || {})[id] || {}); }
}
function runToEnd(c, decide = () => ({})) {
  const log = []; let rec = null;
  for (let g = 0; c.state.activeSession && g < 60; g++) {
    const it = c.current();
    const d = it.kind === 'explain' ? {} : (decide(it, log) || {});
    const r = c.answer(d.how || 'correct', d);
    if (!r.explain) log.push({ it, a: r.attempt });
    if (r.finished) rec = r.finished;
  }
  return { log, rec };
}

test('2. 質問文・選択肢から正答が漏れない（理由の質問に正答の語句がない／to の選択肢が2つ以上／正答だけ極端に長くない）', () => {
  const c = setup();
  for (const q of c.bank.questions) {
    if (q.reason && q.choices) assert.ok(!q.reason.prompt.includes(q.choices.find((x) => x.id === q.answer).text), q.id);
    if (q.format === 'fill') assert.ok(q.choices.filter((x) => /^to /.test(x.text)).length >= 2, q.id);
    if (q.choices) {
      const ans = q.choices.find((x) => x.id === q.answer).text.length;
      const others = q.choices.filter((x) => x.id !== q.answer).map((x) => x.text.length);
      assert.ok(ans <= Math.max(...others) * 1.5, q.id + ' の正答が極端に長い');
    }
  }
});

test('2. 選択肢の表示順は学習回ごとに変わり、正答の位置が固定されない', () => {
  const positions = new Set();
  for (let i = 0; i < 30; i++) {
    const c = setup();
    c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
    const cur = c.EA.session.ensureCurrent(c.state, c.bank, c.t());
    positions.add([...cur.choiceOrder].indexOf(c.q('inf-d1').answer));
  }
  assert.ok(positions.size >= 3, '正答の位置: ' + [...positions]);
});

test('訳なしで出題する空所補充は、選択肢の中で文法的に正しいものが1つだけになるよう作っている（日本語なしで出せる）', () => {
  const c = setup();
  const enOnly = c.bank.questions.filter((q) => q.showJa === 'after');
  assert.ok(enOnly.length >= 6);
  for (const q of enOnly) {
    assert.equal(q.format, 'fill');
    assert.ok(!/日本語/.test(q.instruction), q.id + ' の指示が日本語を前提にしている');
  }
});

test('3. 日本語訳を見たあとの理由の正解は「参考」で、意味の確認済みにも再確認の解消にもしない', () => {
  const EA = loadEA(); const bank = EA.banks.infinitive;
  const ref = mk(EA, bank, { questionId: 'inf-p-n3', attemptType: 'review', sessionId: 'r1', translationShown: true, reason: { asked: true, correct: true } });
  assert.equal(EA.mastery.analyze('inf-noun', [ref], bank).meaning, 'reference');
  const ng = mk(EA, bank, { questionId: 'inf-p-n1', attemptType: 'review', sessionId: 'r0', translationShown: false, reason: { asked: true, correct: false }, day: -1 });
  const st = EA.mastery.analyze('inf-noun', [ng, ref], bank);
  assert.equal(st.meaning, 'recheck', '訳を見たあとの正解では、意味の再確認は解消しない');
  const indep = mk(EA, bank, { questionId: 'inf-p-n4', attemptType: 'review', sessionId: 'r2', translationShown: false, reason: { asked: true, correct: true }, day: 1 });
  assert.equal(EA.mastery.analyze('inf-noun', [ng, ref, indep], bank).meaning, 'confirmed', '訳を見ずに別の日に正解すると解消');
});

test('3. 解説を見たあとの理由の回答も「参考」（同じ学習回の類題）', () => {
  const c = setup();
  diagnose(c, { 'inf-d1': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const { log } = runToEnd(c);
  const withReason = log.filter((x) => x.a.reason);
  assert.ok(withReason.length >= 1);
  assert.ok(withReason.every((x) => x.a.reason.independent === false), '解説後の理由はすべて参考');
  assert.notEqual(c.EA.mastery.analyze('inf-noun', c.state.attempts, c.bank).meaning, 'confirmed');
});

test('4. 答えは正解・理由は不正解 → 答えの正解は残し、訳なしの意味の確認問題を追加し、1日後に再確認', () => {
  const c = setup();
  diagnose(c);
  c.setDay(3);
  c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
  const first = c.current();
  assert.ok(c.EA.planner.isEnglishOnly(c.q(first.questionId)), '意味を確かめていない項目の復習1問目は英文だけの問題');
  const { log } = runToEnd(c, (it) => it === first ? { reason: false } : {});
  const a = log[0].a;
  assert.ok(a.reason, '1問目（訳なしの空所補充）で意味の問いが出る');
  {
    assert.equal(a.result, 'correct');
    assert.equal(a.reason.correct, false);
    assert.equal(a.reason.independent, true);
    const fu = log.find((x) => x.it.attemptType === 'followup');
    assert.ok(fu, '確認問題が出る');
    assert.equal(c.q(fu.it.questionId).format, 'meaning', '訳を見せていない意味の確認問題');
    const st = c.EA.mastery.analyze(a.skillId, c.state.attempts, c.bank);
    assert.equal(st.meaning, 'recheck');
    assert.ok(st.achievement >= 1, '答えの正解（実績）は残る');
    assert.equal(c.EA.util.dayDiff(c.t().app, c.state.schedule[a.skillId].dueAt), 1);
  }
});

test('5. 理由を聞かない問題がある（訳を見たあと・安定している）。聞かなかったことを理解とは扱わない', () => {
  const c = setup();
  diagnose(c);
  c.setDay(3);
  c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
  const { log } = runToEnd(c);
  const decisions = log.map((x) => x.a.reasonDecision && x.a.reasonDecision.why);
  assert.ok(decisions.some((w) => w && w !== 'first-check' && w !== 'insufficient'), '聞かない判断もある: ' + decisions);
  const notAsked = log.filter((x) => !x.a.reason);
  assert.ok(notAsked.length > 0);
  // 安定している項目（別の問題で自力正解・訳なしで意味を確認済み）では聞かない
  const EA = c.EA, bank = c.bank;
  const s2 = setup();
  s2.state.attempts.push(
    mk(EA, bank, { questionId: 'inf-d3', questionVersion: 2, sessionId: 'd' }),
    mk(EA, bank, { questionId: 'inf-p-a5', attemptType: 'review', sessionId: 'x2', day: 1 }));
  assert.equal(s2.EA.mastery.analyze('inf-adj', s2.state.attempts, s2.bank).meaning, 'confirmed', '訳なしの意味の確認問題で確認済み');
  const sess = { reasonsAsked: 0 };
  const q = s2.q('inf-p-a1');
  const dec = s2.EA.session.reasonDecision(s2.state, s2.bank, sess, q, { attemptType: 'review' },
    { result: 'correct', hintUsed: false, gaveUp: false, confidence: 'none', translationShown: false });
  assert.deepEqual({ ...dec }, { ask: false, why: 'stable' });
  const dec2 = s2.EA.session.reasonDecision(s2.state, s2.bank, sess, q, { attemptType: 'review' },
    { result: 'correct', hintUsed: false, gaveUp: false, confidence: 'unsure', translationShown: false });
  assert.deepEqual({ ...dec2 }, { ask: true, why: 'unsure' }, '安定していても、自信なし（食い違い）なら聞く');
  const dec3 = s2.EA.session.reasonDecision(s2.state, s2.bank, sess, s2.q('inf-p-a3'), { attemptType: 'review' },
    { result: 'correct', hintUsed: false, gaveUp: false, confidence: 'none', translationShown: true });
  assert.equal(dec3.why, 'translation-shown');
  // 理由を一度も聞いていない項目は「まだ確認していない」
  const s3 = setup(); diagnose(s3);
  assert.equal(s3.EA.mastery.analyze('inf-noun', s3.state.attempts, s3.bank).meaning, 'unchecked');
});

test('5. 1回の学習で理由を聞く数は上限まで', () => {
  const c = setup();
  c.EA.config.maxReasonQuestionsPerSession = 1;
  diagnose(c, { opts: { 'inf-d1': { unsure: true }, 'inf-d2': { unsure: true }, 'inf-d3': { unsure: true }, 'inf-d4': { unsure: true }, 'inf-d5': { unsure: true }, 'inf-d6': { unsure: true } } });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const { log } = runToEnd(c, () => ({ unsure: true }));
  const asked = log.filter((x) => x.a.reason).length;
  assert.equal(asked, 1);
  assert.ok(log.some((x) => x.a.reasonDecision && x.a.reasonDecision.why === 'cap'));
});

test('6. 解説直後の正解・同じ問題の解き直し・後日の自力正解を、根拠として区別する', () => {
  const c = setup();
  diagnose(c, { 'inf-d2': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  runToEnd(c);
  let st = c.EA.mastery.analyze('inf-adv', c.state.attempts, c.bank);
  assert.ok(st.evidence.some((e) => e.startsWith('同じ問題の解き直しで正解：1')));
  assert.ok(st.evidence.some((e) => e.startsWith('別の問題・解説直後に正解：')));
  assert.ok(st.needsRecheck, '解説直後の正解では解消しない');
  c.setDay(1);
  c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
  runToEnd(c);
  st = c.EA.mastery.analyze('inf-adv', c.state.attempts, c.bank);
  assert.ok(st.evidence.some((e) => e.startsWith('後日の復習で自力正解：')));
  assert.equal(st.needsRecheck, false);
});

test('7. 未解決の内容と途中の学習が、保存・再読み込み後も残り、次回の学習に出る', () => {
  const store = new Map();
  const c = setup({ store });
  diagnose(c, { 'inf-d1': 'wrong', 'inf-d2': 'wrong', 'inf-d3': 'wrong', 'inf-d4': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const { rec } = runToEnd(c, (it) => it.attemptType === 'retry' ? {} : { how: 'wrong' });
  assert.ok(rec.followUps <= 2, '追加の確認問題は初期設定で2問まで');
  assert.ok(rec.unresolved.length > 0);
  // 途中の学習（次の復習）を始めて1問答えたところで保存
  c.setDay(1);
  c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
  c.answer('correct');
  c.EA.session.ensureCurrent(c.state, c.bank, c.t());
  assert.ok(c.EA.storage.save(c.state));
  // 再読み込み
  const EA2 = loadEA(undefined, { store });
  const r = EA2.storage.load();
  assert.equal(r.status, 'ok');
  const s = r.state;
  assert.ok(s.activeSession, '途中の学習が残る');
  assert.equal(s.activeSession.index, c.state.activeSession.index);
  assert.ok(Array.isArray(s.activeSession.current.choiceOrder) || s.activeSession.current.choiceOrder === null);
  const last = s.sessions[s.sessions.length - 1];
  assert.ok(last.unresolved.length > 0, '未解決の記録が残る');
  const recheck = ['inf-noun', 'inf-adj', 'inf-adv'].filter((k) => EA2.mastery.analyze(k, s.attempts, EA2.banks.infinitive).needsRecheck);
  assert.ok(recheck.length >= 2);
});

test('8. v2形式の記録を読み込める：記録を消さず控えを作り、訳を見ていたかを補う', () => {
  const EA = loadEA();
  const v2 = {
    schemaVersion: 2, mode: 'normal', settings: { dailyGoalMinutes: 10 }, migrations: [],
    attempts: [
      { id: 'b1', questionId: 'inf-d3', questionVersion: 2, skillId: 'inf-adj', format: 'order', attemptType: 'diagnostic', sessionId: 's', result: 'correct', confidence: 'none', hintUsed: false, afterExplanation: false, reason: null, answeredAt: T0 },
      { id: 'b2', questionId: 'inf-p-a1', questionVersion: 2, skillId: 'inf-adj', format: 'fill', attemptType: 'review', sessionId: 'r', result: 'correct', confidence: 'none', hintUsed: false, afterExplanation: false, reason: { asked: true, choiceId: 'inf-adj', correct: true }, answeredAt: T0 + DAY },
      { id: 'b3', questionId: 'inf-p-a2', questionVersion: 2, skillId: 'inf-adj', format: 'meaning', attemptType: 'review', sessionId: 'r', result: 'correct', confidence: 'none', hintUsed: false, afterExplanation: true, reason: null, answeredAt: T0 + DAY + 1 },
    ],
    schedule: { 'inf-adj': { skillId: 'inf-adj', step: 1, dueAt: T0 + 4 * DAY } }, units: {}, activeSession: null, sessions: [],
  };
  const raw = JSON.stringify(v2);
  EA.__store.set(EA.storage.KEYS.normal, raw);
  const r = EA.storage.load();
  assert.equal(r.status, 'migrated');
  assert.equal(r.state.schemaVersion, 3);
  assert.equal(r.state.attempts.length, 3);
  assert.equal(EA.__store.get(EA.storage.KEYS.backupPrefix + 'schema2-normal'), raw);
  assert.equal(r.state.attempts[0].translationShown, true);
  assert.equal(r.state.attempts[1].translationShown, true, 'v2の空所補充は日本語つきだった');
  assert.equal(r.state.attempts[1].reason.independent, false);
  assert.equal(r.state.attempts[2].translationShown, false);
  assert.deepEqual({ ...r.state.schedule['inf-adj'] }, { ...v2.schedule['inf-adj'] }, '復習予定もそのまま');
});
