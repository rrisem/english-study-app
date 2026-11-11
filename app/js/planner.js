/*
 * planner.js — 「次に何をするか」と出題する問題を決める（ルールのみ・表示とは独立）
 *
 * 将来 AI に「回答に応じた問題選び」を任せる場合は、この中の
 * buildPracticeSession / buildReviewSession / pickReviewQuestions / pickFollowUp を差し替えます。
 * ※ 現在はすべて事前に決めたルールで動いており、AI は接続していません。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var G = EA.grading;

  function activeQuestions(bank) {
    return bank.questions.filter(function (q) { return q.status !== 'excluded'; });
  }

  /** 日本語訳を見せずに出題する問題か（訳なしで意味を確かめられる） */
  function isEnglishOnly(q) {
    return q.format === 'meaning' || (q.format === 'fill' && q.showJa === 'after');
  }

  function newSession(type, unitId, items, now, extra) {
    var s = {
      id: EA.util.uid('s'), type: type, unitId: unitId, items: items, index: 0, startedAt: now,
      attemptIds: [], current: null,
      explained: {},    // この学習回で解説を見た skill（このあとの回答は「解説後」として記録）
      followUps: 0,     // 追加した確認問題の数
      unresolved: []    // この学習回で解決できず、次回へ引き継ぐ内容
    };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }

  function unitState(state, unitId) {
    return state.units[unitId] = state.units[unitId] || {};
  }

  /**
   * 問題ごとの「次の復習で優先して出す理由」（need）を、回答履歴から決める。
   *   その問題の回答を古い順に見て、「根拠にする回答」で need を更新する。
   *   根拠にしない回答（need を変えない）：
   *     ・判定から除外した回答（問題の不備・開発用の日付）
   *     ・採点保留・指定の形と違う答え（判別できないため、誤りにも正解にも数えない）
   *     ・解き直しの正解（答えを見た直後に同じ問題を解いたため）
   *     ・解説を見たあとの正解のうち、つまずいた日と同じ日のもの（直後の確認で、時間を空けて思い出せた根拠にならないため）
   *   need: recent-error（不正解・「わからない」）> hint-used（ヒントで正解）> meaning-mismatch（答えは正解・意味の問いが違った）
   *         > low-confidence（「自信がない」と申告して正解）。どれでもなければ null（優先しない）。
   *   自信度は 'unsure' だけを低い自信として扱う。'none'（申告なし）や、項目がない古い記録は低い自信とは扱わない。
   *   ※ これは「どの問題を出すか」の優先だけ。項目の確認状況・再確認の解消は mastery.js のルールのまま（別の問題での自力正解が必要）。
   */
  var NEED_RANK = { 'recent-error': 0, 'hint-used': 1, 'meaning-mismatch': 2, 'low-confidence': 3 };
  function needOf(a, bank, prev) {
    if (G.isSkillWrong(a.result)) return 'recent-error';
    if (!G.isSkillCorrect(a.result)) return undefined;              // 採点保留・指定の形と違う → 根拠にしない
    if (a.hintUsed) return 'hint-used';
    if (a.attemptType === 'retry') return undefined;                 // 解き直し → 根拠にしない
    if (a.afterExplanation) {
      // 別の問題の解説を見たあとの正解は、つまずいた日より後の日なら、その問題の優先を外す根拠にする
      if (!prev || !prev.need || EA.util.dayDiff(prev.needAt, a.answeredAt) < 1) return undefined;
      return a.confidence === 'unsure' ? 'low-confidence' : null;
    }
    var mc = EA.mastery.meaningCheck(a, bank);
    if (mc && !mc.ok) return 'meaning-mismatch';
    if (a.confidence === 'unsure') return 'low-confidence';
    return null;                                                      // 自力で正解 → 優先しない
  }

  /** 各問題を最後に解いた日時と、優先して出す理由 */
  function seenInfo(state, bank) {
    var info = {};
    activeQuestions(bank).forEach(function (q) { info[q.id] = { q: q, lastSeen: -Infinity, need: null, needAt: -Infinity, times: 0 }; });
    state.attempts.slice().sort(function (x, y) { return x.answeredAt - y.answeredAt; }).forEach(function (a) {
      var i = info[a.questionId];
      if (!i) return;
      i.times++;
      if (a.answeredAt >= i.lastSeen) i.lastSeen = a.answeredAt;
      if (EA.mastery.isExcluded(a, bank) || EA.mastery.isPending(a)) return;
      var n = needOf(a, bank, i);
      if (n === undefined) return;
      if (n !== i.need || n) i.needAt = a.answeredAt;
      i.need = n;
    });
    return info;
  }

  /** 初回診断：role が diagnostic の問題を、問題集に書いた順に出す */
  function buildDiagnosticSession(bank, now) {
    var items = activeQuestions(bank)
      .filter(function (q) { return q.role === 'diagnostic'; })
      .map(function (q) { return { kind: 'question', questionId: q.id, attemptType: 'diagnostic' }; });
    return newSession('diagnostic', bank.unit.id, items, now);
  }

  /** 試作の単元：問題を順に出すだけ（確認状況・復習予定には反映しない） */
  function buildTrialSession(bank, now) {
    var items = activeQuestions(bank).map(function (q) { return { kind: 'question', questionId: q.id, attemptType: 'trial' }; });
    return newSession('trial', bank.unit.id, items, now);
  }

  /** 解説を見るべき回答か（誤り・採点保留・指定の形と違う・ヒント・自信がない・小さな直し） */
  function needsFollowUp(a) {
    return !EA.mastery.isSolid(a) || a.result === 'minor';
  }

  /**
   * 診断のあとの「解説 → 解き直し → 類題」
   * ・解説：気になる回答があった問題ごと
   * ・解き直し（同じ問題）：正解できなかった問題だけ
   * ・類題（別の問題）：気になる回答があった問題ごとに1問。同じ類題は二度使わない
   * ・全問を自力で安定して正解した場合は、各項目1問ずつの確認問題（任意）
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

    var flagged = diagAttempts.filter(function (a) { return needsFollowUp(a) && !EA.mastery.isExcluded(a, bank); });
    var missing = [];
    flagged.forEach(function (a) {
      var q = EA.findQuestion(bank, a.questionId);
      items.push({ kind: 'explain', questionId: q.id, sourceAttemptId: a.id });
      if (!G.isSkillCorrect(a.result)) items.push({ kind: 'question', questionId: q.id, attemptType: 'retry' });
      var s = pickSimilar(q);
      if (s) items.push({ kind: 'question', questionId: s.id, attemptType: 'similar' });
      else missing.push({ skillId: q.skill, questionId: q.id, why: '別の類題が用意されていないため、次回の復習で確認します' });
    });

    var optional = false;
    if (flagged.length === 0) {
      optional = true;
      bank.skills.forEach(function (sk) {
        var q = activeQuestions(bank).filter(function (x) { return x.role === 'practice' && x.skill === sk.id && x.format !== 'meaning' && !used[x.id]; })[0];
        if (q) { used[q.id] = true; items.push({ kind: 'question', questionId: q.id, attemptType: 'similar' }); }
      });
    }
    return newSession('practice', bank.unit.id, items, now, { optional: optional, unresolved: missing });
  }

  /**
   * 類題・復習・確認問題で、間違えた（または意味・理由の問いが違った）ときに追加する確認問題を選ぶ。
   * ・同じ skill で、この学習回でまだ使っていない、別の問題
   * ・意味・理由の取り違えのときは、意味の確認問題を優先
   * ・それ以外は、意味の確認問題以外（答えを作る問題）を優先し、しばらく見ていない問題から
   * 見つからないときは null（「別の確認問題がない」として記録する）
   */
  function pickFollowUp(state, bank, session, attempt, trigger) {
    var usedInSession = {};
    session.items.forEach(function (it) { usedInSession[it.questionId] = true; });
    var info = seenInfo(state, bank);
    var cands = activeQuestions(bank).filter(function (q) {
      return q.skill === attempt.skillId && q.id !== attempt.questionId && !usedInSession[q.id];
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) {
      var pa = trigger === 'meaning' ? (a.format === 'meaning' ? 0 : 1) : (a.format === 'meaning' ? 1 : 0);
      var pb = trigger === 'meaning' ? (b.format === 'meaning' ? 0 : 1) : (b.format === 'meaning' ? 1 : 0);
      if (pa !== pb) return pa - pb;
      return info[a.id].lastSeen - info[b.id].lastSeen;
    });
    return cands[0];
  }

  /**
   * 復習で出す問題を選ぶ。戻り値 [{ q, why }]（why は回答の記録 pickWhy に残す）
   * 1問目（解説を見る前に答える＝判定の中心）：最近つまずいた問題「以外」で、しばらく見ていない問題（why: other-question）。
   *   同じ理解を別の問題で確かめるため。訳を見ずに意味を確かめた実績がない（または再確認が必要な）項目では、英文だけで出す問題を優先。
   * 2問目：回答履歴で優先する理由がある問題（誤答 → ヒントで正解 → 意味の問いが違った → 自信がない正解、同じ順位なら最近のもの）。
   *   why はその理由。なければ、しばらく見ていない問題（why: oldest）。
   * 項目に問題が1問しかないとき：その問題を出し、why: no-other-question（同じ問題の正解では再確認を解消しない）。
   */
  function reviewPicks(state, bank, skillId, count) {
    var st = EA.mastery.analyze(skillId, state.attempts, bank);
    var issueQ = {};
    st.issues.forEach(function (i) { issueQ[i.questionId] = true; });
    // 訳を見ずに意味を確かめた実績がない・再確認が必要なら、英文だけで出す問題（意味の確認・訳なしの空所補充）を優先
    var needMeaning = st.meaning !== 'confirmed';
    var info = seenInfo(state, bank);
    var list = Object.keys(info).map(function (k) { return info[k]; }).filter(function (x) { return x.q.skill === skillId; });
    if (!list.length) return [];
    if (list.length === 1) return [{ q: list[0].q, why: 'no-other-question' }];
    var byOldest = list.slice().sort(function (a, b) { return a.lastSeen - b.lastSeen; });
    var firstCands = byOldest.filter(function (x) { return !issueQ[x.q.id] && !x.need; });
    if (!firstCands.length) firstCands = byOldest.filter(function (x) { return !issueQ[x.q.id]; });
    if (needMeaning) {
      var m = firstCands.filter(function (x) { return isEnglishOnly(x.q); });
      if (m.length) firstCands = m;
    }
    var picks = [];
    function has(q) { return picks.some(function (p) { return p.q === q; }); }
    if (firstCands[0]) picks.push({ q: firstCands[0].q, why: 'other-question' });
    else picks.push({ q: byOldest[0].q, why: 'oldest' });
    var needed = list.filter(function (x) { return x.need && !has(x.q); })
      .sort(function (a, b) { return (NEED_RANK[a.need] - NEED_RANK[b.need]) || (b.needAt - a.needAt); });
    for (var j = 0; picks.length < count && j < needed.length; j++) picks.push({ q: needed[j].q, why: needed[j].need });
    for (var i = 0; picks.length < count && i < byOldest.length; i++) {
      if (!has(byOldest[i].q)) picks.push({ q: byOldest[i].q, why: 'oldest' });
    }
    return picks;
  }
  /** 互換用：問題だけの配列 */
  function pickReviewQuestions(state, bank, skillId, count) {
    return reviewPicks(state, bank, skillId, count).map(function (p) { return p.q; });
  }

  /** 復習：期限が来た skill を、再確認が必要なもの → 実績の低いもの → 期限の古いものの順に、上限数まで */
  function buildReviewSession(state, bank, now) {
    var cfg = EA.config;
    var due = dueReviews(state, bank, now);
    var take = due.slice(0, cfg.maxReviewSkillsPerSession);
    var items = [], unresolved = [];
    take.forEach(function (e) {
      reviewPicks(state, bank, e.skillId, cfg.questionsPerReviewSkill).forEach(function (p) {
        items.push({ kind: 'question', questionId: p.q.id, attemptType: 'review', forSkill: e.skillId, pickWhy: p.why });
        if (p.why === 'no-other-question') {
          unresolved.push({ skillId: e.skillId, questionId: p.q.id, trigger: 'no-other-question',
            why: 'この項目には別の問題がないため、同じ問題で確認しました。同じ問題の正解では再確認を解消しません（別の問題が追加されると確かめられます）。' });
        }
      });
    });
    return newSession('review', bank.unit.id, items, now, {
      unresolved: unresolved,
      reviewSkills: take.map(function (e) { return e.skillId; }),
      deferredSkills: due.slice(take.length).map(function (e) { return e.skillId; })
    });
  }

  function priorityOf(state, bank) {
    return function (e) {
      var st = EA.mastery.analyze(e.skillId, state.attempts, bank);
      // 再確認が必要 → 「自信がない」が残る → それ以外。同じ区分の中では実績の低い順（実績は 0〜3）
      return (st.needsRecheck ? 0 : st.unsure ? 5 : 10) + st.achievement;
    };
  }

  function dueReviews(state, bank, now) {
    var schedule = {};
    bank.skills.forEach(function (sk) { if (state.schedule[sk.id]) schedule[sk.id] = state.schedule[sk.id]; });
    return EA.scheduler.dueSkills(schedule, now, priorityOf(state, bank));
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
      var label = { diagnostic: '初回診断', practice: '解説と類題', review: '復習', trial: '試作：英文の構造' }[s.type];
      var cur = s.current && s.current.index === s.index ? s.current : null;
      var where = !cur ? '' : cur.phase === 'reason' ? '（意味の問いの回答前）' : cur.phase === 'feedback' ? '（解説の表示中）' : '（回答の途中）';
      // 期限を迎えた復習（いま再開する学習回がその復習なら、その項目は数えない）
      var inThis = s.type === 'review' ? (s.reviewSkills || []) : [];
      var dueWaiting = dueReviews(state, bank, now).filter(function (e) { return inThis.indexOf(e.skillId) < 0; }).length;
      return {
        kind: 'resume', title: label + 'の続き',
        detail: (Math.min(s.index + 1, s.items.length)) + ' / ' + s.items.length + ' ' + where + 'から再開します',
        why: '途中で保存してホームへ戻りました。答えた問題と、入力の途中の内容は残っています。',
        cta: '続きから再開',
        dueWaiting: dueWaiting
      };
    }
    if (!u.diagnosticDoneAt) {
      // ホームでは「何を・何分・どこを押す」だけを示す。説明は「初回診断とは？」を押したときだけ開く
      var n = activeQuestions(bank).filter(function (q) { return q.role === 'diagnostic'; }).length;
      return {
        kind: 'diagnostic', title: '不定詞の初回診断',
        detail: n + '問・約' + (bank.unit.diagnosticMinutes || 10) + '分', detailKind: 'size',
        why: '',
        help: { label: '初回診断とは？', text: '答えに応じて、次に取り組む問題が決まります。結果と解説は、全問に答えたあとに表示されます。' },
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
      var recheck = due.slice(0, take).filter(function (e) { return EA.mastery.analyze(e.skillId, state.attempts, bank).needsRecheck; }).length;
      return {
        kind: 'review', title: '今日の復習',
        detail: names + ' ／ ' + (take * EA.config.questionsPerReviewSkill) + '問ほど',
        why: (recheck ? '前回つまずいた内容を、別の問題で確かめます。' : '復習予定日になりました。答えを見ずに思い出せるか確かめます。') +
          (due.length > take ? '（ほかに' + (due.length - take) + '件。一度に増やしすぎないよう、次回にまわします）' : ''),
        cta: '復習をはじめる', dueCount: due.length
      };
    }
    var next = nextReviewDate(state, bank);
    return {
      kind: 'done', title: '今日の課題は完了です',
      detail: next ? '次の復習は ' + EA.util.fmtDate(next) + '（' + EA.util.relDay(next, now) + '）' : '',
      why: '「履歴・復習」で、これまでの解説や回答を見返せます。',
      cta: null
    };
  }

  EA.planner = {
    buildDiagnosticSession: buildDiagnosticSession,
    buildTrialSession: buildTrialSession,
    buildPracticeSession: buildPracticeSession,
    buildReviewSession: buildReviewSession,
    pickReviewQuestions: pickReviewQuestions,
    reviewPicks: reviewPicks,
    needOf: needOf,
    pickFollowUp: pickFollowUp,
    dueReviews: dueReviews,
    nextReviewDate: nextReviewDate,
    needsFollowUp: needsFollowUp,
    isEnglishOnly: isEnglishOnly,
    homeTask: homeTask,
    unitState: unitState
  };
})(typeof window !== 'undefined' ? window : globalThis);
