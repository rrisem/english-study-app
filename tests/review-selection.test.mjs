// 学習履歴を次の復習に生かす：復習問題の選び方・自信度の扱い・別の問題がないときの動作
// 実行： node --test tests/review-selection.test.mjs（npm run check にも含まれる）
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, att, T0, DAY } from './helpers.mjs';

const skillQs = (bank, s) => bank.questions.filter((q) => q.skill === s && q.status !== 'excluded').map((q) => q.id);
/** 項目 inf-noun の問題をすべて一度ずつ自力で正解した記録。over で問題ごとに条件を変える */
function baseAttempts(EA, bank, over = {}) {
  return skillQs(bank, 'inf-noun').map((id, i) => att(EA, bank, { questionId: id, day: 0, ms: i * 1000, sessionId: 's0', ...(over[id] || {}) }));
}
function picks(c, attempts, skill = 'inf-noun') {
  c.state.attempts = attempts;
  return c.EA.planner.reviewPicks(c.state, c.bank, skill, 2);
}

test('誤答のあと解き直しで正解した問題は、復習の2問目で優先して出す（解説後の正解は解消にしない）', () => {
  const c = setup(); const { EA, bank } = c;
  const a = baseAttempts(EA, bank, { 'inf-d1': { result: 'incorrect' } })
    .concat([att(EA, bank, { questionId: 'inf-d1', attemptType: 'retry', afterExplanation: true, ms: 99000, sessionId: 's1' })]);
  const p = picks(c, a);
  assert.notEqual(p[0].q.id, 'inf-d1', '1問目は別の問題（理解が別の問題でも使えるか）');
  assert.equal(p[1].q.id, 'inf-d1');
  assert.equal(p[1].why, 'recent-error');
});

test('自信がないまま正解した問題・ヒントで正解した問題を、2問目で優先する', () => {
  const c = setup(); const { EA, bank } = c;
  let p = picks(c, baseAttempts(EA, bank, { 'inf-p-n1': { confidence: 'unsure' } }));
  assert.equal(p[1].q.id, 'inf-p-n1'); assert.equal(p[1].why, 'low-confidence');
  p = picks(c, baseAttempts(EA, bank, { 'inf-p-n3': { hintUsed: true } }));
  assert.equal(p[1].q.id, 'inf-p-n3'); assert.equal(p[1].why, 'hint-used');
});

test('優先の順：誤答 → ヒントで正解 → 意味の問いが違った正解 → 自信がない正解', () => {
  const c = setup(); const { EA, bank } = c;
  const p = picks(c, baseAttempts(EA, bank, {
    'inf-p-n1': { confidence: 'unsure' },
    'inf-p-n3': { hintUsed: true },
    'inf-p-n4': { result: 'incorrect' },
  }));
  assert.equal(p[1].q.id, 'inf-p-n4');
});

test('採点保留・指定の形と違う答えは「誤り」として優先しない（判別できない答えを誤答に数えない）', () => {
  const c = setup(); const { EA, bank } = c;
  const all = skillQs(bank, 'inf-noun');
  // inf-d5 だけ採点保留。古い順で2番目にならないよう、ほかの問題より新しい日時にする
  const a = baseAttempts(EA, bank).concat([att(EA, bank, { questionId: 'inf-d5', result: 'unmatched', ms: 99000, sessionId: 's2' })]);
  const p = picks(c, a);
  assert.ok(p.every((x) => x.why !== 'recent-error'));
  assert.ok(!p.some((x) => x.q.id === 'inf-d5'), '最近見た問題は、ほかに候補があれば後回し');
  assert.equal(all.length > 2, true);
});

test('同じ問題をあとで自力で正解したら、その問題の優先は外れる', () => {
  const c = setup(); const { EA, bank } = c;
  const a = baseAttempts(EA, bank, { 'inf-p-n4': { result: 'incorrect' } })
    .concat([att(EA, bank, { questionId: 'inf-p-n4', attemptType: 'review', day: 1, sessionId: 'r1' })]);
  const p = picks(c, a);
  assert.ok(p.every((x) => x.why !== 'recent-error'));
});

test('自信度：「自信がない」と申告なしを区別し、記録がない古い回答を「自信がない」とは扱わない', () => {
  const c = setup(); const { EA, bank } = c;
  const old = att(EA, bank, { questionId: 'inf-p-n1' }); delete old.confidence; // 自信度の項目がない古い記録
  const st = EA.mastery.analyze('inf-noun', [old], bank);
  assert.equal(st.unsure, false);
  assert.equal(EA.mastery.isSolid(old), true);
  const p = picks(c, baseAttempts(EA, bank).filter((x) => x.questionId !== 'inf-p-n1').concat([old]));
  assert.ok(p.every((x) => x.why !== 'low-confidence'));
});

test('項目に問題が1問しかないときは、同じ問題で確認し「別の問題がない」と記録して、再確認を解消しない', () => {
  const c = setup();
  const { EA, bank } = c;
  // inf-adj の問題を1問だけ残す（ほかは除外扱い）
  bank.questions.forEach((q) => { if (q.skill === 'inf-adj' && q.id !== 'inf-d3') q.status = 'excluded'; });
  c.state.attempts = [att(EA, bank, { questionId: 'inf-d3', result: 'incorrect', sessionId: 'd' })];
  c.state.schedule = { 'inf-adj': { skillId: 'inf-adj', step: 0, dueAt: T0 } };
  c.setDay(1);
  const s = EA.planner.buildReviewSession(c.state, bank, c.t().app);
  const items = s.items.filter((it) => it.forSkill === 'inf-adj');
  assert.equal(items.length, 1);
  assert.equal(items[0].questionId, 'inf-d3');
  assert.equal(items[0].pickWhy, 'no-other-question');
  assert.ok(s.unresolved.some((u) => u.skillId === 'inf-adj' && u.trigger === 'no-other-question'));
  // 同じ問題に正解しても、誤答の再確認は解消しない
  c.start(s);
  while (c.state.activeSession) c.answer('correct');
  const st = EA.mastery.analyze('inf-adj', c.state.attempts, bank);
  assert.equal(st.needsRecheck, true);
  const last = c.state.attempts[c.state.attempts.length - 1];
  assert.equal(last.pickWhy, 'no-other-question', '選んだ理由が回答の記録に残る');
});

test('復習の回答には、その問題を選んだ理由が残る（診断などの回答には null）', () => {
  const c = setup(); const { EA, bank } = c;
  c.start(EA.planner.buildDiagnosticSession(bank, c.t().app));
  c.answer('wrong');
  while (c.state.activeSession) c.answer('correct');
  assert.equal(c.state.attempts[0].pickWhy, null);
  c.start(EA.planner.buildPracticeSession(c.state, bank, c.t().app));
  while (c.state.activeSession) c.answer('correct');
  c.setDay(1);
  c.start(EA.planner.buildReviewSession(c.state, bank, c.t().app));
  while (c.state.activeSession) c.answer('correct');
  const rev = c.state.attempts.filter((a) => a.attemptType === 'review');
  assert.ok(rev.length > 0);
  assert.ok(rev.every((a) => typeof a.pickWhy === 'string'));
  assert.ok(rev.some((a) => a.questionId === 'inf-d1' && a.pickWhy === 'recent-error'), '診断で間違えた問題を復習で出す');
});

test('期限が来た項目の順：再確認が必要 → 自信がないが残る → それ以外', () => {
  const c = setup(); const { EA, bank } = c;
  // 3項目とも実績は同じ（別の2問で自力正解）。inf-noun だけ、さらに自信がない正解が残る
  c.state.attempts = [
    att(EA, bank, { questionId: 'inf-d1' }), att(EA, bank, { questionId: 'inf-d5' }),
    att(EA, bank, { questionId: 'inf-p-n1', confidence: 'unsure', ms: 5000 }),
    att(EA, bank, { questionId: 'inf-d3' }), att(EA, bank, { questionId: 'inf-p-a3' }),
    att(EA, bank, { questionId: 'inf-d2' }), att(EA, bank, { questionId: 'inf-p-v3' }),
  ];
  c.state.schedule = {
    'inf-adj': { skillId: 'inf-adj', step: 1, dueAt: T0 - 3 * DAY },
    'inf-adv': { skillId: 'inf-adv', step: 1, dueAt: T0 - 2 * DAY },
    'inf-noun': { skillId: 'inf-noun', step: 1, dueAt: T0 - DAY },
  };
  assert.equal(EA.planner.dueReviews(c.state, bank, T0).map((e) => e.skillId).join(','), 'inf-noun,inf-adj,inf-adv');
});

test('間違えた問題は、別の日に正解すれば（別の問題の解説を見たあとでも）優先から外れ、毎回出続けない', () => {
  const c = setup(); const { EA, bank } = c;
  const base = baseAttempts(EA, bank, { 'inf-d1': { result: 'incorrect' } });
  // 同じ日の、解説を見たあとの正解（類題の流れ）では外れない
  let p = picks(c, base.concat([att(EA, bank, { questionId: 'inf-d1', attemptType: 'similar', afterExplanation: true, ms: 99000, sessionId: 'p' })]));
  assert.ok(p.some((x) => x.q.id === 'inf-d1' && x.why === 'recent-error'));
  // 翌日の復習の2問目（1問目の解説を見たあと）で正解 → 外れる
  p = picks(c, base.concat([att(EA, bank, { questionId: 'inf-d1', attemptType: 'review', afterExplanation: true, day: 1, sessionId: 'r1' })]));
  assert.ok(p.every((x) => x.why !== 'recent-error'));
  // 翌日でも「自信がない」なら、自信の低い正解として残る
  p = picks(c, base.concat([att(EA, bank, { questionId: 'inf-d1', attemptType: 'review', afterExplanation: true, confidence: 'unsure', day: 1, sessionId: 'r1' })]));
  assert.ok(p.some((x) => x.q.id === 'inf-d1' && x.why === 'low-confidence'));
});
