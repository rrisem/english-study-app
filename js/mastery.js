/*
 * mastery.js — 「アプリ内での確認状況」の判定（ルールのみ）
 *
 * これは「このアプリの中でどこまで確認できたか」を示すもので、
 * 実際に習得したことを保証するものではありません。
 *
 * 段階と条件（docs/design.md にも同じ説明があります）
 *   0 まだ確認が足りない   … 自力での正解がまだない
 *   1 ヒントや解説があれば解ける … ヒントあり・解説直後の解き直し・「自信がない」での正解、
 *                             または自力の正解が1問だけ、または直近の回答が誤り
 *   2 別の問題でも自力で解けた … 2つ以上の異なる問題で、ヒントなし・自信がない申告なしで正解し、
 *                             直近の回答が誤りではない
 *   3 時間を空けても解けた   … 2の条件に加えて、前回の回答から一定日数（config の spacedLevelMinDays、初期値3日）以上空けた「復習」で自力正解
 *
 * 解答時間は判定に使いません（講師向けの参考情報として記録だけします）。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var G = EA.grading;

  var LEVELS = [
    { level: 0, label: 'まだ確認が足りない', short: '確認中' },
    { level: 1, label: 'ヒントや解説があれば解ける', short: 'ヒントで解ける' },
    { level: 2, label: '別の問題でも自力で解けた', short: '別の問題でも○' },
    { level: 3, label: '時間を空けても解けた', short: '時間を空けて○' }
  ];

  /** 問題の不備などで判定から除外する回答か */
  function isExcluded(attempt, bank) {
    var q = EA.findQuestion(bank, attempt.questionId);
    if (!q) return true;
    if (q.status === 'excluded') return true;
    if (q.excludedVersions && q.excludedVersions.indexOf(attempt.questionVersion) >= 0) return true;
    return false;
  }

  /** ヒントなし・解き直しではない・自信がない申告なし・不定詞部分が正解 */
  function isSolid(a) {
    return G.isSkillCorrect(a.result) && !a.hintUsed && a.attemptType !== 'retry' && a.confidence !== 'unsure';
  }

  function computeSkillStatus(skillId, attempts, bank) {
    var all = attempts.filter(function (a) { return a.skillId === skillId; })
      .sort(function (x, y) { return x.answeredAt - y.answeredAt; });
    var counted = all.filter(function (a) { return !isExcluded(a, bank); });
    var excludedCount = all.length - counted.length;

    var byType = { diagnostic: 0, retry: 0, similar: 0, review: 0 };
    var solidQuestions = {};
    var hintCorrect = 0, retryCorrect = 0, unsureCorrect = 0, unsureCount = 0, hold = 0, wrong = 0;
    var spacedSolid = null;

    counted.forEach(function (a, i) {
      byType[a.attemptType] = (byType[a.attemptType] || 0) + 1;
      if (a.confidence === 'unsure') unsureCount++;
      if (a.result === 'unmatched' || a.result === 'alt') hold++;
      if (G.isSkillWrong(a.result)) wrong++;
      if (G.isSkillCorrect(a.result)) {
        if (a.attemptType === 'retry') retryCorrect++;
        else if (a.hintUsed) hintCorrect++;
        else if (a.confidence === 'unsure') unsureCorrect++;
      }
      if (isSolid(a)) {
        solidQuestions[a.questionId] = true;
        if (a.attemptType === 'review' && i > 0) {
          var prev = counted[i - 1];
          if (EA.util.dayDiff(prev.answeredAt, a.answeredAt) >= ((EA.config && EA.config.spacedLevelMinDays) || 3)) spacedSolid = a;
        }
      }
    });

    var solidCount = Object.keys(solidQuestions).length;
    var latest = counted[counted.length - 1] || null;
    var latestWrong = !!(latest && G.isSkillWrong(latest.result));
    var anyCorrect = solidCount + hintCorrect + retryCorrect + unsureCorrect > 0;

    var level = 0;
    if (anyCorrect) level = 1;
    if (solidCount >= 2 && !latestWrong) level = 2;
    if (level === 2 && spacedSolid) level = 3;
    if (latestWrong && level > 1) level = 1;

    var evidence = [];
    if (counted.length === 0) {
      evidence.push('まだ回答がありません。');
    } else {
      evidence.push('回答 ' + counted.length + '回（初回診断 ' + byType.diagnostic + '・解き直し ' + byType.retry +
        '・類題 ' + byType.similar + '・復習 ' + byType.review + '）');
      evidence.push('ヒントなし・自信がない申告なしで正解した問題：' + solidCount + '問');
      if (hintCorrect) evidence.push('ヒントを見て正解：' + hintCorrect + '回');
      if (retryCorrect) evidence.push('解説直後の解き直しで正解：' + retryCorrect + '回（自力の正解には数えていません）');
      if (unsureCorrect) evidence.push('「自信がない」を押して正解：' + unsureCorrect + '回');
      if (wrong) evidence.push('誤り・「わからない」：' + wrong + '回');
      if (hold) evidence.push('判定保留・別の表現：' + hold + '回（誤りとしては数えていません）');
      if (spacedSolid) evidence.push(EA.util.fmtDate(spacedSolid.answeredAt) + 'の復習で、日を空けて自力正解');
      if (latestWrong) evidence.push('直近の回答が誤りだったため、段階を「ヒントや解説があれば解ける」までにしています。');
    }
    if (excludedCount) evidence.push('問題の不備により判定から除外した回答：' + excludedCount + '回');

    return {
      skillId: skillId,
      level: level,
      label: LEVELS[level].label,
      short: LEVELS[level].short,
      evidence: evidence,
      attemptCount: counted.length,
      latest: latest
    };
  }

  EA.mastery = {
    LEVELS: LEVELS,
    isExcluded: isExcluded,
    isSolid: isSolid,
    computeSkillStatus: computeSkillStatus
  };
})(typeof window !== 'undefined' ? window : globalThis);
