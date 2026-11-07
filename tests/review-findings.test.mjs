// 外部レビューの指摘（docs/repro-v1-tests.mjs と同じ観点）を、修正後のコードで確かめる。
// 期待する動作は修正前のテストと同じ。API の名前だけが新しい実装に合わせて変わっている。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEA } from '../tools/load.mjs';
import { att as mk, T0, DAY } from './helpers.mjs';

const EA = loadEA();
const bank = EA.banks.infinitive;
const att = (o) => mk(EA, bank, o);
const R2 = { asked: true, correct: false };

test('A: 答えは正解・理由は不正解なら、復習間隔を延ばさない', () => {
  const sch = { 'inf-noun': { skillId: 'inf-noun', step: 1, dueAt: T0 } };
  const a = [att({ questionId: 'inf-p-n1', attemptType: 'review', reason: R2 })];
  EA.scheduler.applySession(sch, 'review', a, a, T0, EA.config, bank);
  assert.ok(sch['inf-noun'].step <= 1, '理由が違うのに間隔が延びた');
  assert.equal(sch['inf-noun'].step, 0);
});

test('A: 理由を全問まちがえたら、別の問題で答えは正解でも「意味の再確認が必要」と出る', () => {
  const a = [att({ questionId: 'inf-p-n1', attemptType: 'review', reason: R2 }),
    att({ questionId: 'inf-p-n3', attemptType: 'review', reason: R2, day: 1 })];
  const st = EA.mastery.analyze('inf-noun', a, bank);
  assert.equal(st.meaning, 'recheck');
  assert.match(st.headline, /意味の再確認/);
  assert.equal(st.achievement, 2, '答えが正解だった事実（実績）は取り消さない');
});

test('B: 後日の復習で誤答したら、直後の一問の正解では解消しない（過去の実績は残る）', () => {
  const a = [att({ questionId: 'inf-d1' }), att({ questionId: 'inf-d5', ms: 1 }),
    att({ questionId: 'inf-p-n1', attemptType: 'review', day: 4, sessionId: 'r4' }),
    att({ questionId: 'inf-p-n3', attemptType: 'review', result: 'incorrect', day: 20, sessionId: 'r20' }),
    att({ questionId: 'inf-p-n4', attemptType: 'followup', afterExplanation: true, day: 20, ms: 60000, sessionId: 'r20' })];
  const st = EA.mastery.analyze('inf-noun', a, bank);
  assert.equal(st.achievement, 3, '過去の実績は残す');
  assert.ok(st.needsRecheck, '最近の誤答が消えた');
  assert.match(st.headline, /最近の誤答/);
});

test('B: 解説を見た直後の類題の正解は、独立した自力正解として数えない', () => {
  const a = [att({ questionId: 'inf-d1', result: 'incorrect' }), att({ questionId: 'inf-d5', ms: 1 }),
    att({ questionId: 'inf-p-n1', attemptType: 'similar', afterExplanation: true, ms: 2, sessionId: 'p' })];
  const st = EA.mastery.analyze('inf-noun', a, bank);
  assert.ok(st.achievement < 2, '解説直後の正解で「別の問題でも自力」になった');
});

test('C: 30日間隔の段階で「自信がない」正解をしたら、3日以内に再確認する', () => {
  const sch = { 'inf-adv': { skillId: 'inf-adv', step: 4, dueAt: T0 } };
  const a = [att({ questionId: 'inf-p-v1', attemptType: 'review', confidence: 'unsure' })];
  EA.scheduler.applySession(sch, 'review', a, a, T0, EA.config, bank);
  assert.ok(EA.util.dayDiff(T0, sch['inf-adv'].dueAt) <= 3, '次回: ' + EA.util.dayDiff(T0, sch['inf-adv'].dueAt) + '日後');
});

test('表示: 自力で正解して「自信がない」を押しただけなら、ヒントの表示にしない', () => {
  const st = EA.mastery.analyze('inf-noun', [att({ questionId: 'inf-d1', confidence: 'unsure' })], bank);
  assert.ok(!/ヒント/.test(st.headline), st.headline);
  assert.equal(st.headline, '自力で正解・本人は自信なし');
});

test('表示: 自力の正解が一問だけなら「自力で1問正解・追加確認前」', () => {
  const st = EA.mastery.analyze('inf-noun', [att({ questionId: 'inf-d1' })], bank);
  assert.ok(!/ヒント/.test(st.headline), st.headline);
  assert.equal(st.headline, '自力で1問正解・追加確認前');
});

test('問題: 理由・意味の質問文に、正答の語句が書かれていない', () => {
  const leaks = bank.questions.filter((q) => q.reason && q.format === 'fill' &&
    q.reason.prompt.includes(q.choices.find((c) => c.id === q.answer).text)).map((q) => q.id);
  assert.deepEqual([...leaks], []);
});

test('問題: 不定詞で書く英作文は、指示に条件が明記されている', () => {
  const q = EA.findQuestion(bank, 'inf-d5');
  assert.match(q.instruction, /to/);
});

test('データ: 通常の保存データに開発用の日付ずらしが入らない', () => {
  const s = EA.storage.defaultState('normal');
  assert.equal('devDayOffset' in s.settings, false);
  assert.equal(s.demo, undefined);
});
