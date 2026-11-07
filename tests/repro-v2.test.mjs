// 第3回の依頼の観点を、修正前（v2, コミット 89e37a0）のコードで再現するテスト。
// 期待する正しい動作を書いているので、修正前に失敗すれば「再現できた」ことになる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, att as mk, T0, DAY } from './helpers.mjs';

test('選択肢：正答だけが to で始まり、形の手がかりだけで選べる', () => {
  const c = setup();
  const cued = c.bank.questions.filter((q) => q.format === 'fill' && q.status !== 'excluded' &&
    q.choices.filter((ch) => /^to /.test(ch.text)).length < 2).map((q) => q.id);
  assert.deepEqual([...cued], []);
});

test('選択肢：表示の順番が毎回同じ（正答の位置が固定）', () => {
  const c = setup();
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  const cur = c.EA.session.ensureCurrent(c.state, c.bank, c.t());
  assert.ok(Array.isArray(cur.choiceOrder), '選択肢の並びを問題ごとに変える仕組みがない');
});

test('理由：日本語訳を見たあとの理由の正解が、独立した意味理解として「確認できた」になる', () => {
  const c = setup();
  // 並び替え（日本語つき）の復習で、答え・理由とも正解
  const a = mk(c.EA, c.bank, { questionId: 'inf-p-n3', attemptType: 'review', sessionId: 'r', reason: { asked: true, correct: true } });
  const st = c.EA.mastery.analyze('inf-noun', [a], c.bank);
  assert.notEqual(st.meaning, 'confirmed');
});

test('理由：安定した実績がある内容でも、毎回理由を聞く', () => {
  const c = setup();
  const EA = c.EA, bank = c.bank;
  c.state.attempts.push(
    mk(EA, bank, { questionId: 'inf-d1' }), mk(EA, bank, { questionId: 'inf-d5', ms: 1 }),
    mk(EA, bank, { questionId: 'inf-p-n2', attemptType: 'review', day: 4, sessionId: 'r4' }));
  c.state.schedule['inf-noun'] = { skillId: 'inf-noun', step: 3, dueAt: EA.util.startOfDay(T0 + 18 * DAY) };
  c.setDay(18);
  c.start(EA.planner.buildReviewSession(c.state, bank, c.t().app));
  let asked = 0;
  while (c.state.activeSession) {
    const r = c.answer('correct');
    if (r.attempt && r.attempt.reason) asked++;
  }
  assert.equal(asked, 0, '安定している内容で理由を ' + asked + ' 回聞いた');
});

test('理由：1回の学習で聞く数の上限がない', () => {
  const c = setup();
  const EA = c.EA;
  assert.ok(EA.config.maxReasonQuestionsPerSession > 0, '上限の設定がない');
});

test('追加の確認問題：初期設定の上限が2問になっていない', () => {
  const c = setup();
  assert.equal(c.EA.config.maxFollowUpsPerSession, 2);
});
