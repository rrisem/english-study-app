/*
 * logic.test.cjs — 学習の進行・保存・意味の問いのロジックの確認（画面は使わない）
 * 実行：node tests/logic.test.cjs
 */
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const FILES = ['js/core.js', 'data/config.js', 'data/infinitive.js', 'data/structure-trial.js', 'js/grading.js', 'js/mastery.js',
  'js/scheduler.js', 'js/storage.js', 'js/planner.js', 'js/session.js'];

function load() {
  const store = {};
  const win = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } };
  win.globalThis = win; win.window = win;
  const ctx = vm.createContext(win);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return { EA: win.EA, store };
}
const clone = x => JSON.parse(JSON.stringify(x));
const same = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('ok  ' + name); } catch (e) { console.log('NG  ' + name + '\n    ' + e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } }

const DAY = 86400000;
const T0 = new Date('2026-11-10T09:00:00').getTime();
const t = (ms) => ({ app: ms, real: ms });

/* ---------- 問題データ：意味の問い ---------- */
test('意味の問い：対象の問題すべてが英文に即した3択になっている', () => {
  const { EA } = load(); const b = EA.banks.infinitive;
  const withReason = b.questions.filter(q => q.reason);
  assert.strictEqual(withReason.length, 9);
  withReason.forEach(q => {
    const r = q.reason;
    assert.ok(['fill', 'order'].includes(q.format), q.id + ' は空所補充か並び替え');
    assert.strictEqual(r.kind, 'meaning', q.id);
    assert.strictEqual(r.choices.length, 3, q.id);
    const ids = r.choices.map(c => c.id);
    assert.strictEqual(new Set(ids).size, 3, q.id + ' ID重複');
    assert.ok(ids.includes(r.answer), q.id + ' 正解IDが選択肢にある');
    assert.strictEqual(r.sentence.split(r.target).length - 1, 1, q.id + ' 太字の部分が英文に1回だけ');
    assert.ok(/^to /.test(r.target), q.id + ' to から始まるまとまり');
    ['目的', '理由', 'すること', 'ための', '説明する'].forEach(w => assert.ok(!r.prompt.includes(w), q.id + ' 質問文に「' + w + '」を含めない'));
    r.choices.filter(c => c.id !== r.answer).forEach(c => assert.ok(c.feedback, q.id + ' 誤答に説明'));
    // 長さだけで推測できない：正解が、ただ1つの最短・最長ではない
    const len = r.choices.map(c => [...c.text].length), ans = [...r.choices.find(c => c.id === r.answer).text].length;
    const uniqMin = ans === Math.min(...len) && len.filter(x => x === ans).length === 1;
    const uniqMax = ans === Math.max(...len) && len.filter(x => x === ans).length === 1;
    assert.ok(!uniqMin && !uniqMax, q.id + ' 正解だけが最短・最長になっていない ' + len.join(','));
    assert.ok(q.reasonValidFrom === q.version, q.id + ' reasonValidFrom を新しい版に');
    assert.ok(r.link && r.link.head && r.link.text, q.id + ' 回答後の説明');
  });
  // 正解の位置（データ上のID）が偏っていない
  const pos = withReason.map(q => q.reason.answer);
  assert.ok(new Set(pos).size === 3, '正解IDが a/b/c に分かれている');
});

/* ---------- 学習の進行 ---------- */
function setup() {
  const L = load(); const { EA } = L; const bank = EA.banks.infinitive;
  const state = EA.storage.defaultState('normal');
  return Object.assign(L, { bank, state });
}
// 類題で意味の問いが出る問題を1問だけの学習回にする
function reasonSession(EA, bank, state, qid, at) {
  const s = EA.planner.buildPracticeSession(state, bank, at);
  s.items = [{ kind: 'question', questionId: qid, attemptType: 'similar' }, { kind: 'question', questionId: 'inf-p-n2', attemptType: 'similar' }];
  EA.session.start(state, bank, s, t(at));
  return s;
}
function reload(EA, state) { const st = clone(state); EA.session.recover(st); return st; }

test('回答入力中に離れる → 開き直しても同じ問題・入力・選択・ヒント・自信が残る／離れた時間は数えない', () => {
  const { EA, bank, state } = setup(); const S = EA.session;
  reasonSession(EA, bank, state, 'inf-p-v3', T0);
  let cur = S.ensureCurrent(state, bank, t(T0));
  cur.draft = [0, 1, 2, 3]; cur.hintUsed = false; cur.unsure = true;
  S.touch(state, T0 + 20000);
  S.suspend(state, T0 + 30000);           // 30秒で保存してホームへ
  assert.strictEqual(state.sessions.length, 0, '学習回は完了扱いにしない');
  same(state.schedule, {}, '復習予定は変えない');
  const st = reload(EA, state);
  const later = T0 + 2 * DAY;            // 2日後に再開
  cur = S.ensureCurrent(st, bank, t(later));
  assert.strictEqual(cur.phase, 'answer'); same(cur.draft, [0, 1, 2, 3]); assert.strictEqual(cur.unsure, true);
  assert.strictEqual(cur.activeMs, 30000, '離れる前の30秒だけ');
  cur.draft = [0, 1, 2, 3, 4, 5, 6];
  const res = S.submit(st, bank, false, t(later + 10000));
  assert.strictEqual(res.attempt.activeMs, 40000, '離れていた2日は数えない');
});

test('計時中のまま閉じた（pagehide なし）→ 最後に保存した時刻までだけ数える', () => {
  const { EA, bank, state } = setup(); const S = EA.session;
  reasonSession(EA, bank, state, 'inf-p-v3', T0);
  S.ensureCurrent(state, bank, t(T0));
  S.touch(state, T0 + 15000);
  const st = reload(EA, state);          // 3時間後に開き直した想定
  const cur = S.ensureCurrent(st, bank, t(T0 + 3 * 3600000));
  assert.strictEqual(cur.activeMs, 15000);
});

test('意味の問いの回答前に離れる → 再開で同じ問い。答えるまで確認済みにしない。完了時に復習予定を1回だけ更新', () => {
  const { EA, bank, state } = setup(); const S = EA.session, M = EA.mastery;
  reasonSession(EA, bank, state, 'inf-p-v1', T0);
  let cur = S.ensureCurrent(state, bank, t(T0));
  cur.draft = 'b';
  const r = S.submit(state, bank, false, t(T0 + 5000));
  assert.strictEqual(r.attempt.result, 'correct');
  assert.strictEqual(state.activeSession.current.phase, 'reason');
  assert.strictEqual(r.attempt.reasonPending, true);
  assert.strictEqual(M.analyze('inf-adv', state.attempts, bank).achievement, 0, '意味の問いの前は実績に数えない');
  state.activeSession.current.reasonDraft = 'b';
  S.suspend(state, T0 + 6000);
  const st = reload(EA, state);
  cur = S.ensureCurrent(st, bank, t(T0 + DAY));
  assert.strictEqual(cur.phase, 'reason'); assert.strictEqual(cur.reasonDraft, 'b', '選択状態が残る');
  assert.strictEqual(st.attempts.length, 1, '回答を二重に記録しない');
  assert.strictEqual(S.submit(st, bank, false, t(T0 + DAY)), null, '確定済みの回答は再確定できない');
  const a = S.submitReason(st, bank, 'b');
  assert.strictEqual(a.reason.correct, true); assert.strictEqual(a.reason.reasonVersion, 4); assert.ok(!a.reasonPending);
  assert.strictEqual(a.reason.choiceText, 'トムが早く起きた目的');
  assert.strictEqual(M.analyze('inf-adv', st.attempts, bank).meaning, 'confirmed');
  // 解説表示中に離れる → 再開で解説表示のまま
  S.suspend(st, T0 + DAY + 1000);
  const st2 = reload(EA, st);
  assert.strictEqual(S.ensureCurrent(st2, bank, t(T0 + DAY + 5000)).phase, 'feedback');
  same(st2.schedule, {});
  // 最後まで進む
  assert.strictEqual(S.next(st2, bank, t(T0 + DAY + 6000)), null);
  const c2 = S.ensureCurrent(st2, bank, t(T0 + DAY + 6000));
  c2.draft = st2.activeSession.current.choiceOrder ? 'b' : 'b';
  S.submit(st2, bank, false, t(T0 + DAY + 9000));
  const rec = S.next(st2, bank, t(T0 + DAY + 9500));
  assert.ok(rec && rec.id, '最後で学習回を終える');
  assert.strictEqual(st2.sessions.length, 1);
  const hist = st2.schedule['inf-adv'].history.length;
  assert.strictEqual(S.next(st2, bank, t(T0 + DAY + 9600)), false, '二度目は何もしない');
  assert.strictEqual(st2.schedule['inf-adv'].history.length, hist, '復習予定の更新は1回だけ');
});

test('意味の問い：表示順ではなく選択肢IDで判定。今の版にないIDは受け付けない', () => {
  const { EA, bank, state } = setup(); const S = EA.session;
  reasonSession(EA, bank, state, 'inf-p-a1', T0);
  const cur = S.ensureCurrent(state, bank, t(T0));
  cur.draft = 'b';
  S.submit(state, bank, false, t(T0 + 1000));
  assert.strictEqual(state.activeSession.current.phase, 'reason');
  state.activeSession.current.reasonOrder = ['b', 'c', 'a'];   // 正解 b が先頭に表示されていても
  assert.strictEqual(S.submitReason(state, bank, 'inf-adj'), null, '旧版のIDは不可');
  const a = S.submitReason(state, bank, 'a');                 // 表示1番目ではなく ID で判定
  assert.strictEqual(a.reason.correct, false);
  assert.ok(a.followUp, '意味の問いが違ったら確認問題');
});

/* ---------- 変更前のデータ ---------- */
test('変更前の中断データ（旧版の意味の問いの回答前）→ 新しい選択肢で再開でき、IDが混ざらない', () => {
  const { EA, bank, state } = setup(); const S = EA.session, M = EA.mastery;
  reasonSession(EA, bank, state, 'inf-p-n1', T0);
  const cur = S.ensureCurrent(state, bank, t(T0));
  cur.draft = 'd';
  const r = S.submit(state, bank, false, t(T0 + 1000));
  // 変更前の形にする：旧版・共通3択の並び・未回答の印なし
  delete r.attempt.reasonPending; r.attempt.questionVersion = 3;
  state.activeSession.current.reasonOrder = ['inf-adv', 'inf-noun', 'inf-adj'];
  const st = reload(EA, state);
  assert.strictEqual(st.attempts[0].reasonPending, true, '再開時に未回答の印をつける');
  const c = S.ensureCurrent(st, bank, t(T0 + DAY));
  same(c.reasonOrder.slice().sort(), ['a', 'b', 'c']);
  const a = S.submitReason(st, bank, 'a');
  assert.strictEqual(a.reason.correct, true);
  assert.strictEqual(M.reasonResult(a, bank), true, '新しい設問への回答は新版の証拠');
});

test('変更前の履歴：旧版の意味の問いは判定に使わず、主問題の正誤は残す。保存データを読み込める', () => {
  const { EA, bank, store } = setup(); const M = EA.mastery;
  const old = EA.storage.defaultState('normal');
  old.attempts.push({ id: 'a-old', questionId: 'inf-p-a1', questionVersion: 3, unitId: 'infinitive', skillId: 'inf-adj', format: 'fill',
    attemptType: 'similar', sessionId: 's-old', sessionType: 'practice', response: 'b', responseText: 'to do', result: 'correct',
    confidence: 'none', hintUsed: false, gaveUp: false, afterExplanation: false, translationShown: false,
    reason: { asked: true, kind: 'role', choiceId: 'inf-noun', correct: false, independent: true }, answeredAt: T0 - 5 * DAY, activeMs: 9000 });
  old.activeSession = null;
  store['ea-study-v1'] = JSON.stringify(old);
  const L = EA.storage.load();
  assert.strictEqual(L.status, 'ok');
  const a = L.state.attempts[0];
  assert.strictEqual(M.reasonResult(a, bank), null, '旧版の意味の問いは判定に使わない');
  const st = M.analyze('inf-adj', L.state.attempts, bank);
  assert.strictEqual(st.issues.filter(i => i.type === 'meaning').length, 0, '旧版の誤りで再確認にしない');
  assert.strictEqual(st.achievement, 1, '主問題の自力正解は残る');
  assert.ok(!M.isExcluded(a, bank), '回答そのものは除外しない');
  assert.strictEqual(M.sawTranslation(Object.assign({}, a, { translationShown: undefined }), bank), false, '版3以降は訳なしで出題');
});

console.log('\n' + passed + ' 件 ok');
