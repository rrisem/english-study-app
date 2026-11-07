// ルール部分のテスト： node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEA } from '../tools/load.mjs';

const EA = loadEA();
const bank = EA.banks.infinitive;
const Q = (id) => EA.findQuestion(bank, id);
const DAY = 86400000;
const T0 = new Date(2026, 10, 7, 16, 0).getTime();

function att(over) {
  const q = Q(over.questionId);
  return { id: Math.random().toString(36), questionVersion: 1, skillId: q.skill, attemptType: 'diagnostic',
    result: 'correct', hintUsed: false, confidence: 'none', answeredAt: T0, ...over };
}

test('日英：大文字小文字・空白・文末記号・短縮形を区別しない', () => {
  const q = Q('inf-d6');
  assert.equal(EA.grading.grade(q, '  i WANT a book   to read ').result, 'correct');
  assert.equal(EA.grading.grade(q, 'I’d like a book to read!').result, 'correct');
  assert.equal(EA.grading.grade(q, 'I want to read a book.').result, 'incorrect');
  assert.equal(EA.grading.grade(q, 'I want book to read.').result, 'minor');
  assert.equal(EA.grading.grade(q, 'I need a novel to read.').result, 'unmatched');
});

test('日英：動名詞は「別の正しい表現」で、誤りにしない', () => {
  const q = Q('inf-d5');
  assert.equal(EA.grading.grade(q, 'My dream is being a teacher.').result, 'alt');
  assert.equal(EA.grading.grade(q, 'My dream is become a teacher.').result, 'incorrect');
  assert.equal(EA.grading.grade(q, 'My dream is to become a teacher').result, 'correct');
});

test('並び替え：to が2つあっても順番どおりなら正解', () => {
  const q = Q('inf-d4');
  assert.equal(EA.grading.grade(q, ['Ken', 'went', 'to', 'the park', 'to', 'play', 'soccer']).result, 'correct');
  assert.equal(EA.grading.grade(q, ['Ken', 'went', 'to', 'play', 'soccer', 'to', 'the park']).result, 'incorrect');
});

test('確認状況：解説直後の解き直しは「自力の正解」に数えない', () => {
  const a = [
    att({ questionId: 'inf-d1', result: 'incorrect' }),
    att({ questionId: 'inf-d1', attemptType: 'retry', answeredAt: T0 + 1000 }),
  ];
  const s = EA.mastery.computeSkillStatus('inf-noun', a, bank);
  assert.equal(s.level, 1);
});

test('確認状況：別の問題で自力正解 → 2、日を空けた復習で正解 → 3', () => {
  const a = [
    att({ questionId: 'inf-d1' }),
    att({ questionId: 'inf-d5', answeredAt: T0 + 1000 }),
  ];
  assert.equal(EA.mastery.computeSkillStatus('inf-noun', a, bank).level, 2);
  a.push(att({ questionId: 'inf-p-n1', attemptType: 'review', answeredAt: T0 + 3 * DAY }));
  assert.equal(EA.mastery.computeSkillStatus('inf-noun', a, bank).level, 3);
});

test('確認状況：自信がない・ヒントありの正解は 2 に数えない', () => {
  const a = [
    att({ questionId: 'inf-d1', confidence: 'unsure' }),
    att({ questionId: 'inf-d5', hintUsed: true, answeredAt: T0 + 1000 }),
  ];
  assert.equal(EA.mastery.computeSkillStatus('inf-noun', a, bank).level, 1);
});

test('不備のある問題（excluded）の回答は判定から除外される', () => {
  const EA2 = loadEA();
  const b = EA2.banks.infinitive;
  EA2.findQuestion(b, 'inf-d5').status = 'excluded';
  const a = [att({ questionId: 'inf-d1' }), att({ questionId: 'inf-d5', answeredAt: T0 + 1 })];
  const s = EA2.mastery.computeSkillStatus('inf-noun', a, b);
  assert.equal(s.level, 1);
  assert.ok(s.evidence.some((e) => e.includes('除外')));
});

test('復習予定：診断で安定 → 3日後、誤り → 1日後', () => {
  const sch = {};
  EA.scheduler.applySession(sch, 'diagnostic', [
    att({ questionId: 'inf-d1' }), att({ questionId: 'inf-d5' }),
    att({ questionId: 'inf-d2', result: 'incorrect' }), att({ questionId: 'inf-d4' }),
  ], T0, EA.config, bank);
  assert.equal(EA.util.dayDiff(T0, sch['inf-noun'].dueAt), 3);
  assert.equal(EA.util.dayDiff(T0, sch['inf-adv'].dueAt), 1);
});

test('復習予定：類題（解説直後）の正解では間隔を延ばさない／復習で正解なら延ばす／誤りで戻す', () => {
  const sch = {};
  EA.scheduler.applySession(sch, 'diagnostic', [att({ questionId: 'inf-d2', result: 'incorrect' })], T0, EA.config, bank);
  EA.scheduler.applySession(sch, 'practice', [att({ questionId: 'inf-p-v1', attemptType: 'similar' })], T0, EA.config, bank);
  assert.equal(sch['inf-adv'].step, 0);
  const t1 = T0 + DAY;
  EA.scheduler.applySession(sch, 'review', [att({ questionId: 'inf-p-v3', attemptType: 'review', answeredAt: t1 })], t1, EA.config, bank);
  assert.equal(sch['inf-adv'].step, 1);
  assert.equal(EA.util.dayDiff(t1, sch['inf-adv'].dueAt), 3);
  EA.scheduler.applySession(sch, 'review', [att({ questionId: 'inf-p-v2', attemptType: 'review', confidence: 'unsure' })], t1, EA.config, bank);
  assert.equal(sch['inf-adv'].step, 1, '自信がない正解は同じ段階のまま');
  EA.scheduler.applySession(sch, 'review', [att({ questionId: 'inf-p-v2', attemptType: 'review', result: 'incorrect' })], t1, EA.config, bank);
  assert.equal(sch['inf-adv'].step, 0);
});

test('休んだあと：期限切れが多くても1回の復習は上限まで、確認状況の低い順', () => {
  const st = EA.storage.defaultState();
  st.attempts = [att({ questionId: 'inf-d1' }), att({ questionId: 'inf-d5' }), att({ questionId: 'inf-d2', result: 'incorrect' })];
  ['inf-noun', 'inf-adj', 'inf-adv'].forEach((k) => (st.schedule[k] = { skillId: k, step: 0, dueAt: EA.util.addDays(T0, 1) }));
  EA.config.maxReviewSkillsPerSession = 2;
  const s = EA.planner.buildReviewSession(st, bank, T0 + 20 * DAY);
  EA.config.maxReviewSkillsPerSession = 3;
  assert.equal(s.reviewSkills.length, 2);
  assert.equal(s.deferredSkills.length, 1);
  assert.equal(s.deferredSkills[0], 'inf-noun', '確認が進んでいる項目があとまわし');
  assert.equal(s.items.length, 4);
});

test('復習の問題選び：前に間違えた問題と、別の問題を組み合わせる', () => {
  const st = EA.storage.defaultState();
  st.attempts = [att({ questionId: 'inf-d2', result: 'incorrect' }), att({ questionId: 'inf-p-v1', attemptType: 'similar', answeredAt: T0 + 1 })];
  const picks = EA.planner.pickReviewQuestions(st, bank, 'inf-adv', 2).map((q) => q.id);
  assert.equal(picks.length, 2);
  assert.ok(picks.includes('inf-d2'));
  assert.ok(!picks.includes('inf-p-v1'), '直前に解いた類題は避ける');
});

test('診断後の類題：同じ問題の解き直しと別の類題を、別の種類として出す', () => {
  const st = EA.storage.defaultState();
  st.units.infinitive = { diagnosticSessionId: 'S' };
  st.attempts = ['inf-d1', 'inf-d2', 'inf-d3', 'inf-d4', 'inf-d5', 'inf-d6'].map((id) => att({ questionId: id, sessionId: 'S' }));
  st.attempts[1].result = 'incorrect';
  st.attempts[4].confidence = 'unsure';
  const s = EA.planner.buildPracticeSession(st, bank, T0);
  const kinds = [...s.items].map((i) => i.kind + ':' + (i.attemptType || '') + ':' + i.questionId);
  assert.deepEqual(kinds, [
    'explain::inf-d2', 'question:retry:inf-d2', 'question:similar:inf-p-v1',
    'explain::inf-d5', 'question:similar:inf-p-n2',
  ]);
});
