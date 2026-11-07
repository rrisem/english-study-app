// 学習の流れ（session.js を実際に動かす）での確認。依頼の「必ず検証するケース」に番号を対応させている。
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, att as mk, T0, DAY } from './helpers.mjs';
import { loadEA } from '../tools/load.mjs';

function diagnose(c, plan = {}) {
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  let rec = null;
  while (c.state.activeSession) {
    const id = c.current().questionId;
    const r = c.answer(plan[id] || 'correct', (plan.opts || {})[id] || {});
    if (r.finished) rec = r.finished;
  }
  return rec;
}
function runToEnd(c, decide) {
  const log = [];
  let rec = null;
  for (let guard = 0; c.state.activeSession && guard < 60; guard++) {
    const it = c.current();
    const d = it.kind === 'explain' ? {} : (decide(it, log) || {});
    const r = c.answer(d.how || 'correct', d);
    if (!r.explain) log.push({ it, a: r.attempt });
    if (r.finished) rec = r.finished;
  }
  return { log, rec };
}

test('1・2. 答えは正解・意味の問いが違う → 意味は確認済みにせず、意味の確認問題へ進む', () => {
  const c = setup();
  diagnose(c, { 'inf-d1': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const { log } = runToEnd(c, (it) => it.attemptType === 'similar' && c.q(it.questionId).skill === 'inf-noun' ? { reason: false } : {});
  const sim = log.find((x) => x.it.attemptType === 'similar').a;
  assert.equal(sim.result, 'correct', '答えの正誤は正解のまま');
  assert.equal(sim.reason.correct, false, '意味の問いは別に記録');
  assert.ok(sim.followUp && sim.followUp.added, '確認問題が追加される');
  assert.equal(c.q(sim.followUp.added).format, 'meaning', '意味の確認問題を優先');
  const fu = log.find((x) => x.it.attemptType === 'followup').a;
  assert.equal(fu.afterExplanation, true);
  const st = c.EA.mastery.analyze('inf-noun', c.state.attempts, c.bank);
  assert.equal(st.meaning, 'recheck', '同じ学習回の解説後の正解では、意味の再確認は解消しない');
  assert.equal(c.state.schedule['inf-noun'].step, 0);
});

test('理由を聞かなかった回答と、聞いて違った回答を区別する', () => {
  const c = setup();
  diagnose(c);
  const d = c.state.attempts[0];
  assert.equal(d.reason, null, '診断では理由を聞かない（null＝聞いていない）');
  assert.equal(c.EA.mastery.meaningCheck(d, c.bank), null);
  assert.equal(c.EA.mastery.analyze('inf-noun', c.state.attempts, c.bank).meaning, 'unchecked');
});

test('3. 高い実績があっても、最近の誤答は直後の一問の正解では解消せず、別の日の別の問題で解消する', () => {
  const c = setup();
  const EA = c.EA, bank = c.bank;
  c.state.attempts.push(mk(EA, bank, { questionId: 'inf-d1' }), mk(EA, bank, { questionId: 'inf-d5', ms: 1 }),
    mk(EA, bank, { questionId: 'inf-p-n4', attemptType: 'review', day: 4, sessionId: 'r4' }));
  c.state.schedule['inf-noun'] = { skillId: 'inf-noun', step: 4, dueAt: T0 + 30 * DAY };
  assert.equal(EA.mastery.analyze('inf-noun', c.state.attempts, bank).achievement, 3);
  c.setDay(34);
  c.start(EA.planner.buildReviewSession(c.state, bank, c.t().app));
  const first = c.current().questionId;
  const { log } = runToEnd(c, (it) => it.questionId === first ? { how: 'wrong' } : {});
  const followup = log.find((x) => x.it.attemptType === 'followup');
  assert.ok(followup && followup.a.result === 'correct', '直後の確認問題には正解');
  let st = EA.mastery.analyze('inf-noun', c.state.attempts, bank);
  assert.equal(st.achievement, 3, '過去の実績は残る');
  assert.ok(st.needsRecheck, '直後の一問の正解では解消しない');
  assert.equal(c.state.schedule['inf-noun'].step, 0, '予定も1日後（表示と矛盾しない）');
  // 次の日：別の問題に自力正解 → 解消
  c.setDay(35);
  c.start(EA.planner.buildReviewSession(c.state, bank, c.t().app));
  assert.notEqual(c.current().questionId, first, '1問目はつまずいた問題とは別の問題');
  runToEnd(c, () => ({}));
  st = EA.mastery.analyze('inf-noun', c.state.attempts, bank);
  assert.equal(st.needsRecheck, false);
});

test('同じ問題をもう一度正解しただけでは、誤答の再確認は解消しない', () => {
  const EA = loadEA(); const bank = EA.banks.infinitive;
  const a = [mk(EA, bank, { questionId: 'inf-p-n1', attemptType: 'review', result: 'incorrect', day: 1, sessionId: 'x' }),
    mk(EA, bank, { questionId: 'inf-p-n1', attemptType: 'review', day: 2, sessionId: 'y' })];
  assert.ok(EA.mastery.analyze('inf-noun', a, bank).needsRecheck);
});

test('4. 長い間隔の段階でも、自信なしなら3日以内・ヒント使用なら1日後', () => {
  for (const [opts, maxDays] of [[{ unsure: true }, 3], [{ hint: true }, 1]]) {
    const c = setup();
    c.state.schedule = { 'inf-adv': { skillId: 'inf-adv', step: 4, dueAt: c.EA.util.startOfDay(T0) } };
    c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
    const first = c.current().questionId;
    runToEnd(c, (it) => it.questionId === first ? opts : {});
    const days = c.EA.util.dayDiff(c.t().app, c.state.schedule['inf-adv'].dueAt);
    assert.ok(days <= maxDays, JSON.stringify(opts) + ' → ' + days + '日後');
  }
});

test('5. 「自信がない」を押さなかった回答は「申告なし」として記録', () => {
  const c = setup();
  diagnose(c, { opts: { 'inf-d2': { unsure: true } } });
  const conf = c.state.attempts.map((a) => a.confidence);
  assert.deepEqual([...new Set(conf)].sort(), ['none', 'unsure']);
  assert.ok(!conf.includes('sure'));
});

test('6. 採点保留は不正解として扱わない（再確認・間隔の短縮をしない）', () => {
  const c = setup();
  diagnose(c);
  c.state.schedule['inf-noun'] = { skillId: 'inf-noun', step: 2, dueAt: T0 };
  const a = mk(c.EA, c.bank, { questionId: 'inf-d5', attemptType: 'review', result: 'unmatched', day: 7, sessionId: 'r7' });
  c.state.attempts.push(a);
  const st = c.EA.mastery.analyze('inf-noun', c.state.attempts, c.bank);
  assert.equal(st.needsRecheck, false);
  assert.equal(st.counts.wrong, 0);
  c.EA.scheduler.applySession(c.state.schedule, 'review', [a], c.state.attempts, a.answeredAt, c.EA.config, c.bank);
  assert.equal(c.state.schedule['inf-noun'].step, 2, '採点保留だけなら同じ間隔');
});

test('7. 類題・復習で間違えたら、短い説明つきで別の確認問題が出て、ヒントなしで解けたかを記録する', () => {
  const c = setup();
  diagnose(c, { 'inf-d2': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const { log } = runToEnd(c, (it) => it.attemptType === 'similar' ? { how: 'wrong' } : {});
  const sim = log.find((x) => x.it.attemptType === 'similar').a;
  assert.ok(sim.feedback, '選んだ答えについての短い説明がある');
  const fu = log.find((x) => x.it.attemptType === 'followup');
  assert.ok(fu, '確認問題が出る');
  assert.notEqual(fu.it.questionId, sim.questionId, '別の問題');
  assert.equal(c.q(fu.it.questionId).skill, 'inf-adv');
  assert.equal(fu.a.hintUsed, false);
  assert.equal(fu.a.afterExplanation, true, '解説後の回答として記録');
});

test('8. 確認問題は上限まで。確認問題でもつまずいたら追加せず、未解決として次回へ引き継ぐ', () => {
  const c = setup();
  diagnose(c, { 'inf-d1': 'wrong', 'inf-d2': 'wrong', 'inf-d3': 'wrong', 'inf-d4': 'wrong', 'inf-d5': 'giveup', 'inf-d6': 'giveup' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const { log, rec } = runToEnd(c, (it) => it.attemptType === 'retry' ? {} : { how: 'wrong' });
  assert.ok(rec, '学習回が終わる（無限に出題しない）');
  assert.ok(rec.followUps <= c.EA.config.maxFollowUpsPerSession);
  assert.equal(log.filter((x) => x.it.attemptType === 'followup').length, rec.followUps);
  assert.ok(rec.unresolved.length > 0, '未解決の内容を記録');
  assert.ok(rec.unresolved.some((u) => /上限/.test(u.why)));
  const fuWrong = log.find((x) => x.it.attemptType === 'followup').a;
  assert.equal(fuWrong.followUp.basics, true, '確認問題でもつまずいたら基本の説明');
  for (const sk of ['inf-noun', 'inf-adj', 'inf-adv']) {
    assert.ok(c.EA.mastery.analyze(sk, c.state.attempts, c.bank).needsRecheck, sk + ' は再確認が必要のまま');
    assert.equal(c.EA.util.dayDiff(c.t().app, c.state.schedule[sk].dueAt), 1, sk + ' は1日後に復習');
  }
  assert.ok(c.EA.mastery.analyze('inf-noun', c.state.attempts, c.bank).teacherCandidate, 'くり返しの誤答は講師の確認候補');
});

test('8b. 別の確認問題がないときは、限界を記録して確認済みにしない', () => {
  const c = setup();
  c.bank.questions.filter((q) => q.skill === 'inf-adv' && !['inf-d2', 'inf-p-v1'].includes(q.id)).forEach((q) => (q.status = 'excluded'));
  diagnose(c, { 'inf-d2': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const { log, rec } = runToEnd(c, (it) => it.attemptType === 'similar' ? { how: 'wrong' } : {});
  const sim = log.find((x) => x.it.questionId === 'inf-p-v1').a;
  assert.equal(sim.followUp.added, null);
  assert.match(sim.followUp.why, /別の確認問題が用意されていない/);
  assert.ok(rec.unresolved.some((u) => u.skillId === 'inf-adv'));
});

test('「今日はここまで」で終えても、未解決の内容が記録され次回の復習に出る', () => {
  const c = setup();
  diagnose(c, { 'inf-d2': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  c.answer(); // 解説
  const rec = c.EA.session.finish(c.state, c.bank, c.t(), { early: true });
  assert.equal(rec.endedEarly, true);
  assert.ok(rec.skipped.length >= 1);
  assert.ok(rec.unresolved.some((u) => u.skillId === 'inf-adv'));
  c.setDay(1);
  const due = c.EA.planner.dueReviews(c.state, c.bank, c.t().app).map((e) => e.skillId);
  assert.ok(due.includes('inf-adv'));
});

test('9. 解説やヒントを見た直後の関連問題の正解は、自力正解の実績に入れない', () => {
  const c = setup();
  diagnose(c, { 'inf-d1': 'wrong', 'inf-d5': 'wrong' });
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  runToEnd(c, () => ({}));
  const after = c.state.attempts.filter((a) => a.sessionType === 'practice');
  assert.ok(after.every((a) => a.afterExplanation), '解説後の回答として記録');
  const st = c.EA.mastery.analyze('inf-noun', c.state.attempts, c.bank);
  assert.equal(st.achievement, 0);
  assert.match(st.headline, /最近の誤答/);
  assert.equal(st.teacherCandidate, false, '診断で2問間違えただけでは講師の確認候補にしない');
  // 復習：1問目のあとに解説が出るので、同じ項目の2問目は「解説後」
  c.setDay(1);
  c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
  const { log } = runToEnd(c, () => ({}));
  const noun = log.filter((x) => x.a.skillId === 'inf-noun');
  assert.equal(noun[0].a.afterExplanation, false);
  assert.equal(noun[1].a.afterExplanation, true);
  // ヒントを使った正解も自力正解に入れない
  const EA = c.EA, bank = c.bank;
  const h = EA.mastery.analyze('inf-adj', [mk(EA, bank, { questionId: 'inf-d3', hintUsed: true }), mk(EA, bank, { questionId: 'inf-d6', hintUsed: true, ms: 1 })], bank);
  assert.equal(h.achievement, 0);
  assert.match(h.headline, /ヒント/);
});

test('10. デモモードの日付変更・記録は、通常の記録を変えない', () => {
  const EA = loadEA();
  const normal = EA.storage.defaultState('normal');
  normal.attempts.push({ id: 'keep-me' });
  EA.storage.save(normal);
  const before = EA.__store.get(EA.storage.KEYS.normal);
  const demo = EA.storage.enterDemo();
  assert.equal(EA.storage.load().mode, 'demo');
  demo.demo.dayOffset = 7; demo.attempts.push({ id: 'demo-attempt' });
  EA.storage.save(demo);
  assert.equal(EA.__store.get(EA.storage.KEYS.normal), before, 'デモ中も通常の記録は同じ');
  const back = EA.storage.exitDemo();
  assert.equal(back.mode, 'normal');
  assert.deepEqual([...back.state.attempts.map((a) => a.id)], ['keep-me']);
  assert.equal(EA.__store.has(EA.storage.KEYS.demo), false, 'デモの記録は消える');
  assert.equal(back.state.demo, undefined);
});

test('11. 旧形式（v1）の記録を読み込める：削除せず控えを作り、開発用の日付の記録は判定から除く', () => {
  const EA = loadEA();
  const realNow = Date.now();
  const v1 = {
    schemaVersion: 1, settings: { dailyGoalMinutes: 15, devDayOffset: 3 },
    attempts: [
      { id: 'a1', questionId: 'inf-d5', questionVersion: 1, skillId: 'inf-noun', format: 'ja2en', attemptType: 'diagnostic', sessionId: 's1', result: 'correct', confidence: 'none', hintUsed: false, reason: null, answeredAt: realNow - 2 * DAY },
      { id: 'a2', questionId: 'inf-p-n3', questionVersion: 1, skillId: 'inf-noun', format: 'order', attemptType: 'similar', sessionId: 's2', result: 'correct', confidence: 'none', hintUsed: false, reason: { prompt: 'to speak English は…', choiceId: 'a', correct: false }, answeredAt: realNow - DAY },
      { id: 'a3', questionId: 'inf-p-n2', questionVersion: 1, skillId: 'inf-noun', format: 'meaning', attemptType: 'review', sessionId: 's3', result: 'correct', confidence: 'none', hintUsed: false, reason: null, answeredAt: realNow + 2 * DAY },
      { id: 'a4', questionId: 'inf-d1', questionVersion: 1, skillId: 'inf-noun', format: 'fill', attemptType: 'diagnostic', sessionId: 's1', result: 'correct', confidence: 'none', hintUsed: false, reason: null, answeredAt: realNow - 2 * DAY + 1 },
    ],
    schedule: { 'inf-noun': { skillId: 'inf-noun', step: 1, dueAt: realNow + 5 * DAY } }, units: { infinitive: { diagnosticDoneAt: realNow - 2 * DAY } },
    activeSession: null, sessions: [],
  };
  const raw = JSON.stringify(v1);
  EA.__store.set(EA.storage.KEYS.normal, raw);
  const r = EA.storage.load();
  assert.equal(r.status, 'migrated');
  assert.equal(r.state.attempts.length, 4, '記録を削除しない');
  assert.equal(r.state.settings.dailyGoalMinutes, 15);
  assert.equal('devDayOffset' in r.state.settings, false);
  assert.equal(r.state.attempts.find((a) => a.id === 'a3').devDated, true);
  assert.equal(r.state.attempts.find((a) => a.id === 'a2').afterExplanation, true);
  assert.equal(r.state.attempts.find((a) => a.id === 'a2').translationShown, true, 'v2までの並び替えは日本語つき');
  assert.equal(r.state.schemaVersion, 3);
  assert.equal(EA.__store.get(EA.storage.KEYS.backupPrefix + 'schema1-normal'), raw, '元のデータの控え');
  const st = EA.mastery.analyze('inf-noun', r.state.attempts, EA.banks.infinitive);
  assert.equal(st.attemptCount, 2, '開発用の日付の記録と、手がかりのあった旧版の空所補充を判定から除外');
  assert.ok(EA.mastery.isExcluded(r.state.attempts.find((a) => a.id === 'a4'), EA.banks.infinitive), '旧版の空所補充（正答だけが to で始まる）は判定に使わない');
  assert.equal(st.meaning, 'unchecked', '版1の理由（答えがわかる質問）は判定に使わない');
});

test('壊れた保存データは控えを作ってから始める／控えも作れないときは上書きしない', () => {
  const EA = loadEA();
  EA.__store.set(EA.storage.KEYS.normal, '{壊れたデータ');
  const r = EA.storage.load();
  assert.equal(r.status, 'corrupt-backed-up');
  const keys = [...EA.__store.keys()].filter((k) => k.startsWith(EA.storage.KEYS.backupPrefix + 'unreadable-'));
  assert.equal(EA.__store.get(keys[0]), '{壊れたデータ');
  const store = new Map([['ea-study-v1', '{壊れたデータ']]);
  const EA2 = loadEA(undefined, { store, failWrites: true });
  const r2 = EA2.storage.load();
  assert.equal(r2.readOnly, true);
  assert.equal(store.get('ea-study-v1'), '{壊れたデータ', '元データはそのまま');
});

test('保存に失敗したら失敗として返す（成功のように扱わない）', () => {
  const EA = loadEA(undefined, { failWrites: true });
  assert.equal(EA.storage.save(EA.storage.defaultState('normal')), false);
});

test('12. 診断 → 解説 → 類題 → 後日の復習 が通しで進み、間隔は解説直後には延びず、後日の自力正解で延びる', () => {
  const c = setup();
  diagnose(c, { 'inf-d1': 'wrong' });
  assert.equal(c.EA.planner.homeTask(c.state, c.bank, c.t().app).kind, 'practice');
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  runToEnd(c, () => ({}));
  assert.equal(c.state.schedule['inf-noun'].step, 0);
  assert.equal(c.EA.planner.homeTask(c.state, c.bank, c.t().app).kind, 'done');
  c.setDay(1);
  assert.equal(c.EA.planner.homeTask(c.state, c.bank, c.t().app).kind, 'review');
  c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
  runToEnd(c, () => ({}));
  assert.equal(c.state.schedule['inf-noun'].step, 1);
  assert.equal(c.EA.mastery.analyze('inf-noun', c.state.attempts, c.bank).needsRecheck, false);
});
