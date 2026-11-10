/*
 * session.js — 学習回（初回診断・解説と類題・復習）の進行（ロジックのみ。画面は扱いません）
 *
 * 時刻は t = { app: アプリ内の時刻, real: 実際の時刻 } で受け取ります。
 * （デモモードでは app が日付をずらした時刻。解答時間の計測には real を使います）
 *
 * ■ 理由（意味）の問いを出す条件（reasonDecision）
 *   前提：類題・確認問題・復習で、問題に reason があり、答えが正解で、ヒントを使っていない。
 *     ・診断では聞かない（6問の負担を増やさず、後の問題のヒントにもしないため）
 *     ・意味の確認問題では聞かない（問題そのものが意味の確認のため）
 *     ・答えが不正解なら聞かない（解説と確認問題に進むため）
 *     ・1回の学習で maxReasonQuestionsPerSession 問まで
 *   そのうえで、次のどれかに当てはまるときだけ聞く（上から順に判定。理由は記録に残す）
 *     meaning-recheck  意味の再確認が必要な項目
 *     unsure           答えは正解だが「自信がない」（答えと自信が食い違う）
 *     repeated-errors  最近の誤答を2回以上くり返している項目
 *     recheck-pending  前回「自信がない」「ヒントを使って正解」が残っている項目（日本語訳を見せていない問題のとき）
 *     first-check      訳を見ずに意味を確かめたことがまだない項目（日本語訳を見せていない問題のとき）
 *     insufficient     自力正解の実績がまだ少ない項目（日本語訳を見せていない問題のとき）
 *   聞かない：日本語訳を見たあとで上の最初の3つに当たらない（translation-shown。訳なしの別の英文で確かめる）、
 *             実績が安定している（stable）。聞かなかったことを「理由も理解している」とは扱わない。
 *
 * ■ 間違えたあとの確認問題（followup）
 *   類題・確認問題・復習で、不正解・「わからない」、または理由の問いが違ったとき：
 *   1. その場で、選んだ答えについての短い説明と解説を表示
 *   2. 同じ項目の別の問題を「確認問題」として次に1問追加（1回の学習で maxFollowUpsPerSession 問まで）
 *   3. 確認問題でもつまずいたら、それ以上は追加せず「基本の説明」を表示し、次回へ引き継ぐ
 *   追加できなかったとき（上限・別の問題がない）も、理由を記録して次回へ引き継ぎ、確認済みにはしない
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var G = EA.grading;

  function q(bank, id) { return EA.findQuestion(bank, id); }
  function item(state) { var s = state.activeSession; return s ? s.items[s.index] : null; }
  function attemptById(state, id) {
    for (var i = state.attempts.length - 1; i >= 0; i--) if (state.attempts[i].id === id) return state.attempts[i];
    return null;
  }
  function markExplainedIfNeeded(s, bank) {
    var it = s.items[s.index];
    if (it && it.kind === 'explain') s.explained[q(bank, it.questionId).skill] = true;
  }

  /** 正解の並びと同じにならないように混ぜる */
  function shuffledPool(tokens, answers) {
    var idx = tokens.map(function (_, i) { return i; });
    for (var tries = 0; tries < 20; tries++) {
      for (var i = idx.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = idx[i]; idx[i] = idx[j]; idx[j] = t;
      }
      var text = EA.grading.normalize(idx.map(function (k) { return tokens[k]; }).join(' '));
      var same = answers.some(function (a) { return EA.grading.normalize(a) === text; });
      if (!same) break;
    }
    return idx;
  }


  /* ---- 時間の計測：画面が見えていた時間（activeMs）と離れていた時間（awayMs）を分ける ---- */
  function pause(cur, real) {
    if (cur && cur.visibleSince) { cur.activeMs += real - cur.visibleSince; cur.visibleSince = null; cur.hiddenSince = real; }
  }
  function resume(cur, real) {
    if (cur && !cur.visibleSince && cur.phase === 'answer') {
      if (cur.hiddenSince) cur.awayMs += real - cur.hiddenSince;
      cur.hiddenSince = null; cur.visibleSince = real;
    }
  }

  function start(state, bank, session, t) {
    session.explained = session.explained || {};
    session.unresolved = session.unresolved || [];
    session.followUps = session.followUps || 0;
    session.reasonsAsked = session.reasonsAsked || 0;
    state.activeSession = session;
    if (!session.items.length) return finish(state, bank, t);
    markExplainedIfNeeded(session, bank);
    return null;
  }

  /** いまの問題の作業状態を用意する（再読み込み後は、閉じていた時間を学習時間に数えない） */
  function ensureCurrent(state, bank, t) {
    var s = state.activeSession, it = item(state);
    if (!it || it.kind !== 'question') return null;
    if (!s.current || s.current.index !== s.index) {
      var qq = q(bank, it.questionId);
      s.current = {
        index: s.index, startedAt: t.app, activeMs: 0, awayMs: 0, visibleSince: t.real, hiddenSince: null,
        hintUsed: false, unsure: false, draft: null, phase: 'answer', attemptId: null,
        pool: qq.format === 'order' ? shuffledPool(qq.tokens, qq.answers) : null,
        // 選択肢の表示順は問題ごとに入れ替える（正答の位置を覚えて答えられないように）
        choiceOrder: qq.choices ? shuffle(qq.choices.map(function (c) { return c.id; })) : null,
        reasonOrder: qq.reason ? shuffle(qq.reason.choices.map(function (c) { return c.id; })) : null
      };
    } else if (s.current.phase === 'answer' && !s.current.visibleSince) {
      s.current.visibleSince = t.real; s.current.hiddenSince = null;
    }
    return s.current;
  }

  function reasonApplicable(qq, it, a) {
    return !!qq.reason && qq.format !== 'meaning' &&
      (it.attemptType === 'similar' || it.attemptType === 'review' || it.attemptType === 'followup') &&
      G.isSkillCorrect(a.result) && !a.hintUsed && !a.gaveUp;
  }

  /** 理由を聞くかどうかと、その理由。a はまだ state.attempts に入れる前の回答 */
  function reasonDecision(state, bank, s, qq, it, a) {
    if (!reasonApplicable(qq, it, a)) return { ask: false, why: 'not-applicable' };
    var cap = (EA.config && EA.config.maxReasonQuestionsPerSession) || 3;
    if ((s.reasonsAsked || 0) >= cap) return { ask: false, why: 'cap' };
    var st = EA.mastery.analyze(qq.skill, state.attempts, bank);
    var types = st.issues.map(function (i) { return i.type; });
    if (types.indexOf('meaning') >= 0) return { ask: true, why: 'meaning-recheck' };
    if (a.confidence === 'unsure') return { ask: true, why: 'unsure' };
    var err = st.issues.filter(function (i) { return i.type === 'error'; })[0];
    if (err && err.count >= 2) return { ask: true, why: 'repeated-errors' };
    if (a.translationShown) return { ask: false, why: 'translation-shown' };
    if (types.indexOf('unsure') >= 0 || types.indexOf('hint') >= 0) return { ask: true, why: 'recheck-pending' };
    if (st.meaning !== 'confirmed') return { ask: true, why: 'first-check' };
    if (st.achievement < 2) return { ask: true, why: 'insufficient' };
    return { ask: false, why: 'stable' };
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /**
   * 回答を確定する。戻り値 { attempt, finished }（診断は自動で次へ進む）。
   * 二重確定の防止：回答を受け付ける段階（phase: answer）で、まだ記録していないときだけ処理し、それ以外は null を返す。
   */
  function submit(state, bank, gaveUp, t) {
    var s = state.activeSession;
    if (!s || !s.current || s.current.phase !== 'answer' || s.current.attemptId) return null;
    var cur = s.current, it = item(state), qq = q(bank, it.questionId);
    pause(cur, t.real);
    var response = gaveUp ? null : cur.draft;
    if (qq.format === 'order' && response) response = response.map(function (i) { return qq.tokens[i]; });
    var g = gaveUp ? { result: 'gaveup', feedback: '' } : G.grade(qq, response);
    var a = {
      id: EA.util.uid('a'),
      questionId: qq.id, questionVersion: qq.version, unitId: bank.unit.id,
      skillId: qq.skill, format: qq.format, checks: qq.checks,
      attemptType: it.attemptType, sessionId: s.id, sessionType: s.type,
      response: response, responseText: gaveUp ? '' : G.responseText(qq, response),
      result: g.result, feedback: g.feedback,
      confidence: cur.unsure ? 'unsure' : 'none',          // 押さなかった場合は「申告なし」（自信ありとは扱わない）
      hintUsed: !!cur.hintUsed, gaveUp: !!gaveUp,
      afterExplanation: it.attemptType === 'retry' || !!s.explained[qq.skill],
      // 答える前にこの英文の日本語訳を見ていたか（日本語が問題文の形式・解き直し）
      translationShown: qq.format === 'ja2en' || qq.format === 'order' || (qq.format === 'fill' && qq.showJa !== 'after') || it.attemptType === 'retry',
      choiceOrder: cur.choiceOrder || null,
      // 復習でこの問題を選んだ理由（planner.reviewPicks の why）。復習以外は null
      pickWhy: it.pickWhy || null,
      reason: null,                                         // null ＝ 理由は聞いていない
      reasonDecision: null,
      followUp: null,
      startedAt: cur.startedAt, answeredAt: t.app,
      activeMs: cur.activeMs, awayMs: cur.awayMs, elapsedMs: t.app - cur.startedAt
    };
    if (state.mode === 'demo') a.demo = true;
    if (s.type !== 'diagnostic') a.reasonDecision = reasonDecision(state, bank, s, qq, it, a);
    state.attempts.push(a);
    s.attemptIds.push(a.id);
    cur.attemptId = a.id;
    cur.hiddenSince = null;

    if (s.type === 'diagnostic') {
      // 初回診断中は、後の問題の答えにつながらないよう解説を出さずに次へ
      return { attempt: a, finished: next(state, bank, t, { internal: true }) };
    }
    if (a.reasonDecision && a.reasonDecision.ask) {
      s.reasonsAsked = (s.reasonsAsked || 0) + 1;
      cur.phase = 'reason';
      return { attempt: a, finished: null };
    }
    conclude(state, bank, a);
    return { attempt: a, finished: null };
  }

  function submitReason(state, bank, choiceId) {
    var s = state.activeSession;
    if (!s || !s.current || s.current.phase !== 'reason') return null; // 二重送信の防止
    var qq = q(bank, item(state).questionId);
    var a = attemptById(state, s.current.attemptId);
    a.reason = {
      asked: true, kind: qq.reason.kind || 'reason', prompt: qq.reason.prompt, choiceId: choiceId, correct: choiceId === qq.reason.answer,
      choiceOrder: s.current.reasonOrder || null,
      // 日本語訳・解説・ヒントを見ずに答えた理由か（false は考え方の参考として記録）
      independent: !a.translationShown && !a.afterExplanation && !a.hintUsed,
      why: a.reasonDecision ? a.reasonDecision.why : null
    };
    conclude(state, bank, a);
    return a;
  }

  /** 正誤と解説を表示する段階へ。必要なら確認問題を追加する */
  function conclude(state, bank, a) {
    var s = state.activeSession;
    s.current.phase = 'feedback';
    s.explained[a.skillId] = true; // 解説を表示するので、このあとの同じ項目の回答は「解説後」
    planFollowUp(state, bank, s, a);
  }

  function planFollowUp(state, bank, s, a) {
    if (['similar', 'review', 'followup'].indexOf(a.attemptType) < 0) return;
    var wrong = G.isSkillWrong(a.result);
    var meaningNg = !!(a.reason && a.reason.correct === false);
    if (!wrong && !meaningNg) return;
    var trigger = wrong ? 'error' : 'meaning';
    var cap = (EA.config && EA.config.maxFollowUpsPerSession) || 3;
    function unresolved(why, basics) {
      a.followUp = { added: null, trigger: trigger, why: why, basics: !!basics };
      s.unresolved.push({ skillId: a.skillId, questionId: a.questionId, trigger: trigger, why: why, attemptId: a.id });
    }
    if (a.attemptType === 'followup') return unresolved('確認問題でもつまずいたため、基本の説明を表示しました。この内容は次回の復習でもう一度確認します。', true);
    if (s.followUps >= cap) return unresolved('今回追加できる確認問題の上限（' + cap + '問）に達したため、次回の復習で確認します。');
    var fq = EA.planner.pickFollowUp(state, bank, s, a, trigger);
    if (!fq) return unresolved('別の確認問題が用意されていないため、次回の復習で確認します（確認済みにはしません）。');
    s.items.splice(s.index + 1, 0, { kind: 'question', questionId: fq.id, attemptType: 'followup', forSkill: a.skillId, trigger: trigger });
    s.followUps++;
    a.followUp = { added: fq.id, trigger: trigger };
  }

  /**
   * 次へ。最後まで進んだら学習回を終えて記録を返す（続くときは null）。
   * 解説の項目か、正誤を表示している段階でだけ進める。それ以外（二重タップなど）は false を返して何もしない。
   */
  function next(state, bank, t, opts) {
    var s = state.activeSession;
    if (!s) return false;
    var it = s.items[s.index];
    var allowed = (opts && opts.internal) || (it && it.kind === 'explain') || (s.current && s.current.index === s.index && s.current.phase === 'feedback');
    if (!allowed) return false;
    s.index++;
    s.current = null;
    if (s.index >= s.items.length) return finish(state, bank, t);
    markExplainedIfNeeded(s, bank);
    return null;
  }

  /**
   * 学習回を終える（最後まで進んだとき、または「今日はここまで」）。
   * 復習予定を更新し、まだ出していない問題・未解決の内容を記録に残す。
   */
  function finish(state, bank, t, opts) {
    var s = state.activeSession;
    var early = !!(opts && opts.early);
    var attempts = s.attemptIds.map(function (id) { return attemptById(state, id); }).filter(Boolean);
    // 試作の単元は復習予定に入れない
    var changes = s.type === 'trial' ? [] : EA.scheduler.applySession(state.schedule, s.type, attempts, state.attempts, t.app, EA.config, bank);
    var u = EA.planner.unitState(state, s.unitId);
    if (s.type === 'diagnostic') { u.diagnosticDoneAt = t.app; u.diagnosticSessionId = s.id; }
    if (s.type === 'practice') { u.practiceDoneAt = t.app; if (early) u.practiceEndedEarly = true; }
    var skipped = [];
    if (early) {
      var startAt = s.current && s.current.attemptId ? s.index + 1 : s.index;
      s.items.slice(startAt).forEach(function (it) {
        if (it.kind !== 'question') return;
        var sk = q(bank, it.questionId).skill;
        skipped.push({ skillId: sk, questionId: it.questionId, attemptType: it.attemptType });
      });
      skipped.forEach(function (x) {
        if (x.attemptType === 'followup' || x.attemptType === 'similar') {
          s.unresolved.push({ skillId: x.skillId, questionId: x.questionId, trigger: 'stopped', why: '「今日はここまで」で終えたため、この確認は次回の復習で行います。' });
        }
      });
    }
    var record = {
      id: s.id, type: s.type, unitId: s.unitId, startedAt: s.startedAt, finishedAt: t.app, endedEarly: early,
      attemptIds: s.attemptIds.slice(), followUps: s.followUps, unresolved: s.unresolved.slice(), skipped: skipped,
      scheduleChanges: changes.map(function (c) { return { skillId: c.skillId, step: c.step, dueAt: c.dueAt, why: c.lastReason }; }),
      deferredSkills: s.deferredSkills || []
    };
    state.sessions.push(record);
    state.activeSession = null;
    return record;
  }

  EA.session = {
    start: start, item: item, ensureCurrent: ensureCurrent, pause: pause, resume: resume,
    submit: submit, submitReason: submitReason, next: next, finish: finish,
    reasonDecision: reasonDecision, attemptById: attemptById, shuffledPool: shuffledPool
  };
})(typeof window !== 'undefined' ? window : globalThis);
