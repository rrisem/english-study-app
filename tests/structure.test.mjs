// 英文構造の段階解説：データから作る段階の中身・記録の扱い・既存の判定への影響
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';

const roles = (m) => m.segments.filter((s) => s.role).map((s) => s.role + ':' + s.text);

test('段階1：主語の中心 The book と、文の動詞 is だけを示す', () => {
  const c = setup();
  const st = c.EA.findQuestion(c.EA.banks['structure-trial'], 'st-1').structure;
  const m = c.EA.structure.stepModel(st, 0);
  assert.deepEqual([...roles(m)], ['subject:The book', 'verb:is']);
  assert.equal(m.segments.map((s) => s.text).join(' '), st.sentence, '英文は欠けずにそのまま');
  assert.match(m.text, /bought も動詞ですが.*文全体の動詞ではありません/);
});

test('段階2：that I bought yesterday をひとまとまりにし、すぐ前の book を説明すると示す', () => {
  const c = setup();
  const st = c.EA.findQuestion(c.EA.banks['structure-trial'], 'st-1').structure;
  const m = c.EA.structure.stepModel(st, 1);
  assert.deepEqual([...roles(m)], ['subject:The book', 'modifier:that I bought yesterday', 'verb:is']);
  const i = m.segments.findIndex((s) => s.role === 'modifier');
  assert.equal(m.segments[i - 1].text, 'The book', '説明のまとまりは book の直後');
  assert.match(m.segments[i].label, /book を説明/);
  assert.equal(m.segments[i].isNew, true);
  assert.equal(m.segments.find((s) => s.role === 'subject').isNew, false, '前の段階からの強調は「新しい」扱いにしない');
});

test('段階3：説明のまとまりをはずした骨格 The book is interesting. を示す', () => {
  const c = setup();
  const st = c.EA.findQuestion(c.EA.banks['structure-trial'], 'st-1').structure;
  const m = c.EA.structure.stepModel(st, 2);
  assert.equal(m.skeleton.map((p) => p.text).join(' '), 'The book is interesting.');
  assert.ok(m.segments.some((s) => s.role === 'omit' && s.text === 'that I bought yesterday'));
  assert.equal(st.translation, '私が昨日買った本はおもしろい。');
  assert.equal(m.total, 3);
});

test('データの誤り（英文にない語句・重なり・ラベルなし）を見つける', () => {
  const c = setup();
  const bad = { sentence: 'The book is red.', steps: [{ title: 't', text: 'x', marks: [
    { text: 'The pen', role: 'subject', label: 'a' }, { text: 'book is', role: 'verb', label: 'b' }, { text: 'is', role: 'verb', label: '' }] }] };
  const p = c.EA.structure.validate(bad).join('\n');
  assert.match(p, /The pen」が英文にありません/);
  assert.match(p, /重なっています/);
  assert.match(p, /ラベルがありません/);
});

test('構造の解説を開いた・最後まで見た記録は、答えの正誤や確認状況・復習予定を変えない', () => {
  const c = setup();
  const B = c.EA.banks['structure-trial'];
  const scheduleBefore = JSON.stringify(c.state.schedule);
  c.start(c.EA.planner.buildTrialSession(B, c.t().app));
  const cur = c.EA.session.ensureCurrent(c.state, B, c.t());
  cur.draft = 'b'; // 誤答
  const r = c.EA.session.submit(c.state, B, false, c.t());
  const a = r.attempt;
  assert.equal(a.result, 'incorrect');
  const before = c.EA.mastery.analyze('structure-svo', c.state.attempts, B);
  c.EA.structure.recordView(a, 'open', 0, 3, c.t().app);
  c.EA.structure.recordView(a, 'step', 1, 3, c.t().app);
  c.EA.structure.recordView(a, 'step', 2, 3, c.t().app);
  c.EA.structure.recordView(a, 'translation', null, 3, c.t().app);
  assert.deepEqual({ ...a.structureView, firstOpenedAt: 0, lastViewedAt: 0 },
    { firstOpenedAt: 0, lastViewedAt: 0, openCount: 1, maxStepSeen: 3, totalSteps: 3, completed: true, translationOpened: true });
  assert.equal(a.result, 'incorrect', '最後まで見ても正解にはならない');
  const after = c.EA.mastery.analyze('structure-svo', c.state.attempts, B);
  assert.deepEqual({ ...after, evidence: [] }, { ...before, evidence: [] }, '確認状況は変わらない');
  const rec = c.EA.session.next(c.state, B, c.t());
  assert.ok(rec && rec.type === 'trial');
  assert.equal(JSON.stringify(c.state.schedule), scheduleBefore, '試作は復習予定に入れない');
  for (const sk of c.bank.skills) assert.equal(c.EA.mastery.analyze(sk.id, c.state.attempts, c.bank).attemptCount, 0, '不定詞の確認状況にも入らない');
});
