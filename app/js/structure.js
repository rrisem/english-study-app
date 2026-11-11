/*
 * structure.js — 英文構造の段階解説（データから表示用の形を作る。画面は扱いません）
 *
 * 問題データの structure（data/structure-trial.js の説明を参照）から、段階ごとに
 *   英文を「強調するまとまり」と「そのままの語」に分けた segments を作ります。
 * 解説を開いた・最後まで見たことは記録しますが、正解や理解済みの根拠にはしません（mastery.js は見ません）。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};

  function words(text) { return String(text).trim().split(/\s+/); }
  function bare(w) { return w.replace(/[.,!?;:]+$/, '').toLowerCase(); }

  /** marks の語句が英文のどこにあるか（単語の位置）。見つからなければ null */
  function locate(tokens, phrase, from) {
    var p = words(phrase).map(bare);
    for (var i = from || 0; i + p.length <= tokens.length; i++) {
      var ok = true;
      for (var j = 0; j < p.length; j++) if (bare(tokens[i + j]) !== p[j]) { ok = false; break; }
      if (ok) return { start: i, end: i + p.length - 1 };
    }
    return null;
  }

  /** データの誤り（語句が英文にない・重なっている・ラベルがない）を返す */
  function validate(structure) {
    var problems = [];
    if (!structure || !structure.sentence || !structure.steps || !structure.steps.length) return ['structure の sentence または steps がありません'];
    var tokens = words(structure.sentence);
    structure.steps.forEach(function (st, si) {
      var used = {};
      if (!st.title || !st.text) problems.push('段階' + (si + 1) + '：title / text がありません');
      (st.marks || []).forEach(function (m) {
        var r = locate(tokens, m.text);
        if (!r) { problems.push('段階' + (si + 1) + '：「' + m.text + '」が英文にありません'); return; }
        if (!m.label) problems.push('段階' + (si + 1) + '：「' + m.text + '」にラベルがありません');
        for (var k = r.start; k <= r.end; k++) {
          if (used[k]) problems.push('段階' + (si + 1) + '：「' + m.text + '」がほかの強調と重なっています');
          used[k] = true;
        }
      });
    });
    return problems;
  }

  /**
   * 段階 index（0から）の表示用データ。
   * segments: [{ text, role|null, label|null, isNew }] … role が null のものは強調しない語
   * isNew は、前の段階になかった強調（表示の動きに使う。動きがなくても内容は同じ）
   */
  function stepModel(structure, index) {
    var tokens = words(structure.sentence);
    var step = structure.steps[index];
    var prevKeys = {};
    if (index > 0) (structure.steps[index - 1].marks || []).forEach(function (m) { prevKeys[m.role + '|' + m.text] = true; });
    var marks = (step.marks || []).map(function (m) {
      var r = locate(tokens, m.text);
      return { start: r.start, end: r.end, role: m.role, label: m.label, isNew: !prevKeys[m.role + '|' + m.text] };
    }).sort(function (a, b) { return a.start - b.start; });
    var segments = [], i = 0;
    marks.forEach(function (m) {
      if (i < m.start) segments.push({ text: tokens.slice(i, m.start).join(' '), role: null, label: null, isNew: false });
      segments.push({ text: tokens.slice(m.start, m.end + 1).join(' '), role: m.role, label: m.label, isNew: m.isNew });
      i = m.end + 1;
    });
    if (i < tokens.length) segments.push({ text: tokens.slice(i).join(' '), role: null, label: null, isNew: false });
    return {
      index: index, total: structure.steps.length, title: step.title, text: step.text,
      segments: segments, skeleton: step.skeleton || null
    };
  }

  /**
   * 構造解説の閲覧を、その回答の記録（attempt.structureView）に残す。既存の保存方式（localStorage の状態）に含まれる。
   * event: 'open' | 'step' | 'translation' | 'close'
   */
  function recordView(attempt, event, step, total, at) {
    var v = attempt.structureView || (attempt.structureView = {
      firstOpenedAt: at, openCount: 0, maxStepSeen: 0, totalSteps: total, completed: false, translationOpened: false
    });
    if (event === 'open') v.openCount++;
    if (event === 'translation') v.translationOpened = true;
    if (step != null) v.maxStepSeen = Math.max(v.maxStepSeen, step + 1);
    v.completed = v.maxStepSeen >= v.totalSteps; // 最後まで見た（理解したという意味ではない）
    v.lastViewedAt = at;
    return v;
  }

  EA.structure = { locate: locate, validate: validate, stepModel: stepModel, recordView: recordView, words: words };
})(typeof window !== 'undefined' ? window : globalThis);
