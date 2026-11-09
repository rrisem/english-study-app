/*
 * app.js — 画面の表示と操作だけを扱います（判定・出題・保存のルールは他のファイル）
 *   採点 grading.js / 確認状況 mastery.js / 復習予定 scheduler.js / 出題 planner.js /
 *   学習回の進行 session.js / 保存 storage.js
 * デザインを変えるときは、このファイルと css/app.css だけを直せば済むようにしています。
 */
(function (root) {
  'use strict';
  var EA = root.EA;
  var U = EA.util, G = EA.grading, M = EA.mastery, P = EA.planner, S = EA.session;
  var esc = U.esc;
  var BANK = EA.banks.infinitive;

  var loaded = EA.storage.load();
  var state = loaded.state;
  var readOnly = loaded.readOnly;
  var loadMessage = loaded.message || '';
  var saveOk = true;
  var view = { name: 'home', params: {} };
  var appEl = null;
  var notice = null;
  // 表示だけの状態（保存しない）：進捗バーの直前の値（動きの起点）と、連続タップを無視する期限
  var progressShown = { sessionId: null, pct: 0 };
  var tapGuardUntil = 0;
  var TAP_GUARD_MS = 250;

  var TYPE_LABEL = { diagnostic: '初回診断', retry: '解き直し', similar: '類題', followup: '確認問題', review: '復習' };
  var SESSION_LABEL = { diagnostic: '初回診断', practice: '解説と類題', review: '復習' };
  var FORMAT_LABEL = { fill: '空所補充', order: '並び替え', ja2en: '日本語→英語', meaning: '意味の確認' };

  function syncClock() { EA.clock.offsetDays = state.mode === 'demo' && state.demo ? state.demo.dayOffset : 0; }
  syncClock();
  function now() { return EA.clock.now(); }
  function T() { return { app: EA.clock.now(), real: Date.now() }; }
  function persist() {
    saveOk = readOnly ? false : EA.storage.save(state);
    return saveOk;
  }
  function q(id) { return EA.findQuestion(BANK, id); }
  function skill(id) { return EA.findSkill(BANK, id); }
  function attemptById(id) { return S.attemptById(state, id); }

  function go(name, params) {
    view = { name: name, params: params || {} };
    render();
    try { root.scrollTo(0, 0); } catch (e) { /* 無視 */ }
  }

  document.addEventListener('visibilitychange', function () {
    var s = state.activeSession;
    if (!s || !s.current) return;
    if (document.hidden) S.pause(s.current, Date.now()); else S.resume(s.current, Date.now());
    persist();
  });
  root.addEventListener('pagehide', function () {
    var s = state.activeSession;
    if (s && s.current) { S.pause(s.current, Date.now()); persist(); }
  });

  /* ================= 学習の流れ（進行は session.js） ================= */
  function startSession(session) {
    var rec = S.start(state, BANK, session, T());
    persist();
    if (rec) go('summary', { sessionId: rec.id }); else go('session');
  }
  function afterProgress(rec) {
    persist();
    if (rec) go(rec.type === 'diagnostic' ? 'results' : 'summary', { sessionId: rec.id });
    else go('session');
  }
  function quitSession() {
    var s = state.activeSession;
    if (s && s.current) S.pause(s.current, Date.now());
    var ok = persist();
    notice = ok ? '途中まで保存しました。ホームの「続きから再開」で戻れます。' : '記録を保存できませんでした。画面を閉じると、この学習の記録は失われます。';
    go('home');
  }
  function stopForToday() {
    var s = state.activeSession;
    if (s && s.current) S.pause(s.current, Date.now());
    var rec = S.finish(state, BANK, T(), { early: true });
    persist();
    go('summary', { sessionId: rec.id });
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
    if (a.afterExplanation && a.attemptType !== 'retry') f.push('<span class="flag">解説後</span>');
    if (a.reason) f.push('<span class="flag' + (a.reason.correct ? '' : ' flag-warn') + '">意味の問い ' + (a.reason.correct ? '○' : '×') + (a.reason.independent === false ? '（参考）' : '') + '</span>');
    if (a.devDated) f.push('<span class="flag">開発用の日付</span>');
    return f.join('');
  }

  function achievementMeter(level) {
    var h = '<span class="meter" aria-hidden="true">';
    for (var i = 1; i <= 3; i++) h += '<span class="meter-seg' + (i <= level ? ' on' : '') + '"></span>';
    return h + '</span>';
  }

  /** 確認状況の短い表示：実績（メーター）＋ 現在の状態（ことば） */
  function statusInline(st) {
    return '<span class="status-inline">' + achievementMeter(st.achievement) +
      '<span class="status-text tone-text-' + st.tone + '">' + (st.tone === 'recheck' ? '<span aria-hidden="true">！ </span>' : '') + esc(st.headline) + '</span></span>';
  }

  function explanationHtml(qq, opts) {
    var e = qq.explanation;
    opts = opts || {};
    var sentence = e.chunks.map(function (c) { return c.mark ? '<mark>' + esc(c.en) + '</mark>' : esc(c.en); }).join(' ');
    var lastPunct = /[.?!]$/.test(e.answer) ? e.answer.slice(-1) : '';
    var rows = e.chunks.map(function (c) {
      return '<li class="' + (c.mark ? 'is-mark' : '') + '"><span class="ex-en" lang="en">' + esc(c.en) + '</span>' +
        '<span class="ex-arrow" aria-hidden="true">→</span><span class="ex-ja">' + esc(c.ja) + '</span></li>';
    }).join('');
    return '<div class="explain' + (opts.bare ? ' explain-bare' : '') + '">' +
      (opts.bare ? '' : '<p class="eyebrow">解説</p>') +
      '<p class="ex-answer" lang="en">' + sentence + esc(lastPunct) + '</p>' +
      '<p class="ex-translation">' + esc(e.translation) + '</p>' +
      (e.also ? '<p class="ex-also">' + esc(e.also) + '</p>' : '') +
      '<ol class="ex-map" aria-label="どの部分が、どの意味につながるか">' + rows + '</ol>' +
      '<p class="ex-point">' + esc(e.point) + '</p>' +
      '<p class="ex-term"><span class="label">文法の名前</span>' + esc(e.term) + '</p>' +
      '</div>';
  }

  function basicsHtml(sk) {
    var b = sk.basics;
    var ex = esc(b.example).replace(esc(b.mark), '<mark>' + esc(b.mark) + '</mark>');
    return '<div class="basics"><p class="eyebrow">基本にもどる：' + esc(sk.label) + '</p>' +
      '<p class="ex-answer" lang="en">' + ex + '</p><p>' + esc(b.exampleJa) + '</p><p class="ex-point">' + esc(b.point) + '</p></div>';
  }

  /**
   * 問題文。opts.hideJa のときは英文全体の日本語訳を出さない
   * （訳なしで出題する問題の回答中、および理由・意味の問いに答える前）
   */
  function questionPromptHtml(qq, draftChoice, opts) {
    opts = opts || {};
    var h = opts.noInstruction ? '' : '<p class="q-instruction">' + esc(qq.instruction) + '</p>';
    if (qq.format === 'meaning') {
      h += '<p class="q-sentence" lang="en">' + esc(qq.sentence) + '</p>';
      h += '<p class="q-ja q-question">' + esc(qq.question) + '</p>';
    } else {
      if (!opts.hideJa) h += '<p class="q-ja">' + esc(qq.ja) + '</p>';
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
    var inSession = view.name === 'session' && state.activeSession;
    var navItems = [['home', 'ホーム'], ['units', '単元'], ['history', '履歴・復習'], ['settings', '設定']];
    var nav = inSession ? '' : '<nav class="nav" aria-label="メニュー">' + navItems.map(function (n) {
      var cur = view.name === n[0] || (n[0] === 'history' && view.name === 'question');
      return '<button type="button" class="nav-item' + (cur ? ' is-current' : '') + '" data-go="' + n[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + n[1] + '</button>';
    }).join('') + '</nav>';
    var sessionBtns = '';
    if (inSession) {
      sessionBtns = state.activeSession.type === 'diagnostic'
        ? '<button type="button" class="btn-quiet" data-act="quit">中断（続きはあとで）</button>'
        : '<button type="button" class="btn-quiet" data-act="quit">中断</button><button type="button" class="btn-quiet" data-act="stop-today">今日はここまで</button>';
    }
    var bars = '';
    if (state.mode === 'demo') {
      bars += '<div class="devbar" role="status"><strong>デモモード</strong>（通常の学習記録とは別に保存。終えると消えます）・アプリ内の日付：' + U.fmtDate(now()) +
        (state.demo.dayOffset ? '（+' + state.demo.dayOffset + '日）' : '') + '</div>';
    }
    if (loadMessage) bars += '<div class="warnbar" role="alert">' + esc(loadMessage) + ' <button type="button" class="btn-text" data-act="dismiss-load">閉じる</button></div>';
    if (!saveOk) bars += '<div class="warnbar" role="alert">' + (readOnly ? '元のデータを守るため、記録を保存していません。' : '直近の記録を保存できませんでした（容量不足など）。この画面を閉じると、保存されていない回答は失われます。') + '</div>';
    return '<header class="topbar"><div class="topbar-inner">' +
      '<div class="brand"><span class="brand-mark" aria-hidden="true">to</span><span class="brand-name">英文法ドリル</span></div>' +
      nav + (sessionBtns ? '<div class="session-btns">' + sessionBtns + '</div>' : '') +
      '</div></header>' + bars;
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
    var studyMs = todayStudyMs();
    var studyMin = Math.floor(studyMs / 60000);
    var goal = state.settings.dailyGoalMinutes;
    var pct = Math.min(100, Math.round(studyMs / 60000 / goal * 100));
    var due = P.dueReviews(state, BANK, t);
    var scheduled = BANK.skills.filter(function (sk) { return state.schedule[sk.id]; }).length;
    var next = P.nextReviewDate(state, BANK);
    var statuses = BANK.skills.map(function (sk) { return M.analyze(sk.id, state.attempts, BANK); });
    var recheckN = statuses.filter(function (s) { return s.needsRecheck; }).length;

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
      '<div class="stat"><p class="stat-label">再確認が必要な項目</p><p class="stat-value"><span class="num">' + recheckN + '</span><span class="stat-sub"> ／ ' + BANK.skills.length + ' 項目</span></p>' +
        '<p class="stat-note">復習のときに別の問題で確かめます</p></div>' +
      '</section>';

    h += '<section class="panel"><div class="panel-head"><h2>確認状況</h2><p class="panel-note">■の数＝これまでの確認実績（1問自力・別の問題でも・後日の復習でも）。アプリ内の記録で、習得の保証ではありません。</p></div><ul class="skill-list">' +
      BANK.skills.map(function (sk, i) {
        var st = statuses[i];
        var sch = state.schedule[sk.id];
        return '<li><button type="button" class="skill-row" data-act="skill" data-skill="' + sk.id + '">' +
          '<span class="skill-name"><span class="skill-label">' + esc(sk.label) + '</span><span class="skill-term">' + esc(sk.term) + '</span></span>' +
          statusInline(st) +
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
    // 進捗＝この学習回で終えた項目の数 ÷ 全項目（既存の定義）。答えを確定して正誤を表示した時点で、その項目を「終えた」に数える
    var done = s.index + (s.current && s.current.index === s.index && s.current.phase === 'feedback' ? 1 : 0);
    var pct = Math.round(done / total * 100);
    var fromPct = progressShown.sessionId === s.id ? progressShown.pct : pct;
    progressShown = { sessionId: s.id, pct: pct };
    var progress = '<div class="q-progress"><span class="q-type">' + esc(SESSION_LABEL[s.type]) + '</span>' +
      '<span class="q-count">' + (s.index + 1) + ' / ' + total + '</span>' +
      '<span class="q-bar" role="progressbar" aria-label="この学習の進み具合（終えた項目）" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + done + '">' +
      '<span class="q-bar-fill" data-to="' + pct + '" style="width:' + fromPct + '%"></span></span></div>';

    if (item.kind === 'explain') {
      var qq = q(item.questionId), src = attemptById(item.sourceAttemptId);
      var nextIt = s.items[s.index + 1];
      return progress + '<section class="sheet">' +
        '<p class="eyebrow">診断の問題（' + esc(FORMAT_LABEL[qq.format]) + '）の解説</p>' +
        questionPromptHtml(qq, null) +
        (src ? '<div class="your-answer"><span class="label">あなたの答え</span><span lang="en">' + (src.responseText ? esc(src.responseText) : '（なし）') + '</span>' + resultBadge(src.result) + flagsHtml(src) + '</div>' : '') +
        (src && src.feedback ? '<p class="feedback-note">' + esc(src.feedback) + '</p>' : '') +
        explanationHtml(qq) +
        '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="next">' +
        (nextIt && nextIt.attemptType === 'retry' ? '答えを隠して解き直す' : nextIt ? '次へ（別の問題で確かめる）' : '次へ') + '</button></div>' +
        '</section>';
    }

    var qq2 = q(item.questionId);
    var cur = S.ensureCurrent(state, BANK, T());
    var typeNote = {
      diagnostic: '解説は全問に答えたあとに表示します。',
      retry: '解説を読んだ直後の解き直しです（類題とは別に記録します）。',
      similar: '単語や場面を変えた類題です。',
      followup: '前の問題でつまずいた内容を、別の問題で確かめます。',
      review: '復習です。答えを見ずに思い出してみましょう。'
    }[item.attemptType];

    var body = '<section class="sheet" aria-live="polite">' +
      '<p class="eyebrow">' + esc(TYPE_LABEL[item.attemptType]) + ' ・ ' + esc(FORMAT_LABEL[qq2.format]) + '<span class="eyebrow-note">' + esc(typeNote) + '</span></p>';

    if (cur.phase === 'answer') {
      body += questionPromptHtml(qq2, cur.draft, { hideJa: qq2.showJa === 'after' }) + '<div class="answer-area" id="answer-area">' + answerControlHtml(qq2, cur) + '</div>';
      if (cur.hintUsed) body += '<div class="hint" role="note"><span class="label">ヒント</span>' + esc(qq2.hint) + '</div>';
      body += '<div class="helpers">' +
        '<button type="button" class="btn-toggle" data-act="unsure" aria-pressed="' + (cur.unsure ? 'true' : 'false') + '">' +
          '<span class="toggle-box" aria-hidden="true">' + (cur.unsure ? '✓' : '') + '</span>自信がない</button>' +
        '<button type="button" class="btn-quiet" data-act="hint"' + (cur.hintUsed ? ' disabled' : '') + '>ヒントを見る</button>' +
        '<button type="button" class="btn-quiet" data-act="giveup">わからない</button>' +
        '<span class="helpers-note">どれも押さなくてかまいません。押しても減点はありません。ヒントを見た場合は「ヒントあり」と記録します。</span>' +
        '</div>' +
        '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="submit" id="submit-btn"' + (hasDraft(qq2, cur) ? '' : ' disabled') + '>回答を確定</button></div>';
    } else {
      var a = attemptById(cur.attemptId);
      if (cur.phase === 'reason') {
        // 理由・意味の問いに答えるまでは、日本語訳・正答・正誤・解説を出さない（あなたの答えだけを英文で示す）
        body += questionPromptHtml(qq2, qq2.format === 'fill' ? a.response : null, { hideJa: true, noInstruction: true });
        if (qq2.format !== 'fill') body += '<div class="your-answer"><span class="label">あなたの答え</span><span lang="en">' + esc(a.responseText) + '</span></div>';
        body += '<div class="reason"><p class="reason-q"><span class="label">意味の問い</span>' + esc(qq2.reason.prompt) + '</p>' +
          '<p class="reason-note">日本語訳・正誤・解説は、この問いに答えたあとに表示します。</p><div class="choices">' +
          ordered(qq2.reason.choices, cur.reasonOrder).map(function (c) { return '<button type="button" class="choice" data-act="reason" data-choice="' + c.id + '">' + esc(c.text) + '</button>'; }).join('') +
          '</div></div>';
      } else {
        body += questionPromptHtml(qq2, qq2.format === 'fill' ? a.response : null);
        if (qq2.choices) body += resultChoicesHtml(qq2, a, cur);
        else body += '<div class="your-answer"><span class="label">あなたの答え</span><span lang="en">' + (a.responseText ? esc(a.responseText) : '（わからない）') + '</span></div>';
        body += '<div class="verdict"><span class="label">答え</span>' + resultBadge(a.result) + flagsHtml(a) + '</div>';
        if (a.feedback) body += '<p class="feedback-note">' + esc(a.feedback) + '</p>';
        if (a.reason) {
          var rc = null; qq2.reason.choices.forEach(function (c) { if (c.id === qq2.reason.answer) rc = c; });
          body += '<div class="reason-result"><span class="label">意味の問い</span>' +
            (a.reason.correct ? '○ 選んだ意味は合っています。' : '× 選んだ意味とは違います。答えは正解なので、意味をもう一度確かめましょう。') +
            (a.reason.independent === false ? '<span class="reason-correct">日本語訳や解説を見たあとの回答なので、考え方の参考として記録します。</span>' : '') +
            '<span class="reason-correct">この文では：' + esc(rc.text) + '</span></div>';
        }
        if (a.followUp) {
          body += '<div class="next-note" role="note">' + (a.followUp.added
            ? '<strong>このあと、単語や場面を変えた問題でもう一度確かめます。</strong>'
            : esc(a.followUp.why)) + '</div>';
          if (a.followUp.basics) body += basicsHtml(skill(a.skillId));
        }
        body += collapsibleExplanationHtml(qq2);
        body += '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="next">' + (s.index + 1 >= total ? '結果を見る' : '次へ') + '</button></div>';
      }
    }
    return progress + body + '</section>';
  }

  /**
   * 採点後の選択肢：色だけでなく記号と文字で示す。
   *   正答 …「✓ 正解」／ 選んだ誤答 …「× あなたの答え」／ 選んで正解 …「✓ 正解・あなたの答え」
   * 採点後は押せない（選び直しはできない）。
   */
  function resultChoicesHtml(qq, a, cur) {
    var chosen = a.gaveUp ? null : a.response;
    return '<ul class="choices choices-result" aria-label="採点結果">' + ordered(qq.choices, cur.choiceOrder).map(function (c) {
      var isAns = c.id === qq.answer, isMine = c.id === chosen;
      var cls = isAns ? 'is-correct' : (isMine ? 'is-wrong' : 'is-other');
      var tag = isAns && isMine ? '✓ 正解・あなたの答え' : isAns ? '✓ 正解' : isMine ? '× あなたの答え' : '';
      return '<li class="choice choice-result ' + cls + '"' + (qq.format === 'fill' ? ' lang="en"' : '') + '>' +
        '<span class="result-icon" aria-hidden="true">' + (isAns ? '✓' : isMine ? '×' : '') + '</span>' +
        '<span class="choice-text">' + esc(c.text) + '</span>' +
        (tag ? '<span class="result-tag" lang="ja">' + tag + '</span>' : '') + '</li>';
    }).join('') + '</ul>' + (a.gaveUp ? '<p class="your-answer"><span class="label">あなたの答え</span>（わからない）</p>' : '');
  }

  /**
   * 開閉できる解説。最初は開いた状態。高さの上限を設けないので長い解説も欠けない。
   * 開閉の動きの途中でも中身は読める・押せる（visibility は閉じ終わったときだけ hidden になる）。
   */
  function collapsibleExplanationHtml(qq) {
    return '<section class="explain-block">' +
      '<button type="button" class="explain-toggle" data-act="toggle-explain" aria-expanded="true" aria-controls="ex-body">' +
      '<span class="explain-toggle-label">解説</span><span class="explain-toggle-state">とじる</span>' +
      '<span class="explain-chevron" aria-hidden="true"></span></button>' +
      '<div class="collapse is-open" id="ex-body"><div class="collapse-inner">' + explanationHtml(qq, { bare: true }) + '</div></div>' +
      '</section>';
  }

  /** 選択肢を、学習回の中で決めた順番（正答の位置が毎回変わる）に並べる */
  function ordered(choices, order) {
    if (!order) return choices;
    var byId = {};
    choices.forEach(function (c) { byId[c.id] = c; });
    var out = order.map(function (id) { return byId[id]; }).filter(Boolean);
    return out.length === choices.length ? out : choices;
  }

  function hasDraft(qq, cur) {
    if (qq.format === 'order') return !!(cur.draft && cur.draft.length === qq.tokens.length);
    if (qq.format === 'ja2en') return !!(cur.draft && cur.draft.trim());
    return !!cur.draft;
  }

  function answerControlHtml(qq, cur) {
    if (qq.format === 'fill' || qq.format === 'meaning') {
      return '<div class="choices" role="radiogroup" aria-label="選択肢">' + ordered(qq.choices, cur.choiceOrder).map(function (c) {
        var on = cur.draft === c.id;
        return '<button type="button" role="radio" aria-checked="' + on + '" class="choice' + (on ? ' is-selected' : '') + '" data-act="choose" data-choice="' + c.id + '"' + (qq.format === 'fill' ? ' lang="en"' : '') + '>' +
          '<span class="choice-dot" aria-hidden="true"></span>' + esc(c.text) + '</button>';
      }).join('') + '</div>';
    }
    if (qq.format === 'order') return '<div id="order-mount" lang="en"></div>';
    if (qq.format === 'ja2en') {
      return '<label class="field-label" for="ja2en-input">英文を入力</label>' +
        '<textarea id="ja2en-input" class="text-input" rows="2" lang="en" autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" placeholder="ここに英文を書きます">' + esc(cur.draft || '') + '</textarea>' +
        '<p class="field-note">大文字・小文字、余分な空白、文末の「.」の有無は採点に影響しません。登録されていない答えは「採点保留」になり、誤りとはしません。</p>';
    }
    return '';
  }

  /** 選択肢をタップしたとき：画面全体を描き直さず、その場で選択状態だけを変える（すぐに反応が見えるように） */
  function selectChoice(id) {
    var s = state.activeSession;
    if (!s || !s.current || s.current.phase !== 'answer') return;
    var qq = q(s.items[s.index].questionId);
    s.current.draft = id;
    var btns = appEl.querySelectorAll('[data-act="choose"]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-choice') === id;
      btns[i].classList.toggle('is-selected', on);
      btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var blank = appEl.querySelector('.q-sentence .blank');
    if (blank && qq.format === 'fill') {
      var text = ''; qq.choices.forEach(function (c) { if (c.id === id) text = c.text; });
      blank.textContent = text;
      blank.classList.add('filled');
    }
    var submit = document.getElementById('submit-btn');
    if (submit) submit.disabled = false;
    schedulePersist();
  }

  /** 選択の途中経過は、表示が変わったあとで保存する（画面を閉じるときは pagehide でも保存） */
  var persistTimer = null;
  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(function () { persistTimer = null; persist(); }, 0);
  }

  /** 解説の開閉（表示だけ。保存しない） */
  function toggleExplanation(btn) {
    var body = document.getElementById(btn.getAttribute('aria-controls'));
    var open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.querySelector('.explain-toggle-state').textContent = open ? 'とじる' : 'ひらく';
    body.classList.toggle('is-open', open);
  }

  /** 進捗バー：直前の値から新しい値へ動かす（表示だけ。記録はすでに保存済み） */
  function animateProgress() {
    var fill = appEl.querySelector('.q-bar-fill');
    if (!fill) return;
    var to = fill.getAttribute('data-to') + '%';
    if (fill.style.width === to) return;
    fill.getBoundingClientRect(); // 起点の幅を確定させてから変える
    root.requestAnimationFrame(function () { fill.style.width = to; });
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
  function sessionRecord(id) {
    for (var i = state.sessions.length - 1; i >= 0; i--) if (state.sessions[i].id === id) return state.sessions[i];
    return null;
  }

  function renderResults() {
    var rec = sessionRecord(view.params.sessionId);
    if (!rec) return renderHome();
    var atts = rec.attemptIds.map(attemptById).filter(Boolean);
    var solid = atts.filter(M.isSolid).length;
    var flagged = atts.filter(P.needsFollowUp).length;
    var h = '<p class="eyebrow">初回診断の結果</p><h1 class="page-title">' + atts.length + '問中、ヒントなし・自信がないの申告なしで正解 ' + solid + '問</h1>' +
      '<p class="lead">この6問だけで不定詞全体の理解は判断できません。気になる回答があった問題の解説を読み、別の問題で確かめます。</p>';
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

  /* ================= 画面：学習のまとめ ================= */
  function renderSummary() {
    var rec = sessionRecord(view.params.sessionId);
    if (!rec) return renderHome();
    var t = now();
    var atts = rec.attemptIds.map(attemptById).filter(Boolean);
    var h = '<p class="eyebrow">' + esc(SESSION_LABEL[rec.type]) + 'のまとめ' + (rec.endedEarly ? '（今日はここまで）' : '') + '</p><h1 class="page-title">おつかれさまでした</h1>';
    if (atts.length) {
      h += '<section class="panel"><div class="panel-head"><h2>今回の回答</h2></div><ul class="att-list">' + atts.map(function (a) {
        var qq = q(a.questionId);
        return '<li><button type="button" class="att-row" data-act="question" data-q="' + qq.id + '">' +
          '<span class="att-type">' + esc(TYPE_LABEL[a.attemptType]) + '</span>' +
          '<span class="att-q">' + esc(qq.ja || qq.sentence) + '</span>' +
          '<span class="att-tags">' + resultBadge(a.result) + flagsHtml(a) + '</span></button></li>';
      }).join('') + '</ul></section>';
    }
    if ((rec.unresolved || []).length) {
      h += '<section class="panel"><div class="panel-head"><h2>次回にもちこす内容</h2><p class="panel-note">確認済みにはしていません。次の復習で、別の問題で確かめます。</p></div><ul class="plain-list">' +
        rec.unresolved.map(function (u) { return '<li><strong>' + esc(skill(u.skillId).label) + '</strong>：' + esc(u.why) + '</li>'; }).join('') + '</ul></section>';
    }
    h += '<section class="panel"><div class="panel-head"><h2>確認状況と次の復習</h2></div><ul class="plan-list">' +
      BANK.skills.map(function (sk) {
        var st = M.analyze(sk.id, state.attempts, BANK);
        var sch = state.schedule[sk.id];
        var ch = (rec.scheduleChanges || []).filter(function (c) { return c.skillId === sk.id; })[0];
        return '<li><div class="plan-name"><span class="skill-label">' + esc(sk.label) + '</span><span class="skill-term">' + esc(sk.term) + '</span></div>' +
          '<div class="plan-status">' + statusInline(st) + '</div>' +
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
    var tabs = [['plan', '復習予定と確認状況'], ['answers', '回答履歴']];
    var h = '<h1 class="page-title">履歴・復習</h1><div class="tabs" role="tablist">' + tabs.map(function (x) {
      return '<button type="button" role="tab" aria-selected="' + (tab === x[0]) + '" class="tab' + (tab === x[0] ? ' is-current' : '') + '" data-act="tab" data-tab="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';

    if (tab === 'plan') {
      h += BANK.skills.map(function (sk) {
        var st = M.analyze(sk.id, state.attempts, BANK);
        var sch = state.schedule[sk.id];
        var open = view.params.skill === sk.id;
        var qs = BANK.questions.filter(function (x) { return x.skill === sk.id; });
        var meaningText = { confirmed: '訳を見ずに確認できた', recheck: '再確認が必要', reference: '訳・解説を見たあとの回答のみ（参考）', unchecked: 'まだ確認していない' }[st.meaning];
        return '<section class="panel skill-panel" id="skill-' + sk.id + '"><div class="skill-panel-head">' +
          '<div><h2>' + esc(sk.label) + '<span class="skill-term">' + esc(sk.term) + '</span></h2><p class="muted">' + esc(sk.plain) + '</p></div>' +
          '<div class="skill-panel-due">' + (sch ? '<span class="label">次の復習</span><strong>' + U.fmtDate(sch.dueAt) + '</strong><span class="muted">' + U.relDay(sch.dueAt, t) + ' ・ 間隔 ' + sch.intervalDays + '日</span>' : '<span class="muted">予定なし（診断前）</span>') + '</div></div>' +
          '<dl class="status-grid">' +
            '<dt>いまの状態</dt><dd class="tone-text-' + st.tone + '">' + esc(st.headline) + '</dd>' +
            '<dt>これまでの確認実績</dt><dd>' + achievementMeter(st.achievement) + ' ' + esc(st.achievementLabel) + '</dd>' +
            '<dt>意味の確認</dt><dd>' + esc(meaningText) + '</dd>' +
          '</dl>' +
          (st.issues.length ? '<ul class="issue-list">' + st.issues.map(function (i) {
            return '<li><strong>' + esc(i.label) + '</strong>（' + U.fmtDate(i.since) + '〜）<span class="muted">' + esc(i.rule) + '</span></li>';
          }).join('') + (st.teacherCandidate ? '<li><strong>講師に相談する候補</strong><span class="muted">同じ内容で2回以上つまずいています。</span></li>' : '') + '</ul>' : '') +
          '<details' + (open ? ' open' : '') + '><summary>判定の根拠</summary><ul class="evidence">' + st.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul></details>' +
          (sch && sch.history ? '<details><summary>復習予定が決まった理由</summary><ul class="sched-history">' + sch.history.slice().reverse().map(function (x) {
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
          '<span class="att-type">' + esc(TYPE_LABEL[a.attemptType] || a.attemptType) + '<span class="muted">' + U.fmtDateTime(a.answeredAt) + '</span></span>' +
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
      '<p class="muted">確認すること：' + esc(qq.checks) + '</p>' + explanationHtml(qq) +
      ((qq.changes || []).length ? '<details><summary>問題の修正履歴</summary><ul class="plain-list">' + qq.changes.map(function (c) { return '<li>版' + c.version + '：' + esc(c.what) + '。過去の記録：' + esc(c.oldRecords) + '</li>'; }).join('') + '</ul></details>' : '') +
      '</section>' +
      '<section class="panel"><div class="panel-head"><h2>過去の回答（' + atts.length + '回）</h2><p class="panel-note">解答時間は参考情報です。画面を離れていた時間は含めていません。</p></div>' +
      (atts.length ? '<div class="table-wrap"><table class="att-table"><thead><tr><th>日時</th><th>種類</th><th>答え</th><th>結果</th><th>時間</th></tr></thead><tbody>' + atts.map(function (a) {
        return '<tr><td class="num">' + U.fmtDateTime(a.answeredAt) + '<span class="muted">版' + a.questionVersion + '</span></td><td>' + esc(TYPE_LABEL[a.attemptType] || a.attemptType) + '</td><td lang="en">' + esc(a.responseText || '（わからない）') + '</td>' +
          '<td>' + resultBadge(a.result) + flagsHtml(a) + (M.isExcluded(a, BANK) ? '<span class="flag">判定から除外</span>' : '') + '</td>' +
          '<td class="num">' + U.fmtDuration(a.activeMs) + (a.awayMs > 1000 ? '<span class="muted">（離席 ' + U.fmtDuration(a.awayMs) + '）</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">まだ回答していません。</p>') + '</section>';
  }

  /* ================= 画面：設定 ================= */
  function renderSettings() {
    var goal = state.settings.dailyGoalMinutes;
    var p = view.params;
    var demo = state.mode === 'demo';
    var h = '<h1 class="page-title">設定</h1>' +
      '<section class="panel"><div class="panel-head"><h2>毎日の目標</h2></div><div class="seg" role="radiogroup" aria-label="毎日の学習時間の目標">' +
      [5, 10, 15, 20, 30].map(function (m) { return '<button type="button" role="radio" aria-checked="' + (goal === m) + '" class="seg-item' + (goal === m ? ' is-current' : '') + '" data-act="goal" data-min="' + m + '">' + m + '分</button>'; }).join('') +
      '</div></section>' +
      '<section class="panel"><div class="panel-head"><h2>学習記録の保存について</h2></div><ul class="plain-list">' +
      '<li>記録はこのiPadのこのブラウザの中だけに保存されます。ほかの端末・ほかのブラウザとは共有されません。</li>' +
      '<li>同じiPadを複数の人が使うと、記録は1人分として混ざります。</li>' +
      '<li>Safari の「履歴とWebサイトデータを消去」やプライベートブラウズでは、記録が消えることがあります。</li>' +
      '<li>現在の記録' + (demo ? '（デモ）' : '') + '：回答 ' + state.attempts.length + '件 ・ 学習 ' + state.sessions.length + '回</li></ul>' +
      '<div class="actions-inline"><button type="button" class="btn-quiet" data-act="export">記録を書き出す（講師に送る用）</button></div>' +
      (p.exported ? '<label class="field-label" for="export-box">下の文字をすべてコピーして送ってください</label><textarea id="export-box" class="text-input mono" rows="6" readonly>' + esc(JSON.stringify({ exportedAt: new Date().toISOString(), mode: state.mode, schemaVersion: state.schemaVersion, attempts: state.attempts, schedule: state.schedule, sessions: state.sessions, migrations: state.migrations }, null, 1)) + '</textarea>' +
        '<div class="actions-inline"><button type="button" class="btn-quiet" data-act="copy-export">コピー</button><span class="muted" id="copy-msg"></span></div>' : '') +
      '</section>';

    if (demo) {
      h += '<section class="panel dev"><div class="panel-head"><h2>デモモード：日付を進める</h2><p class="panel-note">後日の復習が出るかを確かめるための機能です。通常の記録には影響しません。</p></div>' +
        '<p>アプリ内の今日：<strong>' + U.fmtDate(now()) + '</strong>' + (state.demo.dayOffset ? '（実際より +' + state.demo.dayOffset + '日）' : '（実際の日付）') + '</p>' +
        '<div class="actions-inline">' + [1, 3, 7].map(function (d) { return '<button type="button" class="btn-quiet" data-act="dev-add" data-days="' + d + '">+' + d + '日</button>'; }).join('') + '</div>' +
        '<div class="actions-inline"><button type="button" class="btn-primary" data-act="demo-exit">デモを終えて通常の記録に戻る（デモの記録は消えます）</button></div></section>';
    } else {
      h += '<details class="panel dev"><summary>講師・開発者向け：動作確認用デモモード</summary>' +
        '<p>デモモードでは、通常とは別の保存領域を使い、日付を進めて復習の動きを確かめられます。通常の学習記録は変わりません。デモを終えると、デモの記録は消えます。</p>' +
        '<div class="actions-inline"><button type="button" class="btn-quiet" data-act="demo-enter">デモモードを始める</button></div></details>';
      h += '<section class="panel danger"><div class="panel-head"><h2>記録をすべて消す</h2></div>' +
        (p.confirmReset ? '<p><strong>本当に消しますか？</strong>回答・復習予定・途中の学習がすべて消え、元に戻せません。</p><div class="actions-inline"><button type="button" class="btn-danger" data-act="reset-do">すべて消す</button><button type="button" class="btn-quiet" data-act="reset-cancel">やめる</button></div>'
          : '<div class="actions-inline"><button type="button" class="btn-quiet" data-act="reset-ask">記録を消す…</button></div>') +
        '</section>';
    }
    return h;
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
    appEl.setAttribute('data-mode', state.mode);
    if (view.name === 'session') { mountSessionWidgets(); animateProgress(); }
  }

  function reloadFrom(result) {
    state = result.state; readOnly = result.readOnly; loadMessage = result.message || '';
    syncClock(); saveOk = true;
  }

  var GUARDED = { submit: 1, giveup: 1, reason: 1, next: 1 };

  function onClick(ev) {
    var el = ev.target.closest('[data-go],[data-act]');
    if (!el || el.disabled) return;
    if (el.hasAttribute('data-go')) { go(el.getAttribute('data-go')); return; }
    var act = el.getAttribute('data-act');
    var s = state.activeSession;
    var t = T();
    // 画面が切り替わった直後の連続タップ（二重タップ）は無視する。
    // 前の画面へのタップが、新しく出たボタン（次へ・次の問題の選択肢など）に当たるのを防ぐ
    if (GUARDED[act]) {
      if (Date.now() < tapGuardUntil) return;
    }
    switch (act) {
      case 'task-resume': go('session'); break;
      case 'task-diagnostic': startSession(P.buildDiagnosticSession(BANK, t.app)); break;
      case 'task-practice': startSession(P.buildPracticeSession(state, BANK, t.app)); break;
      case 'task-review': startSession(P.buildReviewSession(state, BANK, t.app)); break;
      case 'skip-practice-later': notice = '診断の結果は記録しました。解説と類題はホームから始められます。'; go('home'); break;
      case 'skip-practice': P.unitState(state, BANK.unit.id).practiceSkippedAt = t.app; persist(); go('home'); break;
      case 'quit': quitSession(); break;
      case 'stop-today': stopForToday(); break;
      case 'choose': selectChoice(el.getAttribute('data-choice')); break;
      case 'toggle-explain': toggleExplanation(el); break;
      case 'unsure': s.current.unsure = !s.current.unsure; persist(); render(); break;
      case 'hint': s.current.hintUsed = true; persist(); render(); break;
      case 'giveup':
      case 'submit': {
        el.disabled = true;
        var res = S.submit(state, BANK, act === 'giveup', t);
        if (!res) break; // すでに確定済み（二重確定は記録しない）
        tapGuardUntil = Date.now() + TAP_GUARD_MS;
        afterProgress(res.finished); break;
      }
      case 'reason':
        if (!S.submitReason(state, BANK, el.getAttribute('data-choice'))) break;
        tapGuardUntil = Date.now() + TAP_GUARD_MS;
        persist(); render(); break;
      case 'next': {
        var r = S.next(state, BANK, t);
        if (r === false) break;
        tapGuardUntil = Date.now() + TAP_GUARD_MS;
        afterProgress(r); break;
      }
      case 'skill': go('history', { tab: 'plan', skill: el.getAttribute('data-skill') }); scrollToSkill(el.getAttribute('data-skill')); break;
      case 'question': go('question', { q: el.getAttribute('data-q') }); break;
      case 'back-history': go('history', { tab: 'plan', skill: el.getAttribute('data-skill') }); scrollToSkill(el.getAttribute('data-skill')); break;
      case 'tab': go('history', { tab: el.getAttribute('data-tab') }); break;
      case 'goal': state.settings.dailyGoalMinutes = +el.getAttribute('data-min'); persist(); render(); break;
      case 'dev-add':
        if (state.mode !== 'demo') break; // 通常の記録では日付を動かさない
        state.demo.dayOffset += (+el.getAttribute('data-days')); syncClock(); persist(); render(); break;
      case 'demo-enter': {
        var ds = EA.storage.enterDemo();
        if (!ds) { notice = 'デモモードを始められませんでした（保存できない状態です）。'; render(); break; }
        reloadFrom({ state: ds, readOnly: false }); notice = 'デモモードを始めました。通常の記録はそのまま残っています。'; go('home'); break;
      }
      case 'demo-exit': reloadFrom(EA.storage.exitDemo()); notice = 'デモモードを終えました。デモの記録は消え、通常の記録に戻りました。'; go('home'); break;
      case 'dismiss-load': loadMessage = ''; render(); break;
      case 'export': view.params.exported = true; render(); break;
      case 'copy-export': copyExport(); break;
      case 'reset-ask': view.params.confirmReset = true; render(); break;
      case 'reset-cancel': view.params.confirmReset = false; render(); break;
      case 'reset-do':
        EA.storage.clearNormal(); state = EA.storage.defaultState('normal'); syncClock();
        notice = persist() ? '記録をすべて消しました。' : '記録を消しましたが、新しい記録を保存できない状態です。'; go('home'); break;
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
    if (loaded.status === 'migrated' || loaded.status === 'new' || loaded.status === 'ok') persist();
    if (loaded.status === 'migrated') loadMessage = '記録を新しい形式に引き継ぎました（' + loadMessage + '）。元のデータの控えも保存しています。';
    render();
  }

  // テストや開発用に中身を見られるようにしておく
  EA.app = { getState: function () { return state; }, go: go, isSaveOk: function () { return saveOk; },
    isTapGuarded: function () { return Date.now() < tapGuardUntil; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
