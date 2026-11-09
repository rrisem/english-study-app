// 問題画面の操作：二重確定・二重送信・早すぎる「次へ」を、学習記録の側で防ぐ
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, draftFor } from './helpers.mjs';

test('回答の二重確定は記録しない（2回目は null）', () => {
  const c = setup();
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  c.EA.session.ensureCurrent(c.state, c.bank, c.t());
  c.state.activeSession.current.draft = draftFor(c.q('inf-d1'), 'correct');
  const r1 = c.EA.session.submit(c.state, c.bank, false, c.t());
  assert.ok(r1 && r1.attempt);
  // 診断は自動で次の問題へ。次の問題は未回答・未選択の状態で始まる
  const cur = c.EA.session.ensureCurrent(c.state, c.bank, c.t());
  assert.equal(cur.draft, null);
  assert.equal(cur.attemptId, null);
  // 次の問題で、選択していないのに確定が届いても記録しない（UI ではボタンが無効）
  const n = c.state.attempts.length;
  c.state.activeSession.current.phase = 'feedback'; // 正誤表示中に確定が届いた場合
  assert.equal(c.EA.session.submit(c.state, c.bank, false, c.t()), null);
  assert.equal(c.state.attempts.length, n);
});

test('正誤表示中の二重確定・理由の二重送信・「次へ」の連打を記録・進行に反映しない', () => {
  const c = setup();
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  while (c.state.activeSession) c.answer('correct');
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  const it = c.current();
  const cur = c.EA.session.ensureCurrent(c.state, c.bank, c.t());
  cur.draft = draftFor(c.q(it.questionId), 'correct');
  const n = c.state.attempts.length;
  const r1 = c.EA.session.submit(c.state, c.bank, false, c.t());
  assert.ok(r1);
  assert.equal(c.EA.session.submit(c.state, c.bank, false, c.t()), null, '2回目の確定');
  assert.equal(c.state.attempts.length, n + 1, '記録は1件だけ');
  const s = c.state.activeSession;
  if (s.current.phase === 'reason') {
    assert.equal(c.EA.session.next(c.state, c.bank, c.t()), false, '理由に答える前は次へ進めない');
    const q = c.q(it.questionId);
    assert.ok(c.EA.session.submitReason(c.state, c.bank, q.reason.answer));
    assert.equal(c.EA.session.submitReason(c.state, c.bank, q.reason.answer), null, '理由の二重送信');
  }
  const idx = s.index;
  assert.notEqual(c.EA.session.next(c.state, c.bank, c.t()), false);
  assert.equal(c.state.activeSession.index, idx + 1);
  // 新しい問題では、まだ答えていないので「次へ」の連打は無視される
  const nextIt = c.current();
  if (nextIt && nextIt.kind === 'question') {
    c.EA.session.ensureCurrent(c.state, c.bank, c.t());
    assert.equal(c.EA.session.next(c.state, c.bank, c.t()), false, '回答前の「次へ」は無視');
    assert.equal(c.state.activeSession.index, idx + 1);
  }
});
