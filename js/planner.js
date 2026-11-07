/*
 * planner.js — 「次に何をするか」と出題する問題を決める（ルールのみ）
 *
 * 将来 AI に「回答に応じた問題選び」を任せる場合は、この中の
 * buildPracticeSession / buildReviewSession / pickReviewQuestions を差し替えます。
 * 画面側（app.js）はここが返す items の並びをそのまま出題するだけです。
 * ※ 現在はすべて事前に決めたルールで動いており、AI は接続していません。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var G = EA.grading;

  function activeQuestions(bank) {
    return bank.questions.filter(function (q) { return q.status !== 'excluded'; });
  }

  function newSession(type, unitId, items, now, extra) {
    var s = {
      id: EA.util.uid('s'),
      type: type,
      unitId: unitId,
      items: items,
      index: 0,
      startedAt: now,
      attemptIds: [],
      current: null
    };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }

  function unitState(state, unitId) {
    return state.units[unitId] = state.units[unitId] || {};
  }

  /** 初回診断：role が diagnostic の問題を、問題集に書いた順に出す */
  function buildDiagnosticSession(bank, now) {
    var items = activeQuestions(bank)
      .filter(function (q) { return q.role === 'diagnostic'; })
      .map(function (q) { return { kind: 'question', questionId: q.id, attemptType: 'diagnostic' }; });
    return newSession('diagnostic', bank.unit.id, items, now);
  }

  /** 解説を見るべき回答か（誤り・判定保留・別表現・ヒント・自信がない・小さな直し） */
  function needsFollowUp(a) {
    return !EA.mastery.isSolid(a) || a.result === 'minor';
  }

  /**
   * 診断のあとの「解説 → 解き直し → 類題」
   * ・解説は、気になる回答があった問題ごとに表示
   * ・解き直し（同じ問題）は、正解できなかった問題だけ
   * ・類題（別の問題）は、気になる回答があった問題ごとに1問。同じ類題は二度使わない
   * ・全問を自力で正解した場合は、各単元から1問ずつの「確認問題」（任意）
   */
  function buildPracticeSession(state, bank, now) {
    var u = unitState(state, bank.unit.id);
    var diagAttempts = state.attempts.filter(function (a) { return a.sessionId === u.diagnosticSessionId; });
    var used = {};
    diagAttempts.forEach(function (a) { used[a.questionId] = true; });
    var items = [];

    function pickSimilar(q) {
      var cands = (q.similar || []).map(function (id) { return EA.findQuestion(bank, id); })
        .concat(activeQuestions(bank).filter(function (x) { return x.role === 'practice' && x.skill === q.skill; }));
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (c && c.status !== 'excluded' && c.skill === q.skill && !used[c.id]) { used[c.id] = true; return c; }
      }
      return null;
    }

    var flagged = diagAttempts.filter(function (a) {
      return needsFollowUp(a) && !EA.mastery.isExcluded(a, bank);
    });
    flagged.forEach(function (a) {
      var q = EA.findQuestion(bank, a.questionId);
      items.push({ kind: 'explain', questionId: q.id, sourceAttemptId: a.id });
      if (!G.isSkillCorrect(a.result)) items.push({ kind: 'question', questionId: q.id, attemptType: 'retry' });
      var s = pickSimilar(q);
      if (s) items.push({ kind: 'question', questionId: s.id, attemptType: 'similar' });
    });

    var optional = false;
    if (flagged.length === 0) {
      optional = true;
      bank.skills.forEach(function (sk) {
        var q = activeQuestions(bank).filter(function (x) { return x.role === 'practice' && x.skill === sk.id && !used[x.id]; })[0];
        if (q) { used[q.id] = true; items.push({ kind: 'question', questionId: q.id, attemptType: 'similar' }); }
      });
    }
    return newSession('practice', bank.unit.id, items, now, { optional: optional });
  }

  /** 復習で出す問題を選ぶ：別の問題（しばらく見ていないもの）と、前に間違えた問題を組み合わせる */
  function pickReviewQuestions(state, bank, skillId, count) {
    var qs = activeQuestions(bank).filter(function (q) { return q.skill === skillId; });
    var info = {};
    qs.forEach(function (q) { info[q.id] = { q: q, lastSeen: -Infinity, lastWrong: false }; });
    state.attempts.forEach(function (a) {
      var i = info[a.questionId];
      if (!i || a.answeredAt < i.lastSeen) return;
      i.lastSeen = a.answeredAt;
      i.lastWrong = !G.isSkillCorrect(a.result);
    });
    var list = Object.keys(info).map(function (k) { return info[k]; });
    var byOldest = list.slice().sort(function (a, b) { return a.lastSeen - b.lastSeen; });
    var picks = [];
    if (byOldest[0]) picks.push(byOldest[0].q); // しばらく見ていない（または未出題の）別の問題
    var wrongOnes = list.filter(function (x) { return x.lastWrong && picks.indexOf(x.q) < 0; })
      .sort(function (a, b) { return b.lastSeen - a.lastSeen; });
    if (picks.length < count && wrongOnes[0]) picks.push(wrongOnes[0].q); // 前に間違えた問題
    for (var i = 1; picks.length < count && i < byOldest.length; i++) {
      if (picks.indexOf(byOldest[i].q) < 0) picks.push(byOldest[i].q);
    }
    return picks;
  }

  /** 復習：期限が来た skill を、確認状況の低いもの→期限の古いものの順に、上限数まで */
  function buildReviewSession(state, bank, now) {
    var cfg = EA.config;
    var due = dueReviews(state, bank, now);
    var take = due.slice(0, cfg.maxReviewSkillsPerSession);
    var items = [];
    take.forEach(function (e) {
      pickReviewQuestions(state, bank, e.skillId, cfg.questionsPerReviewSkill).forEach(function (q) {
        items.push({ kind: 'question', questionId: q.id, attemptType: 'review', forSkill: e.skillId });
      });
    });
    return newSession('review', bank.unit.id, items, now, {
      reviewSkills: take.map(function (e) { return e.skillId; }),
      deferredSkills: due.slice(take.length).map(function (e) { return e.skillId; })
    });
  }

  function dueReviews(state, bank, now) {
    var schedule = {};
    bank.skills.forEach(function (sk) { if (state.schedule[sk.id]) schedule[sk.id] = state.schedule[sk.id]; });
    return EA.scheduler.dueSkills(schedule, now, function (e) {
      return EA.mastery.computeSkillStatus(e.skillId, state.attempts, bank).level;
    });
  }

  function nextReviewDate(state, bank) {
    var min = null;
    bank.skills.forEach(function (sk) {
      var e = state.schedule[sk.id];
      if (e && (min === null || e.dueAt < min)) min = e.dueAt;
    });
    return min;
  }

  /**
   * ホームに出す「次の課題」
   * 優先順：途中の学習の再開 → 初回診断 → 解説と類題 → 復習 → （今日は完了）
   */
  function homeTask(state, bank, now) {
    var u = unitState(state, bank.unit.id);
    var s = state.activeSession;
    if (s) {
      var label = { diagnostic: '初回診断', practice: '解説と類題', review: '復習' }[s.type];
      return {
        kind: 'resume', title: label + 'の続き',
        detail: (s.index + 1) + ' / ' + s.items.length + ' から再開します',
        why: '前回、途中で終了しました。答えた問題の記録は保存されています。',
        cta: '続きから再開'
      };
    }
    if (!u.diagnosticDoneAt) {
      return {
        kind: 'diagnostic', title: '不定詞の初回診断',
        detail: '6問・目安10分。結果と解説は全問に答えたあとに出ます。',
        why: 'まず今の状態を確かめて、そのあとの課題を決めます。',
        cta: '診断をはじめる'
      };
    }
    if (!u.practiceDoneAt && !u.practiceSkippedAt) {
      var anyFlag = state.attempts.some(function (a) { return a.sessionId === u.diagnosticSessionId && needsFollowUp(a); });
      return {
        kind: 'practice', title: anyFlag ? '診断の解説と類題' : '別の問題で確認（任意）',
        detail: anyFlag ? '間違えた問題・自信がなかった問題の解説を読み、別の問題で確かめます。'
          : '診断は全問自力で正解でした。別の問題でも解けるか、3問で確かめます。',
        why: '解説を読むだけで終わらせず、答えを見ずにもう一度解きます。',
        cta: '解説と類題へ'
      };
    }
    var due = dueReviews(state, bank, now);
    if (due.length) {
      var take = Math.min(due.length, EA.config.maxReviewSkillsPerSession);
      var names = due.slice(0, take).map(function (e) { return '「' + EA.findSkill(bank, e.skillId).label + '」'; }).join('');
      return {
        kind: 'review', title: '今日の復習',
        detail: names + ' ／ ' + (take * EA.config.questionsPerReviewSkill) + '問ほど',
        why: '復習予定日になりました。答えを見ずに思い出せるか確かめます。' +
          (due.length > take ? '（ほかに' + (due.length - take) + '件。一度に増やしすぎないよう、次回にまわします）' : ''),
        cta: '復習をはじめる', dueCount: due.length
      };
    }
    var next = nextReviewDate(state, bank);
    return {
      kind: 'done', title: '今日の課題は完了です',
      detail: next ? '次の復習は ' + EA.util.fmtDate(next) + '（' + EA.util.relDay(next, now) + '）' : '',
      why: '履歴から、これまでの解説や回答を見返すことができます。',
      cta: null
    };
  }

  EA.planner = {
    buildDiagnosticSession: buildDiagnosticSession,
    buildPracticeSession: buildPracticeSession,
    buildReviewSession: buildReviewSession,
    pickReviewQuestions: pickReviewQuestions,
    dueReviews: dueReviews,
    nextReviewDate: nextReviewDate,
    needsFollowUp: needsFollowUp,
    homeTask: homeTask,
    unitState: unitState
  };
})(typeof window !== 'undefined' ? window : globalThis);
