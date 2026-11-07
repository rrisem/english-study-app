// 外部レビューの指摘を、修正前（v1）のコードで再現するためのテスト。
// 期待する正しい動作を書いているので、修正前は失敗するのが「再現できた」ことを意味する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEA } from '../tools/load.mjs';

const EA = loadEA();
const bank = EA.banks.infinitive;
const DAY = 864e5;
const T0 = new Date(2026, 10, 7, 16, 0).getTime();
const att = (o) => ({ id: Math.random().toString(36), questionVersion: 1, skillId: EA.findQuestion(bank, o.questionId).skill,
  attemptType: 'diagnostic', result: 'correct', hintUsed: false, confidence: 'none', answeredAt: T0, reason: null, ...o });

test('A: 答えは正解・理由は不正解でも、自力で安定して正解として復習間隔が延びる', () => {
  const sch = { 'inf-noun': { skillId: 'inf-noun', step: 1, dueAt: T0 } };
  EA.scheduler.applySession(sch, 'review', [att({ questionId: 'inf-p-n1', attemptType: 'review', reason: { correct: false } })], T0, EA.config, bank);
  assert.equal(sch['inf-noun'].step, 1, '理由が違うのに間隔が延びた');
});

test('A: 理由を全問まちがえても「別の問題でも自力で解けた」になる', () => {
  const a = [att({ questionId: 'inf-p-n1', attemptType: 'similar', reason: { correct: false } }),
    att({ questionId: 'inf-p-n3', attemptType: 'similar', reason: { correct: false }, answeredAt: T0 + 1 })];
  assert.notEqual(EA.mastery.computeSkillStatus('inf-noun', a, bank).level, 2);
});

test('B: 後日の復習で誤答しても、直後の一問の正解で最上段階に戻る', () => {
  const a = [att({ questionId: 'inf-d1' }), att({ questionId: 'inf-d5', answeredAt: T0 + 1 }),
    att({ questionId: 'inf-p-n1', attemptType: 'review', answeredAt: T0 + 4 * DAY }),
    att({ questionId: 'inf-p-n3', attemptType: 'review', result: 'incorrect', answeredAt: T0 + 20 * DAY }),
    att({ questionId: 'inf-p-n4', attemptType: 'review', answeredAt: T0 + 20 * DAY + 60000 })];
  assert.ok(EA.mastery.computeSkillStatus('inf-noun', a, bank).level < 3, '最近の誤答が消えた');
});

test('B: 解説を見た直後の類題の正解が、独立した自力正解として数えられる', () => {
  const a = [att({ questionId: 'inf-d1', result: 'incorrect' }), att({ questionId: 'inf-d5', answeredAt: T0 + 1 }),
    att({ questionId: 'inf-p-n1', attemptType: 'similar', answeredAt: T0 + 2 })];
  assert.ok(EA.mastery.computeSkillStatus('inf-noun', a, bank).level < 2, '解説直後の正解で「別の問題でも自力」になった');
});

test('C: 30日間隔の段階で「自信がない」正解をしても、次回がまた30日後になる', () => {
  const sch = { 'inf-adv': { skillId: 'inf-adv', step: 4, dueAt: T0 } };
  EA.scheduler.applySession(sch, 'review', [att({ questionId: 'inf-p-v1', attemptType: 'review', confidence: 'unsure' })], T0, EA.config, bank);
  assert.ok(EA.util.dayDiff(T0, sch['inf-adv'].dueAt) <= 3, '次回: ' + EA.util.dayDiff(T0, sch['inf-adv'].dueAt) + '日後');
});

test('表示: 自力で正解して「自信がない」を押しただけで「ヒントや解説があれば解ける」と出る', () => {
  const s = EA.mastery.computeSkillStatus('inf-noun', [att({ questionId: 'inf-d1', confidence: 'unsure' })], bank);
  assert.ok(!/ヒント/.test(s.label), s.label);
});

test('表示: 自力の正解が一問だけでも「ヒントや解説があれば解ける」と出る', () => {
  const s = EA.mastery.computeSkillStatus('inf-noun', [att({ questionId: 'inf-d1' })], bank);
  assert.ok(!/ヒント/.test(s.label), s.label);
});

test('問題: 理由の質問文に正答がそのまま書かれている', () => {
  const leaks = bank.questions.filter((q) => q.reason && q.format === 'fill' &&
    q.reason.prompt.includes(q.choices.find((c) => c.id === q.answer).text)).map((q) => q.id);
  assert.deepEqual([...leaks], []);
});

test('問題: 英作文の指示に不定詞の条件がないのに、別表現は「to で書き直し」と扱う', () => {
  const q = EA.findQuestion(bank, 'inf-d5');
  assert.match(q.instruction, /to/);
});

test('データ: 開発用の日付ずらしが通常の記録と同じ保存領域に入る', () => {
  const s = EA.storage.defaultState();
  assert.equal('devDayOffset' in s.settings, false, '通常の保存データに devDayOffset がある');
});
