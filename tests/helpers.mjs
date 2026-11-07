// テスト用の小さな道具：学習回を Node の中で進める
import { loadEA } from '../tools/load.mjs';
export const DAY = 864e5;
export const T0 = new Date(2026, 10, 7, 16, 0).getTime();

export function setup(opts) {
  const EA = loadEA(undefined, opts);
  const bank = EA.banks.infinitive;
  const state = EA.storage.defaultState('normal');
  let app = T0;
  const t = () => ({ app, real: app });
  const ctx = {
    EA, bank, state,
    q: (id) => EA.findQuestion(bank, id),
    setDay: (d) => { app = T0 + d * DAY; },
    advanceMs: (ms) => { app += ms; },
    t,
    current: () => state.activeSession && state.activeSession.items[state.activeSession.index],
    start(session) { return EA.session.start(state, bank, session, t()); },
    /** いまの問題に答える。how: correct | wrong | giveup | unmatched。opts: unsure, hint, reason(true/false) */
    answer(how = 'correct', opts = {}) {
      const s = state.activeSession;
      const item = ctx.current();
      if (item.kind === 'explain') { const r = EA.session.next(state, bank, t()); return { explain: true, finished: r }; }
      const cur = EA.session.ensureCurrent(state, bank, t());
      const q = ctx.q(item.questionId);
      if (opts.unsure) cur.unsure = true;
      if (opts.hint) cur.hintUsed = true;
      app += 30000;
      if (how === 'giveup') return finishItem(EA.session.submit(state, bank, true, t()));
      cur.draft = draftFor(q, how);
      const res = EA.session.submit(state, bank, false, t());
      return finishItem(res);
      function finishItem(res) {
        const a = res.attempt;
        if (res.finished !== undefined && res.finished !== null) return { attempt: a, finished: res.finished };
        if (!state.activeSession) return { attempt: a, finished: null };
        if (state.activeSession.current && state.activeSession.current.phase === 'reason') {
          const want = opts.reason === false ? q.reason.choices.find((c) => c.id !== q.reason.answer).id : q.reason.answer;
          EA.session.submitReason(state, bank, want);
        }
        let finished = null;
        if (s.type !== 'diagnostic') finished = EA.session.next(state, bank, t());
        return { attempt: a, finished };
      }
    },
  };
  return ctx;
}

function splitAnswer(q) {
  let rest = q.answers[0]; const out = []; const used = new Set();
  while (rest.length) {
    let best = -1;
    q.tokens.forEach((tok, i) => { if (!used.has(i) && (rest.startsWith(tok + ' ') || rest === tok) && (best < 0 || tok.length > q.tokens[best].length)) best = i; });
    used.add(best); out.push(best); rest = rest.slice(q.tokens[best].length).trim();
  }
  return out;
}
export function draftFor(q, how) {
  if (q.format === 'fill' || q.format === 'meaning') {
    return how === 'correct' ? q.answer : q.choices.find((c) => c.id !== q.answer).id;
  }
  if (q.format === 'order') { const idx = splitAnswer(q); return how === 'correct' ? idx : idx.slice().reverse(); }
  if (how === 'correct') return q.accepted[0];
  if (how === 'unmatched') return 'I think so.';
  return q.errors[0].pattern.replace(/[\^$]/g, '').replace(/\((\w+)\|[^)]*\)/g, '$1').replace(/\([^)]*\)\??/g, '');
}
export const att = (EA, bank, o) => ({ id: Math.random().toString(36), questionVersion: EA.findQuestion(bank, o.questionId).version,
  skillId: EA.findQuestion(bank, o.questionId).skill, format: EA.findQuestion(bank, o.questionId).format, sessionId: 's-' + (o.day ?? 0),
  attemptType: 'diagnostic', result: 'correct', hintUsed: false, confidence: 'none', afterExplanation: false, reason: null,
  answeredAt: T0 + (o.day ?? 0) * DAY + (o.ms ?? 0), ...o });
