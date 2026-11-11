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

  var TYPE_LABEL = { diagnostic: '初回診断', retry: '解き直し', similar: '類題', followup: '確認問題', review: '復習', trial: '試作' };
  var SESSION_LABEL = { diagnostic: '初回診断', practice: '解説と類題', review: '復習', trial: '試作：英文の構造' };
  var FORMAT_LABEL = { fill: '空所補充', order: '並び替え', ja2en: '日本語→英語', meaning: '意味の確認' };

  function syncClock() { EA.clock.offsetDays = state.mode === 'demo' && state.demo ? state.demo.dayOffset : 0; }
  syncClock();
  function now() { return EA.clock.now(); }
  function T() { return { app: EA.clock.now(), real: Date.now() }; }
  function persist() {
    S.touch(state, Date.now());
    saveOk = readOnly ? false : EA.storage.save(state);
    return saveOk;
  }
  // 問題・項目はすべての単元から探す（試作の単元の回答も履歴に表示するため）
  function q(id) { for (var k in EA.banks) { var r = EA.findQuestion(EA.banks[k], id); if (r) return r; } return null; }
  function skill(id) { for (var k in EA.banks) { var r = EA.findSkill(EA.banks[k], id); if (r) return r; } return null; }
  /** いまの学習回の単元の問題集（試作の単元なら、その問題集） */
  function SB() { var s = state.activeSession; return (s && EA.banks[s.unitId]) || BANK; }
  function attemptById(id) { return S.attemptById(state, id); }

  function go(name, params) {
    view = { name: name, params: params || {} };
    render();
    try { root.scrollTo(0, 0); } catch (e) { /* 無視 */ }
  }

  // 画面に戻ったとき、日付が変わっていればホームを描き直す（開いたまま日をまたいだとき、前日の課題・予定を出し続けないため）
  var shownDay = null;
  function refreshHomeIfDayChanged() {
    if (document.hidden || view.name !== 'home' || !appEl) return;
    if (shownDay !== null && shownDay !== U.startOfDay(now())) render();
  }
  document.addEventListener('visibilitychange', function () {
    refreshHomeIfDayChanged();
    var s = state.activeSession;
    if (!s || !s.current) return;
    // 計時を再開するのは学習画面を開いているときだけ（「保存してホームへ」のあと、ホームを見ている時間は数えない）
    if (document.hidden) S.pause(s.current, Date.now());
    else if (view.name === 'session') S.resume(s.current, Date.now());
    persist();
  });
  root.addEventListener('pageshow', refreshHomeIfDayChanged);
  root.addEventListener('focus', refreshHomeIfDayChanged);
  root.addEventListener('pagehide', function () {
    var s = state.activeSession;
    if (s && s.current) { S.pause(s.current, Date.now()); persist(); }
  });

  /* ================= 学習の流れ（進行は session.js） ================= */
  function startSession(session) {
    var rec = S.start(state, EA.banks[session.unitId] || BANK, session, T());
    persist();
    if (rec) go('summary', { sessionId: rec.id }); else go('session');
  }
  function afterProgress(rec) {
    persist();
    if (rec) go(rec.type === 'diagnostic' ? 'results' : 'summary', { sessionId: rec.id });
    else go('session');
  }
  /**
   * 「保存してホームへ」：途中の状態（確定した回答・入力の途中・選択・段階・学習時間）を保存してホームへ。
   * 学習回は終えず、復習予定も更新しない。保存できなかったときは学習画面にとどまり、入力を保ったまま再試行できる。
   */
  function saveAndGoHome() {
    if (!state.activeSession) { go('home'); return; }
    S.suspend(state, Date.now());
    if (!persist()) {
      notice = { tone: 'error', text: readOnly
        ? '保存できませんでした。元のデータを守るため、この端末では記録を保存しない状態です。この画面のまま学習を続けられます。講師に伝えてください。'
        : '保存できませんでした（容量不足など）。答えと入力の途中の内容はこの画面に残っています。もう一度「保存してホームへ」を押してください。' };
      render();
      return;
    }
    notice = '保存しました。ホームの「続きから再開」で、同じところから続けられます。';
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
    var navItems = [['home', 'ホーム', 'home'], ['units', '単元', 'book'], ['history', '履歴・復習', 'chart'], ['settings', '設定', 'gear']];
    var nav = inSession ? '' : '<nav class="nav" aria-label="メニュー">' + navItems.map(function (n) {
      var cur = view.name === n[0] || (n[0] === 'history' && view.name === 'question');
      return '<button type="button" class="nav-item' + (cur ? ' is-current' : '') + '" data-go="' + n[0] + '"' + (cur ? ' aria-current="page"' : '') + '>' + icon(n[2]) + '<span>' + n[1] + '</span></button>';
    }).join('') + '</nav>';
    // 学習画面の退出は、どの学習回でも「保存してホームへ」1つ（初回診断・解説と類題・復習・試作で同じ）
    var sessionBtns = inSession ? '<button type="button" class="btn-quiet" data-act="save-home">保存してホームへ</button>' : '';
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
  /** 日ごとの学習時間（回答の activeMs。1問あたり上限あり＝放置した時間を除く） */
  function studyMsByDay() {
    var cap = EA.config.maxCountedMsPerQuestion, byDay = {};
    state.attempts.forEach(function (a) {
      var d = U.startOfDay(a.answeredAt);
      byDay[d] = (byDay[d] || 0) + Math.min(a.activeMs || 0, cap);
    });
    return byDay;
  }
  function todayStudyMs() { return studyMsByDay()[U.startOfDay(now())] || 0; }

  /* 線だけの小さなアイコン（文字色を継ぐ・太さを統一） */
  var ICON_PATH = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    repeat: '<path d="M4.5 11a7.5 7.5 0 0 1 13-4.5L19.5 8"/><path d="M19.5 4v4h-4"/><path d="M19.5 13a7.5 7.5 0 0 1-13 4.5L4.5 16"/><path d="M4.5 20v-4h4"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9l-2 4-4 2 2-4z"/>',
    book: '<path d="M4.5 5.5c2.5-1 5-1 7.5.5v13c-2.5-1.5-5-1.5-7.5-.5z"/><path d="M19.5 5.5c-2.5-1-5-1-7.5.5v13c2.5-1.5 5-1.5 7.5-.5z"/>',
    arrow: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
    chevron: '<path d="M9.5 6l6 6-6 6"/>',
    home: '<path d="M4.5 11L12 4.5 19.5 11"/><path d="M6.5 9.5V19h11V9.5"/><path d="M10 19v-5h4v5"/>',
    chart: '<path d="M6 19V12M12 19V5M18 19v-9"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
    flame: '<path d="M12 20.5c-3.6 0-6-2.4-6-5.6 0-3.4 2.6-5.2 3.6-8.4 1.6 1.4 2 3 2 4.4 1-.6 1.8-1.8 2-3.4 2 1.8 4.4 4.2 4.4 7.4 0 3.2-2.4 5.6-6 5.6z"/>'
  };
  function icon(name) {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICON_PATH[name] + '</svg>';
  }

  /** 単元の流れ（初回診断 → 解説と類題 → 後日の復習）。記録された事実だけから作る */
  function unitSteps(task) {
    var u = P.unitState(state, BANK.unit.id);
    var s = state.activeSession;
    var reviewed = (state.sessions || []).some(function (x) { return x.type === 'review'; });
    var cur = { diagnostic: 0, practice: 1, review: 2 }[task.kind];
    if (task.kind === 'resume') cur = s && s.type !== 'trial' ? { diagnostic: 0, practice: 1, review: 2 }[s.type] : -1;
    var steps = [
      { label: '初回診断', done: !!u.diagnosticDoneAt },
      { label: '解説と類題', done: !!u.practiceDoneAt, skipped: !u.practiceDoneAt && !!u.practiceSkippedAt },
      { label: '後日の復習', done: reviewed }
    ];
    return { steps: steps, cur: cur, done: steps.filter(function (x) { return x.done; }).length };
  }
  function unitPath(us) {
    return '<ol class="path" aria-label="この単元の流れ">' + us.steps.map(function (st, i) {
      var now_ = i === us.cur;
      var state_ = now_ ? 'いまここ' : st.done ? '済み' : st.skipped ? '見送り' : 'まだ';
      return '<li class="path-step' + (now_ ? ' is-now' : st.done ? ' is-done' : '') + '"' + (now_ ? ' aria-current="step"' : '') + '>' +
        '<span class="path-mark" aria-hidden="true">' + (st.done && !now_ ? icon('check') : '<span class="num">' + (i + 1) + '</span>') + '</span>' +
        '<span class="path-label">' + st.label + '</span><span class="sr">（' + state_ + '）</span></li>';
    }).join('') + '</ol>';
  }

  /**
   * 今週（月〜日）の学習：日ごとの学習時間・合計・週の目標（毎日の目標×7）・連続して回答した日数。
   * 学習時間は回答の記録から数える（「学習済み」「正解」ではなく、答えていた時間）。
   */
  function weekData(t) {
    var today = U.startOfDay(t), byDay = studyMsByDay();
    var dow = (new Date(today).getDay() + 6) % 7; // 月=0
    var monday = U.addDays(today, -dow);
    var names = ['月', '火', '水', '木', '金', '土', '日'];
    var days = names.map(function (n, i) {
      var d = U.addDays(monday, i);
      return { name: n, day: d, min: Math.floor((byDay[d] || 0) / 60000), ms: byDay[d] || 0, isToday: d === today, future: d > today };
    });
    var totalMs = days.reduce(function (s, d) { return s + d.ms; }, 0);
    var goal = state.settings.dailyGoalMinutes * 7;
    // 連続：今日（まだなら昨日）から、回答した日が続いている日数
    var streak = 0, d = byDay[today] ? today : U.addDays(today, -1);
    while (byDay[d] !== undefined) { streak++; d = U.addDays(d, -1); }
    return { days: days, monday: monday, sunday: U.addDays(monday, 6), totalMin: Math.floor(totalMs / 60000), goal: goal,
      pct: Math.min(100, Math.round(totalMs / 60000 / goal * 100)), streak: streak };
  }

  function shortDate(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + '日月火水木金土'.charAt(d.getDay()) + '）'; }

  /** 確認実績の3段階（mastery.js の ACHIEVEMENTS と同じ定義を、短いことばで） */
  var ACH_SHORT = ['自力で1問正解', '別の問題でも自力で正解', '後日の復習でも正解'];

  function renderHome() {
    var t = now();
    var task = P.homeTask(state, BANK, t);
    var studyMs = todayStudyMs();
    var studyMin = Math.floor(studyMs / 60000);
    var goal = state.settings.dailyGoalMinutes;
    var pct = Math.min(100, Math.round(studyMs / 60000 / goal * 100));
    var due = P.dueReviews(state, BANK, t);
    var next = P.nextReviewDate(state, BANK);
    var statuses = BANK.skills.map(function (sk) { return M.analyze(sk.id, state.attempts, BANK); });
    var recheckN = statuses.filter(function (s) { return s.needsRecheck; }).length;
    var isTrialResume = task.kind === 'resume' && state.activeSession && state.activeSession.type === 'trial';
    var unit = isTrialResume ? (EA.banks[state.activeSession.unitId] || BANK).unit : BANK.unit;
    var us = unitSteps(task);
    var wk = weekData(t);

    var h = '<div class="home">';

    // あいさつ（背景の丘は飾り）
    h += '<header class="greet"><p class="greet-sub">' + (state.attempts.length ? 'おかえりなさい' : 'ようこそ') + '</p>' +
      '<p class="greet-title">今日も、to＋動詞を1問ずつ。</p>' +
      '<svg class="greet-art" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">' +
      '<path class="hill-3" d="M0 200 C120 150 220 120 330 135 C430 150 520 90 600 70 L600 200Z"/>' +
      '<path class="hill-2" d="M140 200 C250 140 330 70 430 40 C480 25 540 45 600 30 L600 200Z"/>' +
      '<path class="hill-1" d="M260 200 C360 170 430 120 520 110 C560 105 585 115 600 112 L600 200Z"/></svg></header>';

    // 1. 次にやること ｜ 単元 ｜ 今日の学習時間（1枚のカード）
    var reviewText;
    if (due.length) reviewText = '今日 <strong class="num">' + due.length + '</strong>件';
    else if (next) reviewText = U.fmtDate(next) + '（' + U.relDay(next, t) + '）';
    else reviewText = '初回診断のあとに決まります';

    h += '<section class="dash" aria-label="今日の学習">';
    h += '<div class="dash-col hero hero-' + task.kind + '">' +
      '<p class="dash-head"><span class="dash-icon">' + icon(task.kind === 'done' ? 'check' : task.kind === 'review' ? 'repeat' : 'play') + '</span>' +
        (task.kind === 'done' ? '今日の課題' : '次にやること') + '</p>' +
      '<h1 class="hero-title" id="hero-title">' + esc(task.title) + '</h1>' +
      (task.detail ? '<p class="hero-detail">' + esc(task.detail) + '</p>' : '') +
      '<p class="hero-why">' + esc(task.why) + '</p>' +
      '<div class="hero-actions">' +
      (task.cta ? '<button type="button" class="btn-primary btn-lg hero-cta" data-act="task-' + task.kind + '">' + esc(task.cta) + icon('chevron') + '</button>'
        : '<button type="button" class="btn-quiet hero-cta" data-go="history">' + icon('book') + '解説と回答を見返す</button>') +
      '</div>' +
      (task.kind === 'resume' && task.dueWaiting ? '<p class="hero-due" role="note">' + icon('calendar') +
        '<span>期限を迎えた復習が <strong class="num">' + task.dueWaiting + '</strong>件あります。この学習を最後まで進めると始められます。</span></p>' : '') +
      '</div>';

    h += '<div class="dash-col unit-col">' +
      '<div class="unit-tile" aria-hidden="true"><span lang="en">to</span><span class="unit-tile-plus">＋動詞</span></div>' +
      '<div class="unit-info"><p class="dash-label">単元</p><p class="unit-name">' + esc(unit.title) + '</p>' +
      (isTrialResume ? '<p class="unit-sub">試作（確認状況・復習予定には反映しません）</p>'
        : '<p class="unit-sub">ステップ ' + Math.min(us.done + (us.cur >= 0 && !us.steps[us.cur].done ? 1 : 0), 3) + ' / 3</p>' +
          '<div class="bar" role="progressbar" aria-label="単元の流れで済んだステップ" aria-valuemin="0" aria-valuemax="3" aria-valuenow="' + us.done + '"><span style="width:' + Math.round(us.done / 3 * 100) + '%"></span></div>') +
      '</div>' +
      (isTrialResume ? '' : unitPath(us)) +
      '<p class="dash-fact">' + icon('calendar') + '<span>復習の予定：' + reviewText + '</span></p>' +
      '</div>';

    h += '<div class="dash-col time-col">' +
      '<p class="dash-head"><span class="dash-icon">' + icon('clock') + '</span>今日の学習時間</p>' +
      '<p class="time-big"><span class="num">' + studyMin + '</span><span class="time-unit">分</span><span class="time-of">／ 目標 ' + goal + '分</span></p>' +
      '<div class="bar bar-lg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="目標に対する今日の学習時間"><span style="width:' + pct + '%"></span></div>' +
      '<p class="time-left">' + icon('target') + '<span>' + (studyMin >= goal ? '目標を達成しました' : '目標まであと <strong class="num">' + (goal - studyMin) + '</strong>分') + '</span>' +
        '<button type="button" class="btn-text" data-go="settings">目標を変更</button></p>' +
      '</div>';
    h += '</section>';

    // 2. 項目ごとの確認状況（3つの使い方を横に並べる）
    h += '<section class="skills-panel" aria-labelledby="skills-title"><div class="section-head"><h2 id="skills-title">項目ごとの確認状況</h2>' +
      (recheckN ? '<p class="skills-alert">再確認 ' + recheckN + '項目</p>' : '') +
      '<button type="button" class="btn-link" data-go="history">履歴・復習を見る' + icon('chevron') + '</button></div>' +
      '<ul class="skill-cols">' + BANK.skills.map(function (sk, i) {
        var st = statuses[i], sch = state.schedule[sk.id];
        return '<li class="skill-col">' +
          '<span class="tag tag-' + (i + 1) + '">' + esc(sk.term) + '</span>' +
          '<button type="button" class="skill-open" data-act="skill" data-skill="' + sk.id + '"><span class="skill-label">' + esc(sk.label) + '</span>' + icon('chevron') + '</button>' +
          '<p class="skill-plain">' + esc(sk.plain) + '</p>' +
          '<ul class="ach-list" aria-label="これまでの確認実績">' + ACH_SHORT.map(function (label, j) {
            var on = st.achievement >= j + 1;
            return '<li class="' + (on ? 'is-on' : '') + '"><span>' + label + '</span><span class="ach-dot" aria-hidden="true">' + (on ? icon('check') : '') + '</span>' +
              '<span class="sr">' + (on ? '（確認済み）' : '（まだ）') + '</span></li>';
          }).join('') + '</ul>' +
          '<p class="skill-foot"><span class="status-text tone-text-' + st.tone + '">' + (st.tone === 'recheck' ? '<span aria-hidden="true">！ </span>' : '') + esc(st.headline) + '</span>' +
            '<span class="skill-due">' + (sch ? '復習 ' + U.relDay(sch.dueAt, t) : '復習 —') + '</span></p>' +
          '</li>';
      }).join('') + '</ul>' +
      '<p class="panel-note skills-note">✓ ＝ これまでの確認実績（アプリ内の記録で、習得の保証ではありません）。</p></section>';

    // 3. 今週の学習
    var maxMin = Math.max(goal, Math.max.apply(null, wk.days.map(function (d) { return d.min; })));
    h += '<section class="week" aria-labelledby="week-title">' +
      '<div class="week-cell week-title"><h2 id="week-title">' + icon('chart') + '今週の学習</h2>' +
        '<p class="muted num">' + shortDate(wk.monday) + ' – ' + shortDate(wk.sunday) + '</p></div>' +
      '<div class="week-cell"><p class="dash-label">学習時間</p><p class="week-big"><span class="num">' + wk.totalMin + '</span>分</p><p class="muted">／ 目標 ' + wk.goal + '分</p></div>' +
      '<ol class="week-bars" aria-label="曜日ごとの学習時間">' + wk.days.map(function (d) {
        var hgt = d.min ? Math.max(8, Math.round(d.min / maxMin * 100)) : 4;
        return '<li class="wb' + (d.isToday ? ' is-today' : '') + (d.future ? ' is-future' : '') + (d.min ? ' has' : '') + '">' +
          '<span class="wb-track"><span class="wb-fill" style="height:' + hgt + '%"></span></span>' +
          '<span class="wb-name" aria-hidden="true">' + d.name + '</span>' +
          '<span class="sr">' + d.name + '曜日' + (d.isToday ? '（今日）' : '') + '：' + (d.future ? 'これから' : d.min + '分') + '</span></li>';
      }).join('') + '</ol>' +
      '<div class="week-cell"><p class="dash-label">今週の達成度</p><p class="week-big"><span class="num">' + wk.pct + '</span>%</p>' +
        '<div class="bar" role="progressbar" aria-label="今週の目標に対する学習時間" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + wk.pct + '"><span style="width:' + wk.pct + '%"></span></div></div>' +
      '<div class="week-cell week-streak"><p class="dash-label">' + icon('flame') + '連続して学習</p><p class="week-big"><span class="num">' + wk.streak + '</span>日</p></div>' +
      '</section>';
    return h + '</div>';
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
      trialUnitsHtml() +
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
    var cur = S.ensureCurrent(state, SB(), T());
    var typeNote = {
      diagnostic: '解説は全問に答えたあとに表示します。',
      retry: '解説を読んだ直後の解き直しです（類題とは別に記録します）。',
      similar: '単語や場面を変えた類題です。',
      followup: '前の問題でつまずいた内容を、別の問題で確かめます。',
      review: '復習です。答えを見ずに思い出してみましょう。',
      trial: '試作の問題です（確認状況・復習予定には反映しません）。'
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
        // 意味の問いに答えるまでは、日本語訳・正答・正誤・解説を出さない。英文と、聞いている部分（太字）だけを示す
        body += reasonAskHtml(qq2, cur);
      } else {
        body += questionPromptHtml(qq2, qq2.format === 'fill' ? a.response : null);
        if (qq2.choices) body += resultChoicesHtml(qq2, a, cur);
        else body += '<div class="your-answer"><span class="label">あなたの答え</span><span lang="en">' + (a.responseText ? esc(a.responseText) : '（わからない）') + '</span></div>';
        body += '<div class="verdict"><span class="label">答え</span>' + resultBadge(a.result) + flagsHtml(a) + '</div>';
        if (a.feedback) body += '<p class="feedback-note">' + esc(a.feedback) + '</p>';
        if (a.reason) body += reasonResultHtml(qq2, a);
        if (a.followUp) {
          body += '<div class="next-note" role="note">' + (a.followUp.added
            ? '<strong>このあと、単語や場面を変えた問題でもう一度確かめます。</strong>'
            : esc(a.followUp.why)) + '</div>';
          if (a.followUp.basics) body += basicsHtml(skill(a.skillId));
        }
        // 構造の段階解説がある問題は、それを解説とする（日本語訳も解説の中で任意に開く）
        body += qq2.structure ? structureHtml(qq2, cur) : collapsibleExplanationHtml(qq2);
        body += '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="next">' + (s.index + 1 >= total ? '結果を見る' : '次へ') + '</button></div>';
      }
    }
    return progress + body + '</section>';
  }

  /** 英文の中で、意味の問いが聞いている部分を太字＋下線にする（to が複数あっても対象がわかるように） */
  function targetSentenceHtml(sentence, target) {
    var i = target ? sentence.indexOf(target) : -1;
    if (i < 0) return esc(sentence);
    return esc(sentence.slice(0, i)) + '<strong class="reason-target">' + esc(target) + '</strong>' + esc(sentence.slice(i + target.length));
  }

  /** 意味の問い（回答前）：英文＋太字の部分＋短い質問＋3択。選んでから「回答を確定」 */
  function reasonAskHtml(qq, cur) {
    var r = qq.reason;
    return '<div class="reason">' +
      '<p class="eyebrow">意味の問い<span class="eyebrow-note">日本語訳・正誤・解説は、この問いに答えたあとに表示します。</span></p>' +
      '<p class="q-sentence reason-sentence" lang="en">' + targetSentenceHtml(r.sentence, r.target) + '</p>' +
      '<p class="reason-q">' + esc(r.prompt) + '</p>' +
      '<div class="choices" role="radiogroup" aria-label="意味の問いの選択肢">' +
      ordered(r.choices, cur.reasonOrder).map(function (c) {
        var on = cur.reasonDraft === c.id;
        return '<button type="button" role="radio" aria-checked="' + on + '" class="choice' + (on ? ' is-selected' : '') + '" data-act="reason-choose" data-choice="' + c.id + '">' +
          '<span class="choice-dot" aria-hidden="true"></span>' + esc(c.text) + '</button>';
      }).join('') + '</div>' +
      '<div class="actions"><button type="button" class="btn-primary btn-lg" data-act="reason" id="reason-submit"' + (cur.reasonDraft ? '' : ' disabled') + '>回答を確定</button></div>' +
      '</div>';
  }

  /**
   * 意味の問い（回答後）：○×、選んだもの・この文での意味、どの語句とどの語句がどうつながるか、文法用語。
   * 答えたときの文言（a.reason に保存）を使う。問題データの更新前の回答でも、当時の選択肢で表示する。
   */
  function reasonResultHtml(qq, a) {
    var r = a.reason, cur = qq.reason || {};
    var sameVersion = r.reasonVersion && r.reasonVersion === qq.version;
    var answerText = r.answerText, choiceText = r.choiceText;
    if (!answerText || !choiceText) {
      // 古い記録（文言を保存していない）：今の設問か、以前の共通の選択肢から探す
      var pool = (cur.choices || []).concat((EA.banks[a.unitId] && EA.banks[a.unitId].legacyReasonChoices) || []);
      pool.forEach(function (c) { if (!answerText && c.id === (r.answerId || (r.kind === 'role' ? a.skillId : cur.answer))) answerText = c.text; if (!choiceText && c.id === r.choiceId) choiceText = c.text; });
    }
    var chosen = null;
    if (sameVersion) (cur.choices || []).forEach(function (c) { if (c.id === r.choiceId) chosen = c; });
    var h = '<div class="reason-result"><span class="label">意味の問い</span>' +
      '<span>' + (r.correct ? '○ 選んだ意味は合っています。' : '× 選んだ意味とは違います。答えは正解なので、意味をもう一度確かめましょう。') + '</span>';
    if (!r.correct && choiceText) h += '<span class="reason-correct">あなたが選んだもの：' + esc(choiceText) + '</span>';
    if (!r.correct && chosen && chosen.feedback) h += '<span class="reason-correct">' + esc(chosen.feedback) + '</span>';
    if (answerText) h += '<span class="reason-answer">この文では：' + esc(answerText) + '</span>';
    if (sameVersion && cur.link) {
      h += '<div class="reason-link"><p class="reason-link-map" lang="en"><span class="reason-link-head">' + esc(cur.link.head) + '</span>' +
        '<span class="reason-link-arrow" aria-hidden="true">←</span><strong class="reason-target">' + esc(cur.target) + '</strong></p>' +
        '<p>' + esc(cur.link.text) + '</p>' +
        (cur.link.term ? '<p class="ex-term"><span class="label">文法の名前</span>' + esc(cur.link.term) + '</p>' : '') + '</div>';
    }
    if (r.independent === false) h += '<span class="reason-correct">日本語訳や解説を見たあとの回答なので、考え方の参考として記録します。</span>';
    if (!sameVersion) h += '<span class="reason-correct">この回答は以前の版の設問への回答です（確認状況の判定には使いません）。</span>';
    return h + '</div>';
  }

  /** 意味の問いの選択：画面全体を描き直さず、選択状態だけを変える */
  function selectReason(id) {
    var s = state.activeSession;
    if (!s || !s.current || s.current.phase !== 'reason') return;
    s.current.reasonDraft = id;
    var btns = appEl.querySelectorAll('[data-act="reason-choose"]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-choice') === id;
      btns[i].classList.toggle('is-selected', on);
      btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var b = document.getElementById('reason-submit');
    if (b) b.disabled = false;
    schedulePersist();
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

  /* ================= 英文構造の段階解説（回答を確定したあとだけ表示） ================= */
  var SX_BRACKETS = { modifier: ['（', '）'], omit: ['（', '）'] };

  function sxState(cur) { return cur.structure || (cur.structure = { open: false, step: 0, translation: false }); }

  function structureHtml(qq, cur) {
    var sv = sxState(cur);
    return '<section class="sx" aria-label="英文構造の段階解説">' +
      '<button type="button" class="btn-quiet sx-open" data-act="sx-toggle" aria-expanded="' + sv.open + '" aria-controls="sx-panel">' +
      (sv.open ? '構造をとじる' : '構造を見る') + '</button>' +
      '<div class="sx-panel" id="sx-panel"' + (sv.open ? '' : ' hidden') + '>' + (sv.open ? structurePanelInner(qq, sv) : '') + '</div></section>';
  }

  function segHtml(sg) {
    if (!sg.role) return '<span class="sx-plain">' + esc(sg.text) + '</span>';
    var b = SX_BRACKETS[sg.role] || ['', ''];
    return '<span class="sx-seg sx-' + sg.role + (sg.isNew ? ' is-new' : '') + '">' +
      '<span class="sx-words" lang="en">' + (b[0] ? '<span class="sx-bracket" aria-hidden="true">' + b[0] + '</span>' : '') + esc(sg.text) +
      (b[1] ? '<span class="sx-bracket" aria-hidden="true">' + b[1] + '</span>' : '') + '</span>' +
      '<span class="sx-label">' + esc(sg.label) + '</span></span>';
  }

  function structurePanelInner(qq, sv) {
    var m = EA.structure.stepModel(qq.structure, sv.step);
    var last = m.index === m.total - 1;
    return '<p class="sx-progress" aria-live="polite"><span class="sx-count">段階 ' + (m.index + 1) + ' / ' + m.total + '</span>' + esc(m.title) + '</p>' +
      '<ol class="sx-steps" aria-hidden="true">' + qq.structure.steps.map(function (s, i) {
        return '<li class="' + (i === m.index ? 'is-current' : i < m.index ? 'is-done' : '') + '"></li>';
      }).join('') + '</ol>' +
      '<p class="sx-sentence">' + m.segments.map(segHtml).join(' ') + '</p>' +
      (m.skeleton ? '<div class="sx-skeleton"><span class="label">骨格</span><p class="sx-sentence sx-sentence-sm">' +
        m.skeleton.map(function (p) { return segHtml({ text: p.text, role: 'skel', label: p.label, isNew: true }); }).join(' ') + '</p></div>' : '') +
      '<p class="sx-text">' + esc(m.text) + '</p>' +
      '<div class="sx-controls">' +
        '<button type="button" class="btn-quiet" data-act="sx-prev" aria-label="前の段階へ"' + (m.index === 0 ? ' disabled' : '') + '>← 前へ</button>' +
        '<button type="button" class="btn-quiet" data-act="sx-next" aria-label="次の段階へ"' + (last ? ' disabled' : '') + '>次へ →</button>' +
        '<button type="button" class="btn-quiet" data-act="sx-restart"' + (m.index === 0 ? ' disabled' : '') + '>最初から</button>' +
      '</div>' +
      '<div class="sx-trans"><button type="button" class="btn-text" data-act="sx-trans" aria-expanded="' + sv.translation + '" aria-controls="sx-trans-text">' +
        (sv.translation ? '日本語訳をかくす' : '日本語訳を見る') + '</button>' +
        '<p id="sx-trans-text" class="sx-trans-text"' + (sv.translation ? '' : ' hidden') + '>' + esc(qq.structure.translation) + '</p></div>';
  }

  /** 構造解説の操作：段階の状態を保存し、解説の部分だけを描き直す（読んでいる位置を動かさない） */
  function structureAction(act) {
    var s = state.activeSession;
    if (!s || !s.current || s.current.phase !== 'feedback') return;
    var qq = q(s.items[s.index].questionId);
    if (!qq || !qq.structure) return;
    var sv = sxState(s.current), total = qq.structure.steps.length;
    var a = attemptById(s.current.attemptId), at = now();
    if (act === 'sx-toggle') { sv.open = !sv.open; if (sv.open) EA.structure.recordView(a, 'open', sv.step, total, at); }
    if (act === 'sx-prev' && sv.step > 0) sv.step--;
    if (act === 'sx-next' && sv.step < total - 1) { sv.step++; EA.structure.recordView(a, 'step', sv.step, total, at); }
    if (act === 'sx-restart') sv.step = 0;
    if (act === 'sx-trans') { sv.translation = !sv.translation; if (sv.translation) EA.structure.recordView(a, 'translation', null, total, at); }
    var section = appEl.querySelector('.sx');
    var tmp = document.createElement('div');
    tmp.innerHTML = structureHtml(qq, s.current);
    section.replaceWith(tmp.firstChild);
    // 押したボタンにフォーカスを戻す（押せなくなったときは、となりの操作へ）
    var focusAct = act;
    if (act === 'sx-next' && sv.step === total - 1) focusAct = 'sx-prev';
    if ((act === 'sx-prev' || act === 'sx-restart') && sv.step === 0) focusAct = 'sx-next';
    var f = appEl.querySelector('[data-act="' + focusAct + '"]');
    if (f && act !== 'sx-toggle') f.focus({ preventScroll: true });
    if (act === 'sx-toggle') appEl.querySelector('[data-act="sx-toggle"]').focus({ preventScroll: true });
    schedulePersist();
  }

  /** 単元一覧の試作の単元 */
  function trialUnitsHtml() {
    return Object.keys(EA.banks).filter(function (k) { return EA.banks[k].unit.trial; }).map(function (k) {
      var b = EA.banks[k];
      return '<section class="panel unit-card"><div class="unit-head"><div><p class="eyebrow">試作（確認状況・復習予定には反映しません）</p><h2>' + esc(b.unit.title) + '</h2>' +
        '<p>' + esc(b.unit.description) + '</p></div>' +
        '<button type="button" class="btn-quiet" data-act="task-trial" data-unit="' + k + '"' + (state.activeSession ? ' disabled' : '') + '>試す（' + b.questions.length + '問）</button></div>' +
        (state.activeSession ? '<p class="unit-scope">途中の学習があるため、ホームで再開するか終えてから試せます。</p>' : '') + '</section>';
    }).join('');
  }

  function trialSummaryHtml(atts) {
    return '<section class="panel"><div class="panel-head"><h2>今回の回答</h2><p class="panel-note">試作の問題です。確認状況・復習予定には反映しません。構造の解説を見たことも、正解や理解の根拠にはしていません。</p></div><ul class="att-list">' +
      atts.map(function (a) {
        var qq = q(a.questionId), v = a.structureView;
        return '<li><button type="button" class="att-row" data-act="question" data-q="' + qq.id + '"><span class="att-type">試作</span>' +
          '<span class="att-q" lang="en">' + esc(qq.sentence) + '<span class="muted">構造の解説：' + (v ? '開いた（' + v.maxStepSeen + ' / ' + v.totalSteps + ' 段階まで' + (v.translationOpened ? '・訳を見た' : '') + '）' : '開いていない') + '</span></span>' +
          '<span class="att-tags">' + resultBadge(a.result) + '</span></button></li>';
      }).join('') + '</ul></section><div class="actions"><button type="button" class="btn-primary btn-lg" data-go="home">ホームへ</button></div>';
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
      // 診断はもう終わっているので、ここは記録を変えずにホームへ戻るだけ
      '<button type="button" class="btn-quiet" data-act="skip-practice-later">ホームへ戻る（解説と類題はあとで）</button>' +
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
    if (rec.type === 'trial') return h + trialSummaryHtml(atts);
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
    var n = !notice ? '' : typeof notice === 'string' ? '<div class="toast" role="status">' + esc(notice) + '</div>'
      : '<div class="toast toast-' + notice.tone + '" role="alert">' + esc(notice.text) + '</div>';
    notice = null;
    appEl.innerHTML = topbar() + '<main class="main view-' + view.name + '" id="main">' + n + main + '</main>';
    appEl.setAttribute('data-view', view.name);
    shownDay = U.startOfDay(now());
    appEl.setAttribute('data-mode', state.mode);
    if (view.name === 'session') { mountSessionWidgets(); animateProgress(); }
  }

  function reloadFrom(result) {
    state = result.state; readOnly = result.readOnly; loadMessage = result.message || '';
    syncClock(); saveOk = true;
  }

  var GUARDED = { submit: 1, giveup: 1, reason: 1, 'reason-choose': 1, next: 1 };

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
      case 'save-home': saveAndGoHome(); break;
      case 'choose': selectChoice(el.getAttribute('data-choice')); break;
      case 'toggle-explain': toggleExplanation(el); break;
      case 'task-trial': startSession(P.buildTrialSession(EA.banks[el.getAttribute('data-unit')], t.app)); break;
      case 'sx-toggle': case 'sx-prev': case 'sx-next': case 'sx-restart': case 'sx-trans': structureAction(act); break;
      case 'unsure': s.current.unsure = !s.current.unsure; persist(); render(); break;
      case 'hint': s.current.hintUsed = true; persist(); render(); break;
      case 'giveup':
      case 'submit': {
        el.disabled = true;
        var res = S.submit(state, SB(), act === 'giveup', t);
        if (!res) break; // すでに確定済み（二重確定は記録しない）
        tapGuardUntil = Date.now() + TAP_GUARD_MS;
        afterProgress(res.finished); break;
      }
      case 'reason-choose': selectReason(el.getAttribute('data-choice')); break;
      case 'reason':
        if (!s || !s.current || !s.current.reasonDraft) break;
        el.disabled = true;
        if (!S.submitReason(state, SB(), s.current.reasonDraft)) { render(); break; }
        tapGuardUntil = Date.now() + TAP_GUARD_MS;
        persist(); render(); break;
      case 'next': {
        var r = S.next(state, SB(), t);
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
    S.recover(state); // 前回、計時中のまま閉じていた場合も、閉じていた時間は学習時間に数えない
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
