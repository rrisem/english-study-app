/*
 * app.js — 画面の表示と操作
 * 画面：ホーム / 単元一覧 / 問題（診断・解き直し・類題・復習）/ 診断結果 / 学習のまとめ / 履歴 / 問題の詳細 / 設定
 */
(function (root) {
  'use strict';
  var EA = root.EA;
  var U = EA.util, G = EA.grading, M = EA.mastery, P = EA.planner;
  var esc = U.esc;
  var BANK = EA.banks.infinitive;

  var state = EA.storage.load();
  EA.clock.offsetDays = state.settings.devDayOffset || 0;
  var view = { name: 'home', params: {} };
  var appEl = null;
  var notice = null;

  var TYPE_LABEL = { diagnostic: '初回診断', retry: '解き直し', similar: '類題', review: '復習' };
  var SESSION_LABEL = { diagnostic: '初回診断', practice: '解説と類題', review: '復習' };
  var FORMAT_LABEL = { fill: '空所補充', order: '並び替え', ja2en: '日本語→英語', meaning: '意味の確認' };

  function now() { return EA.clock.now(); }
  function persist() { EA.storage.save(state); }
  function q(id) { return EA.findQuestion(BANK, id); }
  function skill(id) { return EA.findSkill(BANK, id); }
  function attemptById(id) { for (var i = state.attempts.length - 1; i >= 0; i--) if (state.attempts[i].id === id) return state.attempts[i]; return null; }

  function go(name, params) {
    view = { name: name, params: params || {} };
    render();
    try { root.scrollTo(0, 0); } catch (e) { /* 無視 */ }
  }

  /* ================= 時間の計測 =================
   * 実際に画面が見えている時間（activeMs）と、画面を離れていた時間（awayMs）を分けて記録します。
   * 時間は講師の参考情報で、理解度の判定には使いません。 */
  function timerStart(cur) { cur.visibleSince = Date.now(); }
  function timerPause(cur) {
    if (cur && cur.visibleSince) { cur.activeMs += Date.now() - cur.visibleSince; cur.visibleSince = null; cur.hiddenSince = Date.now(); }
  }
  function timerResume(cur) {
    if (cur && !cur.visibleSince) {
      if (cur.hiddenSince) cur.awayMs += Date.now() - cur.hiddenSince;
      cur.hiddenSince = null; cur.visibleSince = Date.now();
    }
  }
  function timerRead(cur) { return cur.activeMs + (cur.visibleSince ? Date.now() - cur.visibleSince : 0); }

  document.addEventListener('visibilitychange', function () {
    var s = state.activeSession;
    if (!s || !s.current) return;
    if (document.hidden) timerPause(s.current); else timerResume(s.current);
    persist();
  });
  root.addEventListener('pagehide', function () {
    var s = state.activeSession;
    if (s && s.current) { timerPause(s.current); persist(); }
  });

  /* ================= 学習の流れ ================= */
  function startSession(session) {
    state.activeSession = session;
    if (!session.items.length) { finishSession(); return; }
    persist();
    go('session');
  }

  function ensureCurrent(s) {
    var item = s.items[s.index];
    if (!item || item.kind !== 'question') return null;
    if (!s.current || s.current.index !== s.index) {
      var qq = q(item.questionId);
      s.current = {
        index: s.index, startedAt: now(), activeMs: 0, awayMs: 0, visibleSince: null, hiddenSince: null,
        hintUsed: false, unsure: false, draft: null, phase: 'answer', attemptId: null,
        pool: qq.format === 'order' ? EA.orderWidget.shuffledPool(qq.tokens, qq.answers) : null
      };
      timerStart(s.current);
      persist();
    } else if (s.current.phase === 'answer') {
      // 再読み込み・再開時：閉じていた間は学習時間に数えない
      if (!s.current.visibleSince) { s.current.visibleSince = Date.now(); s.current.hiddenSince = null; }
    }
    return s.current;
  }

  function submitAnswer(gaveUp) {
    var s = state.activeSession, cur = s.current, item = s.items[s.index], qq = q(item.questionId);
    timerPause(cur);
    var response = gaveUp ? null : cur.draft;
    if (qq.format === 'order' && response) response = response.map(function (i) { return qq.tokens[i]; });
    var g = gaveUp ? { result: 'gaveup', feedback: '' } : G.grade(qq, response);
    var answeredAt = now();
    var attempt = {
      id: U.uid('a'),
      questionId: qq.id, questionVersion: qq.version, unitId: BANK.unit.id,
      skillId: qq.skill, format: qq.format, checks: qq.checks,
      attemptType: item.attemptType, sessionId: s.id, sessionType: s.type,
      response: response, responseText: gaveUp ? '' : G.responseText(qq, response),
      result: g.result, feedback: g.feedback,
      confidence: cur.unsure ? 'unsure' : 'none',
      hintUsed: !!cur.hintUsed, gaveUp: !!gaveUp,
      reason: null,
      startedAt: cur.startedAt, answeredAt: answeredAt,
      activeMs: cur.activeMs, awayMs: cur.awayMs, elapsedMs: answeredAt - cur.startedAt
    };
    state.attempts.push(attempt);
    s.attemptIds.push(attempt.id);
    cur.attemptId = attempt.id;
    cur.hiddenSince = null;

    if (s.type === 'diagnostic') {
      // 初回診断中は、後の問題の答えにつながらないよう解説を出さずに次へ
      advance();
      return;
    }
    cur.phase = (qq.reason && !gaveUp) ? 'reason' : 'feedback';
    persist();
    render();
  }

  function submitReason(choiceId) {
    var s = state.activeSession, cur = s.current, qq = q(s.items[s.index].questionId);
    var a = attemptById(cur.attemptId);
    a.reason = { prompt: qq.reason.prompt, choiceId: choiceId, correct: choiceId === qq.reason.answer };
    cur.phase = 'feedback';
    persist();
    render();
  }

  function advance() {
    var s = state.activeSession;
    s.index++;
    s.current = null;
    if (s.index >= s.items.length) { finishSession(); return; }
    persist();
    go('session');
  }

  function finishSession() {
    var s = state.activeSession;
    var t = now();
    var attempts = s.attemptIds.map(attemptById).filter(Boolean);
    var changes = EA.scheduler.applySession(state.schedule, s.type, attempts, t, EA.config, BANK);
    var u = P.unitState(state, s.unitId);
    if (s.type === 'diagnostic') { u.diagnosticDoneAt = t; u.diagnosticSessionId = s.id; }
    if (s.type === 'practice') u.practiceDoneAt = t;
    var record = {
      id: s.id, type: s.type, unitId: s.unitId, startedAt: s.startedAt, finishedAt: t,
      attemptIds: s.attemptIds, scheduleChanges: changes.map(function (c) { return { skillId: c.skillId, step: c.step, dueAt: c.dueAt, why: c.lastReason }; }),
      deferredSkills: s.deferredSkills || []
    };
    state.sessions.push(record);
    state.activeSession = null;
    persist();
    go(s.type === 'diagnostic' ? 'results' : 'summary', { sessionId: s.id });
  }

  function quitSession() {
    var s = state.activeSession;
    if (s && s.current) timerPause(s.current);
    persist();
    notice = '途中まで保存しました。ホームの「続きから再開」で戻れます。';
    go('home');
  }

  /* ================= 共通の部品 ================= */
  function resultBadge(result) {
    var info = G.RESULT_INFO[result];
    return '<span class="badge tone-' + info.tone + '"><span class="badge-mark" aria-hidden="true">' + info.mark + '</span>' + esc(info.label) + '</span>';
  }

  function flagsHtml(a) {
    var f = [];
    if (a.hintUsed) f.push('<span class="flag">ヒントあり</span>');
    if (a.confidence === 'unsure') f.push('<span class="flag">自信がない</span>');
    if (a.reason) f.push('<span class="flag ' + (a.reason.correct ? '' : 'flag-warn') + '">理由 ' + (a.reason.correct ? '○' : '×') + '</span>');
    return f.join('');
  }

  function levelMeter(level) {
    var h = '<span class="meter" aria-hidden="true">';
    for (var i = 1; i <= 3; i++) h += '<span class="meter-seg' + (i <= level ? ' on' : '') + '"></span>';
    return h + '</span>';
  }

  function explanationHtml(qq) {
    var e = qq.explanation;
    var sentence = e.chunks.map(function (c) {
      return c.mark ? '<mark>' + esc(c.en) + '</mark>' : esc(c.en);
    }).join(' ');
    var lastPunct = /[.?!]$/.test(e.answer) ? e.answer.slice(-1) : '';
    var rows = e.chunks.map(function (c) {
      return '<li class="' + (c.mark ? 'is-mark' : '') + '"><span class="ex-en" lang="en">' + esc(c.en) + '</span>' +
        '<span class="ex-arrow" aria-hidden="true">→</span><span class="ex-ja">' + esc(c.ja) + '</span></li>';
    }).join('');
    return '<div class="explain">' +
      '<p class="ex-answer" lang="en">' + sentence + esc(lastPunct) + '</p>' +
      '<p class="ex-translation">' + esc(e.translation) + '</p>' +
      (e.also ? '<p class="ex-also">' + esc(e.also) + '</p>' : '') +
      '<ol class="ex-map" aria-label="どの部分が、どの意味につながるか">' + rows + '</ol>' +
      '<p class="ex-point">' + esc(e.point) + '</p>' +
      '<p class="ex-term"><span class="label">文法の名前</span>' + esc(e.term) + '</p>' +
      '</div>';
  }

  function questionPromptHtml(qq, draftChoice) {
    var h = '<p class="q-instruction">' + esc(qq.instruction) + '</p>';
    if (qq.format === 'meaning') {
      h += '<p class="q-sentence" lang="en">' + esc(qq.sentence) + '</p>';
      h += '<p class="q-ja q-question">' + esc(qq.question) + '</p>';
    } else {
      h += '<p class="q-ja">' + esc(qq.ja) + '</p>';
      if (qq.format === 'fill') {
        var chosen = null;
        (qq.choices || []).forEach(function (c) { if (c.id === draftChoice) chosen = c.text; });
        var parts = qq.sentence.split('___');
        h += '<p class="q-sentence" lang="en">' + esc(parts[0]) +
          '<span class="blank' + (chosen ? ' filled' : '') + '">' + (chosen ? esc(chosen) : '<span class="sr">空所</span>') + '</span>' +
          esc(parts[1] || '') + '</p>';
      }
    }
    return h;
  }

  function topbar() {
    var inSession = view.name === 'session';
    var navItems = [['home', 'ホーム'], ['units', '単元'], ['history', '履歴・復習'], ['settings', '設定']];
    var nav = inSession ? '' : '<nav class="nav" aria-label="メニュー">' + navItems.map(function (n) {
      var cur = view.name === n[0] || (n[0] === 'history' && view.name === 'question');
      return '<button type="button" class="nav-item' + (cur ? ' is-current' : '') + '" data-go="' + n[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + n[1] + '</button>';
    }).join('') + '</nav>';
    var dev = state.settings.devDayOffset ? '<div class="devbar" role="status">開発用の日付で表示中：' + U.fmtDate(now()) + '（+' + state.settings.devDayOffset + '日）<button type="button" class="btn-text" data-act="dev-reset">元に戻す</button></div>' : '';
    var store = EA.storage.isAvailable() ? '' : '<div class="warnbar" role="alert">このブラウザでは学習記録を保存できない状態です（プライベートブラウズなど）。ページを閉じると記録が消えます。</div>';
    return '<header class="topbar"><div class="topbar-inner">' +
      '<div class="brand"><span class="brand-mark" aria-hidden="true">to</span><span class="brand-name">英文法ドリル</span></div>' +
      nav + (inSession ? '<button type="button" class="btn-quiet" data-act="quit">中断してホームへ</button>' : '') +
      '</div></header>' + dev + store;
  }

  /* ================= 画面：ホーム ================= */
  function todayStudyMs() {
    var today = U.startOfDay(now());
    var cap = EA.config.maxCountedMsPerQuestion;
    return state.attempts.filter(function (a) { return U.startOfDay(a.answeredAt) === today; })
      .reduce(function (sum, a) { return sum + Math.min(a.activeMs || 0, cap); }, 0);
  }

  function renderHome() {
    var t = now();
    var task = P.homeTask(state, BANK, t);
    var studyMin = Math.floor(todayStudyMs() / 60000);
    var goal = state.settings.dailyGoalMinutes;
    var pct = Math.min(100, Math.round(studyMin / goal * 100));
    var due = P.dueReviews(state, BANK, t);
    var scheduled = BANK.skills.filter(function (sk) { return state.schedule[sk.id]; }).length;
    var next = P.nextReviewDate(state, BANK);

    var h = '<section class="hero">' +
      '<p class="eyebrow">' + U.fmtDate(t) + ' ・ 次にやること</p>' +
      '<h1 class="hero-title">' + esc(task.title) + '</h1>' +
      (task.detail ? '<p class="hero-detail">' + esc(task.detail) + '</p>' : '') +
      '<p class="hero-why">' + esc(task.why) + '</p>' +
      (task.cta ? '<button type="button" class="btn-primary btn-lg" data-act="task-' + task.kind + '">' + esc(task.cta) + '<span aria-hidden="true"> →</span></button>' : '') +
      '</section>';

    h += '<section class="stats" aria-label="今日の状況">' +
      '<div class="stat"><p class="stat-label">今日の学習時間</p><p class="stat-value"><span class="num">' + studyMin + '</span>分<span class="stat-sub"> ／ 目標 ' + goal + '分</span></p>' +
        '<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="目標に対する学習時間"><span style="width:' + pct + '%"></span></div></div>' +
      '<div class="stat"><p class="stat-label">今日の復習</p><p class="stat-value"><span class="num">' + due.length + '</span>件<span class="stat-sub"> ／ 予定 ' + scheduled + '件</span></p>' +
        '<p class="stat-note">' + (next ? '次の復習予定：' + U.fmtDate(next) : '診断のあとに予定が決まります') + '</p></div>' +
      '<div class="stat"><p class="stat-label">「別の問題でも自力で解けた」以上</p><p class="stat-value"><span class="num">' +
        BANK.skills.filter(function (sk) { return M.computeSkillStatus(sk.id, state.attempts, BANK).level >= 2; }).length +
        '</span><span class="stat-sub"> ／ ' + BANK.skills.length + ' 項目</span></p><p class="stat-note">単元「' + esc(BANK.unit.title) + '」</p></div>' +
      '</section>';

    h += '<section class="panel"><div class="panel-head"><h2>確認状況</h2><p class="panel-note">アプリ内での確認状況です。習得を保証するものではありません。</p></div><ul class="skill-list">' +
      BANK.skills.map(function (sk) {
        var st = M.computeSkillStatus(sk.id, state.attempts, BANK);
        var sch = state.schedule[sk.id];
        return '<li><button type="button" class="skill-row" data-act="skill" data-skill="' + sk.id + '">' +
          '<span class="skill-name"><span class="skill-label">' + esc(sk.label) + '</span><span class="skill-term">' + esc(sk.term) + '</span></span>' +
          '<span class="skill-status">' + levelMeter(st.level) + '<span>' + esc(st.label) + '</span></span>' +
          '<span class="skill-due">' + (sch ? '復習 ' + U.relDay(sch.dueAt, t) : '—') + '</span>' +
          '</button></li>';
      }).join('') + '</ul></section>';
    return h;
  }

  /* ================= 画面：単元一覧 ================= */
  function renderUnits() {
    var u = P.unitState(state, BANK.unit.id);
    var steps = [
      ['初回診断', !!u.diagnosticDoneAt],
      ['解説と類題', !!u.practiceDoneAt],
      ['1回目の復習', state.sessions.some(function (s) { return s.type === 'review'; })]
    ];
    return '<h1 class="page-title">単元</h1>' +
      '<section class="panel unit-card"><div class="unit-head"><div><p class="eyebrow">利用できます</p><h2>' + esc(BANK.unit.title) + '</h2>' +
      '<p>' + esc(BANK.unit.description) + '</p></div>' +
      '<button type="button" class="btn-primary" data-go="home">ホームの課題へ</button></div>' +
      '<ol class="steps">' + steps.map(function (s) { return '<li class="' + (s[1] ? 'done' : '') + '"><span class="step-mark" aria-hidden="true">' + (s[1] ? '✓' : '') + '</span>' + s[0] + '<span class="sr">' + (s[1] ? '（済み）' : '（まだ）') + '</span></li>'; }).join('') + '</ol>' +
      '<p class="unit-scope">この単元で扱う範囲：' + esc(BANK.unit.scopeNote) + '</p></section>' +
      '<section class="later"><h2>今後追加する予定の単元</h2><p>動名詞・比較・関係代名詞などを予定しています。まだ利用できません。</p></section>';
  }

  /* ================= 画面：問題 ================= */
  function renderSession() {
    var s = state.activeSession;
    if (!s) return renderHome();
    var item = s.items[s.index];
    var total = s.items.length;
    var progress = '<div class="q-progress"><span class="q-type">' + esc(SESSION_LABEL[s.type]) + '</span>' +
      '<span class="q-count">' + (s.index + 1) + ' / ' + total + '</span>' +
      '<span class="q-bar" aria-hidden="true"><span style="width:' + Math.round(s.index / total * 100) + '%"></span></span></div>';

    if (item.kind === 'explain') {
      var qq = q(item.questionId), src = attemptById(item.sourceAttemptId);
      return progress + '<section class="sheet">' +
        '<p class="eyebrow">解説 ・ 診断の問題（' + esc(FORMAT_LABEL[qq.format]) + '）</p>' +
        questionPromptHtml(qq, null) +
        (src ? '<div class="your-answer"><span class="label">あなたの答え</span><span lang="en">' + (src.responseText ? esc(src.responseText) : '（なし）') + '</span>' + resultBadge(src.result) + flagsHtml(src) + '</div>' : '') +
        (src && src.feedback ? '<p class="feedback-note">' + esc(src.feedback) + '</p>' : '') +
        explanationHtml(qq) +
        '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="next">' +
        (s.items[s.index + 1] && s.items[s.index + 1].attemptType === 'retry' ? '答えを隠して解き直す' : '次へ（別の問題で確かめる）') + '</button></div>' +
        '</section>';
    }

    var qq2 = q(item.questionId);
    var cur = ensureCurrent(s);
    var typeNote = {
      diagnostic: '解説は全問に答えたあとに表示します。',
      retry: '解説を読んだ直後の解き直しです（類題とは別に記録します）。',
      similar: '単語や場面を変えた類題です。',
      review: '復習です。答えを見ずに思い出してみましょう。'
    }[item.attemptType];

    var body = '<section class="sheet" aria-live="polite">' +
      '<p class="eyebrow">' + esc(TYPE_LABEL[item.attemptType]) + ' ・ ' + esc(FORMAT_LABEL[qq2.format]) + '<span class="eyebrow-note">' + esc(typeNote) + '</span></p>';

    if (cur.phase === 'answer') {
      body += questionPromptHtml(qq2, cur.draft) + '<div class="answer-area" id="answer-area">' + answerControlHtml(qq2, cur) + '</div>';
      if (cur.hintUsed) body += '<div class="hint" role="note"><span class="label">ヒント</span>' + esc(qq2.hint) + '</div>';
      body += '<div class="helpers">' +
        '<button type="button" class="btn-toggle" data-act="unsure" aria-pressed="' + (cur.unsure ? 'true' : 'false') + '">' +
          '<span class="toggle-box" aria-hidden="true">' + (cur.unsure ? '✓' : '') + '</span>自信がない</button>' +
        '<button type="button" class="btn-quiet" data-act="hint"' + (cur.hintUsed ? ' disabled' : '') + '>ヒントを見る</button>' +
        '<button type="button" class="btn-quiet" data-act="giveup">わからない</button>' +
        '<span class="helpers-note">押しても減点はありません。' + (item.attemptType === 'diagnostic' ? 'ヒントを見た場合は「ヒントあり」と記録します。' : '') + '</span>' +
        '</div>' +
        '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="submit" id="submit-btn"' + (hasDraft(qq2, cur) ? '' : ' disabled') + '>回答を確定</button></div>';
    } else {
      var a = attemptById(cur.attemptId);
      body += questionPromptHtml(qq2, qq2.format === 'fill' ? a.response : null);
      body += '<div class="your-answer"><span class="label">あなたの答え</span><span lang="en">' + (a.responseText ? esc(a.responseText) : '（わからない）') + '</span></div>';
      if (cur.phase === 'reason') {
        body += '<div class="reason"><p class="reason-q"><span class="label">考え方</span>' + esc(qq2.reason.prompt) + '</p>' +
          '<p class="reason-note">答えの正誤はこのあと表示します。</p><div class="choices">' +
          qq2.reason.choices.map(function (c) { return '<button type="button" class="choice" data-act="reason" data-choice="' + c.id + '">' + esc(c.text) + '</button>'; }).join('') +
          '</div></div>';
      } else {
        body += '<div class="verdict">' + resultBadge(a.result) + flagsHtml(a) + '</div>';
        if (a.feedback) body += '<p class="feedback-note">' + esc(a.feedback) + '</p>';
        if (a.reason) {
          var rc = null; qq2.reason.choices.forEach(function (c) { if (c.id === qq2.reason.answer) rc = c; });
          body += '<div class="reason-result"><span class="label">考え方</span>' + (a.reason.correct ? '○ 選んだ理由は正しいです。' : '× 選んだ理由とは違います。') +
            '<span class="reason-correct">理由：' + esc(rc.text) + '</span></div>';
        }
        body += explanationHtml(qq2);
        body += '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="next">' + (s.index + 1 >= total ? '結果を見る' : '次へ') + '</button></div>';
      }
    }
    return progress + body + '</section>';
  }

  function hasDraft(qq, cur) {
    if (qq.format === 'order') return !!(cur.draft && cur.draft.length === qq.tokens.length);
    if (qq.format === 'ja2en') return !!(cur.draft && cur.draft.trim());
    return !!cur.draft;
  }

  function answerControlHtml(qq, cur) {
    if (qq.format === 'fill' || qq.format === 'meaning') {
      return '<div class="choices" role="radiogroup" aria-label="選択肢">' + qq.choices.map(function (c) {
        var on = cur.draft === c.id;
        return '<button type="button" role="radio" aria-checked="' + on + '" class="choice' + (on ? ' is-selected' : '') + '" data-act="choose" data-choice="' + c.id + '"' + (qq.format === 'fill' ? ' lang="en"' : '') + '>' +
          '<span class="choice-dot" aria-hidden="true"></span>' + esc(c.text) + '</button>';
      }).join('') + '</div>';
    }
    if (qq.format === 'order') return '<div id="order-mount" lang="en"></div>';
    if (qq.format === 'ja2en') {
      return '<label class="field-label" for="ja2en-input">英文を入力</label>' +
        '<textarea id="ja2en-input" class="text-input" rows="2" lang="en" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" placeholder="ここに英文を書きます">' + esc(cur.draft || '') + '</textarea>' +
        '<p class="field-note">大文字・小文字、余分な空白、文末の「.」の有無は採点に影響しません。</p>';
    }
    return '';
  }

  function mountSessionWidgets() {
    var s = state.activeSession;
    if (!s || !s.current || s.current.phase !== 'answer') return;
    var qq = q(s.items[s.index].questionId);
    var btn = document.getElementById('submit-btn');
    if (qq.format === 'order') {
      EA.orderWidget.mount(document.getElementById('order-mount'), qq.tokens, s.current.pool, s.current.draft || [], function (placed) {
        s.current.draft = placed; persist();
        btn.disabled = !hasDraft(qq, s.current);
      });
    }
    if (qq.format === 'ja2en') {
      var input = document.getElementById('ja2en-input');
      input.addEventListener('input', function () {
        s.current.draft = input.value; persist();
        btn.disabled = !hasDraft(qq, s.current);
      });
    }
  }

  /* ================= 画面：診断結果 ================= */
  function renderResults() {
    var rec = sessionRecord(view.params.sessionId);
    if (!rec) return renderHome();
    var atts = rec.attemptIds.map(attemptById).filter(Boolean);
    var solid = atts.filter(M.isSolid).length;
    var flagged = atts.filter(P.needsFollowUp).length;
    var h = '<p class="eyebrow">初回診断の結果</p><h1 class="page-title">' + atts.length + '問中、ヒントなし・迷いなしで正解 ' + solid + '問</h1>' +
      '<p class="lead">この6問だけで不定詞全体の理解は判断できません。ここからは、気になる回答があった問題の解説と、別の問題での確認に進みます。</p>';
    h += '<ol class="result-list">' + atts.map(function (a, i) {
      var qq = q(a.questionId);
      return '<li class="result-row"><div class="result-main"><span class="result-no">' + (i + 1) + '</span>' +
        '<div class="result-body"><p class="result-q">' + esc(qq.ja || qq.question) + '<span class="result-format">' + esc(FORMAT_LABEL[qq.format]) + '</span></p>' +
        '<p class="result-ans" lang="en">' + (a.responseText ? esc(a.responseText) : '（わからない）') + '</p>' +
        '<div class="result-tags">' + resultBadge(a.result) + flagsHtml(a) + '</div></div></div>' +
        '<details class="result-detail"><summary>解説を見る</summary>' + (a.feedback ? '<p class="feedback-note">' + esc(a.feedback) + '</p>' : '') + explanationHtml(qq) + '</details></li>';
    }).join('') + '</ol>';
    h += '<div class="actions actions-split">' +
      '<button type="button" class="btn-primary btn-lg" data-act="task-practice">' + (flagged ? '解説と類題へ（' + flagged + '問）' : '別の問題でも確かめる（3問・任意）') + '</button>' +
      '<button type="button" class="btn-quiet" data-act="skip-practice-later">今日はここまで（あとでホームから）</button>' +
      (flagged ? '' : '<button type="button" class="btn-quiet" data-act="skip-practice">確認問題はとばす</button>') +
      '</div>';
    return h;
  }

  function sessionRecord(id) {
    for (var i = state.sessions.length - 1; i >= 0; i--) if (state.sessions[i].id === id) return state.sessions[i];
    return null;
  }

  /* ================= 画面：学習のまとめ ================= */
  function renderSummary() {
    var rec = sessionRecord(view.params.sessionId);
    if (!rec) return renderHome();
    var t = now();
    var atts = rec.attemptIds.map(attemptById).filter(Boolean);
    var h = '<p class="eyebrow">' + esc(SESSION_LABEL[rec.type]) + 'のまとめ</p><h1 class="page-title">おつかれさまでした</h1>';
    h += '<section class="panel"><div class="panel-head"><h2>今回の回答</h2></div><ul class="att-list">' + atts.map(function (a) {
      var qq = q(a.questionId);
      return '<li><button type="button" class="att-row" data-act="question" data-q="' + qq.id + '">' +
        '<span class="att-type">' + esc(TYPE_LABEL[a.attemptType]) + '</span>' +
        '<span class="att-q">' + esc(qq.ja || qq.sentence) + '</span>' +
        '<span class="att-tags">' + resultBadge(a.result) + flagsHtml(a) + '</span></button></li>';
    }).join('') + '</ul></section>';
    h += '<section class="panel"><div class="panel-head"><h2>確認状況と次の復習</h2><p class="panel-note">アプリ内での確認状況です。</p></div><ul class="plan-list">' +
      BANK.skills.map(function (sk) {
        var st = M.computeSkillStatus(sk.id, state.attempts, BANK);
        var sch = state.schedule[sk.id];
        var ch = (rec.scheduleChanges || []).filter(function (c) { return c.skillId === sk.id; })[0];
        return '<li><div class="plan-name"><span class="skill-label">' + esc(sk.label) + '</span><span class="skill-term">' + esc(sk.term) + '</span></div>' +
          '<div class="plan-status">' + levelMeter(st.level) + esc(st.label) + '</div>' +
          '<div class="plan-due">' + (sch ? '<strong>' + U.fmtDate(sch.dueAt) + '</strong>（' + U.relDay(sch.dueAt, t) + '）' : '—') +
          (ch ? '<span class="plan-why">' + esc(ch.why) + '</span>' : (sch ? '<span class="plan-why">今回は変更なし</span>' : '')) + '</div></li>';
      }).join('') + '</ul>' +
      ((rec.deferredSkills || []).length ? '<p class="panel-note">ほかに' + rec.deferredSkills.length + '件の復習が残っています。一度に増やしすぎないよう、次回にまわしました。</p>' : '') +
      '</section>';
    h += '<div class="actions"><button type="button" class="btn-primary btn-lg" data-go="home">ホームへ</button></div>';
    return h;
  }

  /* ================= 画面：履歴・復習一覧 ================= */
  function renderHistory() {
    var tab = view.params.tab || 'plan';
    var t = now();
    var tabs = [['plan', '復習予定'], ['answers', '回答履歴']];
    var h = '<h1 class="page-title">履歴・復習</h1><div class="tabs" role="tablist">' + tabs.map(function (x) {
      return '<button type="button" role="tab" aria-selected="' + (tab === x[0]) + '" class="tab' + (tab === x[0] ? ' is-current' : '') + '" data-act="tab" data-tab="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';

    if (tab === 'plan') {
      h += BANK.skills.map(function (sk) {
        var st = M.computeSkillStatus(sk.id, state.attempts, BANK);
        var sch = state.schedule[sk.id];
        var open = view.params.skill === sk.id;
        var qs = BANK.questions.filter(function (x) { return x.skill === sk.id; });
        return '<section class="panel skill-panel" id="skill-' + sk.id + '"><div class="skill-panel-head">' +
          '<div><h2>' + esc(sk.label) + '<span class="skill-term">' + esc(sk.term) + '</span></h2><p class="muted">' + esc(sk.plain) + '</p></div>' +
          '<div class="skill-panel-due">' + (sch ? '<span class="label">次の復習</span><strong>' + U.fmtDate(sch.dueAt) + '</strong><span class="muted">' + U.relDay(sch.dueAt, t) + ' ・ 間隔 ' + sch.intervalDays + '日</span>' : '<span class="muted">予定なし（診断前）</span>') + '</div></div>' +
          '<div class="status-box">' + levelMeter(st.level) + '<strong>' + esc(st.label) + '</strong><ul class="evidence">' + st.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></div>' +
          (sch && sch.history ? '<details' + (open ? ' open' : '') + '><summary>復習予定が決まった理由</summary><ul class="sched-history">' + sch.history.slice().reverse().map(function (x) {
            return '<li><span class="muted">' + U.fmtDateTime(x.at) + '</span> ' + esc(SESSION_LABEL[x.sessionType]) + '：' + esc(x.why) + ' → ' + U.fmtDate(x.dueAt) + '</li>';
          }).join('') + '</ul></details>' : '') +
          '<details' + (open ? ' open' : '') + '><summary>この項目の問題（' + qs.length + '問）・解説・過去の回答</summary><ul class="q-list">' + qs.map(function (x) {
            var n = state.attempts.filter(function (a) { return a.questionId === x.id; });
            var last = n[n.length - 1];
            return '<li><button type="button" class="att-row" data-act="question" data-q="' + x.id + '"><span class="att-type">' + esc(FORMAT_LABEL[x.format]) + '</span>' +
              '<span class="att-q">' + esc(x.ja || x.sentence) + (x.status === 'excluded' ? '（判定から除外中）' : '') + '</span>' +
              '<span class="att-tags">' + (last ? resultBadge(last.result) : '<span class="muted">未回答</span>') + '<span class="muted">' + n.length + '回</span></span></button></li>';
          }).join('') + '</ul></details></section>';
      }).join('');
    } else {
      var list = state.attempts.slice().reverse();
      h += list.length ? '<ul class="att-list panel">' + list.map(function (a) {
        var qq = q(a.questionId);
        return '<li><button type="button" class="att-row" data-act="question" data-q="' + a.questionId + '">' +
          '<span class="att-type">' + esc(TYPE_LABEL[a.attemptType]) + '<span class="muted">' + U.fmtDateTime(a.answeredAt) + '</span></span>' +
          '<span class="att-q">' + esc(qq ? (qq.ja || qq.sentence) : a.questionId) + '<span class="muted att-ans" lang="en">' + esc(a.responseText || '（わからない）') + '</span></span>' +
          '<span class="att-tags">' + resultBadge(a.result) + flagsHtml(a) + '</span></button></li>';
      }).join('') + '</ul>' : '<p class="muted">まだ回答がありません。ホームから初回診断をはじめましょう。</p>';
    }
    return h;
  }

  /* ================= 画面：問題の詳細 ================= */
  function renderQuestion() {
    var qq = q(view.params.q);
    if (!qq) return renderHistory();
    var atts = state.attempts.filter(function (a) { return a.questionId === qq.id; }).reverse();
    return '<button type="button" class="btn-text back" data-act="back-history" data-skill="' + qq.skill + '">← 履歴・復習へ</button>' +
      '<p class="eyebrow">' + esc(skill(qq.skill).label) + ' ・ ' + esc(FORMAT_LABEL[qq.format]) + ' ・ ' + esc(qq.id) + '（版 ' + qq.version + '）</p>' +
      '<section class="sheet">' + questionPromptHtml(qq, null) +
      '<p class="muted">確認すること：' + esc(qq.checks) + '</p>' + explanationHtml(qq) + '</section>' +
      '<section class="panel"><div class="panel-head"><h2>過去の回答（' + atts.length + '回）</h2><p class="panel-note">解答時間は参考情報です。画面を離れていた時間は含めていません。</p></div>' +
      (atts.length ? '<div class="table-wrap"><table class="att-table"><thead><tr><th>日時</th><th>種類</th><th>答え</th><th>結果</th><th>時間</th></tr></thead><tbody>' + atts.map(function (a) {
        return '<tr><td class="num">' + U.fmtDateTime(a.answeredAt) + '</td><td>' + esc(TYPE_LABEL[a.attemptType]) + '</td><td lang="en">' + esc(a.responseText || '（わからない）') + '</td>' +
          '<td>' + resultBadge(a.result) + flagsHtml(a) + (M.isExcluded(a, BANK) ? '<span class="flag">判定から除外</span>' : '') + '</td>' +
          '<td class="num">' + U.fmtDuration(a.activeMs) + (a.awayMs > 1000 ? '<span class="muted">（離席 ' + U.fmtDuration(a.awayMs) + '）</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">まだ回答していません。</p>') + '</section>';
  }

  /* ================= 画面：設定 ================= */
  function renderSettings() {
    var goal = state.settings.dailyGoalMinutes;
    var confirming = view.params.confirmReset;
    var exported = view.params.exported;
    return '<h1 class="page-title">設定</h1>' +
      '<section class="panel"><div class="panel-head"><h2>毎日の目標</h2></div><div class="seg" role="radiogroup" aria-label="毎日の学習時間の目標">' +
      [5, 10, 15, 20, 30].map(function (m) { return '<button type="button" role="radio" aria-checked="' + (goal === m) + '" class="seg-item' + (goal === m ? ' is-current' : '') + '" data-act="goal" data-min="' + m + '">' + m + '分</button>'; }).join('') +
      '</div></section>' +
      '<section class="panel"><div class="panel-head"><h2>学習記録の保存について</h2></div><ul class="plain-list">' +
      '<li>記録はこの端末のこのブラウザの中だけに保存されます。ほかの端末・ほかのブラウザとは共有されません。</li>' +
      '<li>Safari の「履歴とWebサイトデータを消去」やプライベートブラウズでは、記録が消えることがあります。</li>' +
      '<li>現在の記録：回答 ' + state.attempts.length + '件 ・ 学習 ' + state.sessions.length + '回</li></ul>' +
      '<div class="actions-inline"><button type="button" class="btn-quiet" data-act="export">記録を書き出す（講師に送る用）</button></div>' +
      (exported ? '<label class="field-label" for="export-box">下の文字をすべてコピーして送ってください</label><textarea id="export-box" class="text-input mono" rows="6" readonly>' + esc(JSON.stringify({ exportedAt: new Date().toISOString(), attempts: state.attempts, schedule: state.schedule, sessions: state.sessions }, null, 1)) + '</textarea>' +
        '<div class="actions-inline"><button type="button" class="btn-quiet" data-act="copy-export">コピー</button><span class="muted" id="copy-msg"></span></div>' : '') +
      '</section>' +
      '<section class="panel dev"><div class="panel-head"><h2>開発・確認用：日付を進める</h2><p class="panel-note">後日の復習が予定どおり出るかを確かめるための機能です。生徒の通常利用では使いません。</p></div>' +
      '<p>アプリ内の今日：<strong>' + U.fmtDate(now()) + '</strong>' + (state.settings.devDayOffset ? '（実際より +' + state.settings.devDayOffset + '日）' : '（実際の日付）') + '</p>' +
      '<div class="actions-inline">' + [1, 3, 7].map(function (d) { return '<button type="button" class="btn-quiet" data-act="dev-add" data-days="' + d + '">+' + d + '日</button>'; }).join('') +
      '<button type="button" class="btn-quiet" data-act="dev-reset"' + (state.settings.devDayOffset ? '' : ' disabled') + '>実際の日付に戻す</button></div></section>' +
      '<section class="panel danger"><div class="panel-head"><h2>記録をすべて消す</h2></div>' +
      (confirming ? '<p><strong>本当に消しますか？</strong>回答・復習予定・途中の学習がすべて消え、元に戻せません。</p><div class="actions-inline"><button type="button" class="btn-danger" data-act="reset-do">すべて消す</button><button type="button" class="btn-quiet" data-act="reset-cancel">やめる</button></div>'
        : '<div class="actions-inline"><button type="button" class="btn-quiet" data-act="reset-ask">記録を消す…</button></div>') +
      '</section>';
  }

  /* ================= 描画と操作 ================= */
  function render() {
    var main;
    switch (view.name) {
      case 'units': main = renderUnits(); break;
      case 'session': main = renderSession(); break;
      case 'results': main = renderResults(); break;
      case 'summary': main = renderSummary(); break;
      case 'history': main = renderHistory(); break;
      case 'question': main = renderQuestion(); break;
      case 'settings': main = renderSettings(); break;
      default: main = renderHome();
    }
    var n = notice ? '<div class="toast" role="status">' + esc(notice) + '</div>' : '';
    notice = null;
    appEl.innerHTML = topbar() + '<main class="main view-' + view.name + '" id="main">' + n + main + '</main>';
    appEl.setAttribute('data-view', view.name);
    if (view.name === 'session') mountSessionWidgets();
  }

  function onClick(ev) {
    var el = ev.target.closest('[data-go],[data-act]');
    if (!el || el.disabled) return;
    if (el.hasAttribute('data-go')) { go(el.getAttribute('data-go')); return; }
    var act = el.getAttribute('data-act');
    var s = state.activeSession;
    var t = now();
    switch (act) {
      case 'task-resume': go('session'); break;
      case 'task-diagnostic': startSession(P.buildDiagnosticSession(BANK, t)); break;
      case 'task-practice': startSession(P.buildPracticeSession(state, BANK, t)); break;
      case 'task-review': startSession(P.buildReviewSession(state, BANK, t)); break;
      case 'skip-practice-later': notice = '診断の結果は保存しました。解説と類題はホームから始められます。'; go('home'); break;
      case 'skip-practice': P.unitState(state, BANK.unit.id).practiceSkippedAt = t; persist(); go('home'); break;
      case 'quit': quitSession(); break;
      case 'choose': s.current.draft = el.getAttribute('data-choice'); persist(); render(); break;
      case 'unsure': s.current.unsure = !s.current.unsure; persist(); render(); break;
      case 'hint': s.current.hintUsed = true; persist(); render(); break;
      case 'giveup': submitAnswer(true); break;
      case 'submit': submitAnswer(false); break;
      case 'reason': submitReason(el.getAttribute('data-choice')); break;
      case 'next': advance(); break;
      case 'skill': go('history', { tab: 'plan', skill: el.getAttribute('data-skill') }); scrollToSkill(el.getAttribute('data-skill')); break;
      case 'question': go('question', { q: el.getAttribute('data-q') }); break;
      case 'back-history': go('history', { tab: 'plan', skill: el.getAttribute('data-skill') }); scrollToSkill(el.getAttribute('data-skill')); break;
      case 'tab': go('history', { tab: el.getAttribute('data-tab') }); break;
      case 'goal': state.settings.dailyGoalMinutes = +el.getAttribute('data-min'); persist(); render(); break;
      case 'dev-add':
        state.settings.devDayOffset = (state.settings.devDayOffset || 0) + (+el.getAttribute('data-days'));
        EA.clock.offsetDays = state.settings.devDayOffset; persist(); render(); break;
      case 'dev-reset': state.settings.devDayOffset = 0; EA.clock.offsetDays = 0; persist(); render(); break;
      case 'export': view.params.exported = true; render(); break;
      case 'copy-export': copyExport(); break;
      case 'reset-ask': view.params.confirmReset = true; render(); break;
      case 'reset-cancel': view.params.confirmReset = false; render(); break;
      case 'reset-do':
        EA.storage.clear(); state = EA.storage.defaultState(); EA.clock.offsetDays = 0; persist();
        notice = '記録をすべて消しました。'; go('home'); break;
    }
  }

  function scrollToSkill(id) {
    var el = document.getElementById('skill-' + id);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }

  function copyExport() {
    var box = document.getElementById('export-box'), msg = document.getElementById('copy-msg');
    function fallback() { box.focus(); box.select(); msg.textContent = '選択しました。「コピー」を押してください。'; }
    try {
      navigator.clipboard.writeText(box.value).then(function () { msg.textContent = 'コピーしました。'; }, fallback);
    } catch (e) { fallback(); }
  }

  function boot() {
    appEl = document.getElementById('app');
    appEl.addEventListener('click', onClick);
    persist(); // 保存できるかを最初に確かめる
    render();
  }

  // テストや開発用に中身を見られるようにしておく
  EA.app = { getState: function () { return state; }, go: go };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
