/*
 * grading.js — 採点（ルールのみ。AIは使いません）
 *
 * 結果（result）の種類：
 *   correct    正解
 *   minor      確認したい部分（不定詞）は正しいが、ほかに小さな直しがある
 *   alt        英文として正しいが、今回確認したい形（不定詞）を使っていない
 *   incorrect  誤り（よくある誤りに当てはまった、または選択・並び替えが違う）
 *   unmatched  自動では判定できない（正答例とも、よくある誤りとも一致しない）→ 誤りと断定しない
 *   gaveup     「わからない」を選んだ
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};

  var CONTRACTIONS = [
    [/\bi'm\b/g, 'i am'], [/\bi'd\b/g, 'i would'], [/\bit's\b/g, 'it is'],
    [/\bdon't\b/g, 'do not'], [/\bdoesn't\b/g, 'does not'], [/\bdidn't\b/g, 'did not'],
    [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'],
    [/\bisn't\b/g, 'is not'], [/\baren't\b/g, 'are not'], [/\bthat's\b/g, 'that is'],
    [/\bhe's\b/g, 'he is'], [/\bshe's\b/g, 'she is'], [/\bwe're\b/g, 'we are'],
    [/\bthey're\b/g, 'they are'], [/\byou're\b/g, 'you are']
  ];

  /**
   * 比較用に整える：
   * 全角→半角、’→'、小文字化、前後・連続空白の整理、文末の . ! ? を除去、
   * 句読点の前の空白を除去、短縮形を元の形に。
   */
  function normalize(text) {
    var s = String(text == null ? '' : text);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/[‘’ʼ`´]/g, "'")
      .replace(/[“”]/g, '"')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/[.!?。．]+$/, '')
      .trim();
    for (var i = 0; i < CONTRACTIONS.length; i++) {
      s = s.replace(CONTRACTIONS[i][0], CONTRACTIONS[i][1]);
    }
    return s;
  }

  function findChoice(q, id) {
    for (var i = 0; i < (q.choices || []).length; i++) if (q.choices[i].id === id) return q.choices[i];
    return null;
  }

  /**
   * 採点する。
   * response: fill/meaning → 選択肢ID、order → 並べた語句の配列、ja2en → 入力文字列
   * 戻り値: { result, feedback, normalized }
   */
  function grade(q, response) {
    if (response == null || response === '' || (Array.isArray(response) && response.length === 0)) {
      return { result: 'gaveup', feedback: '' };
    }
    if (q.format === 'fill' || q.format === 'meaning') {
      if (response === q.answer) return { result: 'correct', feedback: '' };
      var c = findChoice(q, response);
      return { result: 'incorrect', feedback: (c && c.feedback) || '' };
    }

    if (q.format === 'order') {
      var joined = normalize(response.join(' '));
      for (var i = 0; i < q.answers.length; i++) {
        if (normalize(q.answers[i]) === joined) return { result: 'correct', feedback: '', normalized: joined };
      }
      return { result: 'incorrect', feedback: '', normalized: joined };
    }

    if (q.format === 'ja2en') {
      var n = normalize(response);
      var j;
      for (j = 0; j < q.accepted.length; j++) {
        if (normalize(q.accepted[j]) === n) return { result: 'correct', feedback: '', normalized: n };
      }
      var errs = q.errors || [];
      for (j = 0; j < errs.length; j++) {
        if (new RegExp(errs[j].pattern).test(n)) {
          return { result: errs[j].result || 'incorrect', feedback: errs[j].feedback || '', normalized: n };
        }
      }
      var alts = q.alternatives || [];
      for (j = 0; j < alts.length; j++) {
        if (new RegExp(alts[j].pattern).test(n)) {
          return { result: 'alt', feedback: alts[j].feedback || '', normalized: n };
        }
      }
      return {
        result: 'unmatched',
        feedback: '登録されている正答例・よくある誤りのどちらとも一致しなかったため、自動では判定していません。誤りと決まったわけではありません。正答例と見比べてみてください。',
        normalized: n
      };
    }
    throw new Error('未対応の形式: ' + q.format);
  }

  /** 画面表示用の回答テキスト */
  function responseText(q, response) {
    if (response == null) return '';
    if (q.format === 'fill' || q.format === 'meaning') {
      var c = findChoice(q, response);
      return c ? c.text : String(response);
    }
    if (Array.isArray(response)) return response.join(' ');
    return String(response);
  }

  var RESULT_INFO = {
    correct:   { mark: '○', label: '正解', tone: 'ok' },
    minor:     { mark: '○', label: '不定詞は正解（ほかに小さな直し）', tone: 'ok' },
    alt:       { mark: '△', label: '別の正しい表現', tone: 'hold' },
    incorrect: { mark: '×', label: '不正解', tone: 'ng' },
    unmatched: { mark: '？', label: '判定保留（自動判定できない答え）', tone: 'hold' },
    gaveup:    { mark: '—', label: '「わからない」を選択', tone: 'ng' }
  };

  /** 不定詞の理解の根拠として「自力で解けた」と数えてよい結果か */
  function isSkillCorrect(result) {
    return result === 'correct' || result === 'minor';
  }
  /** はっきりした誤りか（判定保留・別表現は含めない） */
  function isSkillWrong(result) {
    return result === 'incorrect' || result === 'gaveup';
  }

  EA.grading = {
    normalize: normalize,
    grade: grade,
    responseText: responseText,
    RESULT_INFO: RESULT_INFO,
    isSkillCorrect: isSkillCorrect,
    isSkillWrong: isSkillWrong
  };
})(typeof window !== 'undefined' ? window : globalThis);
