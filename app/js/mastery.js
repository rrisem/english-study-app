/*
 * mastery.js — 「アプリ内での確認状況」の判定（ルールのみ・表示とは独立）
 *
 * これは「このアプリの中で何を確認できたか」を示すもので、習得を保証するものではありません。
 * 2つを分けて持ちます。
 *
 * ■ これまでの確認実績（achievement）… 過去の事実。あとで間違えても消しません。
 *   1 自力で1問正解        … 自力正解（下の定義）が1問
 *   2 別の問題でも自力正解  … 異なる2問以上で自力正解
 *   3 後日の復習でも正解    … 2 に加え、前回の回答から spacedLevelMinDays 日以上空けた「復習」で自力正解
 *   自力正解 ＝ 不定詞の部分が正解・ヒントなし・解き直しではない・同じ学習回で解説を見たあとではない・「自信がない」なし
 *
 * ■ 現在の再確認の必要（issues）… 最近のつまずき。条件を満たすまで残ります。
 *   error   最近の誤答（不正解・「わからない」）
 *   meaning 答えは正解だが、意味・理由の問いで違う選択（または意味の確認問題で誤り）
 *   hint    ヒントを使って正解
 *   unsure  自力で正解したが、本人は「自信がない」
 *   解消の条件：
 *     error / hint … つまずいた学習回とは別の学習回で、別の問題に自力正解
 *     meaning      … つまずいた学習回とは別の学習回で、別の問題の意味・理由の問いに、
 *                    日本語訳・解説・ヒントを見ずに正解（訳を見たあとの正解は「参考」で、解消には使わない）
 *     unsure       … そのあと別の問題に、自信がないの申告なしで自力正解
 *   同じ学習回の中で解説を見たあとの正解は、「解説後の正解」として記録しますが、解消には使いません。
 *
 * ■ 採点保留（自動で判定できない答え）・指定の形と違う答え は、正解にも誤りにも数えません。
 * ■ 解答時間は判定に使いません。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var G = EA.grading;

  var ACHIEVEMENTS = [
    { level: 0, label: 'まだ自力の正解なし' },
    { level: 1, label: '自力で1問正解・追加確認前' },
    { level: 2, label: '別の問題でも自力正解' },
    { level: 3, label: '後日の復習でも正解' }
  ];

  var ISSUE_LABEL = {
    error: '最近の誤答あり・再確認が必要',
    meaning: '答えは正解・意味の再確認が必要',
    hint: 'ヒントを使って正解・自力で再確認',
    unsure: '自力で正解・本人は自信なし'
  };

  var RESOLVE_RULE = {
    error: '別の日の学習で、別の問題をヒント・解説なしで正解すると解消します。',
    meaning: '別の日の学習で、別の問題の意味・理由の問いに正解すると解消します。',
    hint: '別の日の学習で、別の問題をヒントなしで正解すると解消します。',
    unsure: '別の問題を、「自信がない」を押さずに自力で正解すると解消します。'
  };

  function cfg(k, d) { return (EA.config && EA.config[k] != null) ? EA.config[k] : d; }

  /** 問題の不備・開発用の日付で作られた記録など、判定から除外する回答か */
  function isExcluded(attempt, bank) {
    if (attempt.devDated) return true;
    var q = EA.findQuestion(bank, attempt.questionId);
    if (!q) return true;
    if (q.status === 'excluded') return true;
    if (q.excludedVersions && q.excludedVersions.indexOf(attempt.questionVersion) >= 0) return true;
    return false;
  }

  /**
   * 理由・意味の問いの回答を判定に使えるか（古い版の設問への回答は使わない）。
   * 設問の版は reasonVersion（答えたときの問題の版）で見る。古い記録にはないので questionVersion で見る。
   * （問題データの更新前に始めた学習を更新後に再開し、新しい設問に答えた場合は、新しい版の回答として扱う）
   */
  function reasonResult(a, bank) {
    if (!a.reason || typeof a.reason.correct !== 'boolean') return null;
    var q = EA.findQuestion(bank, a.questionId);
    var v = a.reason.reasonVersion || a.questionVersion;
    if (q && q.reasonValidFrom && v < q.reasonValidFrom) return null;
    return !!a.reason.correct;
  }

  /** 意味の問いにまだ答えていない回答（途中でホームへ戻った）。答えるまで判定の根拠にしない */
  function isPending(a) { return !!a.reasonPending; }

  /** 自力正解：不定詞部分が正解・ヒントなし・解き直しでない・解説後でない（自信の申告は別に見る） */
  function isIndependentCorrect(a) {
    return G.isSkillCorrect(a.result) && !a.hintUsed && a.attemptType !== 'retry' && !a.afterExplanation;
  }
  /** 自力正解で、しかも「自信がない」の申告なし（＝自力で安定して正解） */
  function isSolid(a) {
    return isIndependentCorrect(a) && a.confidence !== 'unsure';
  }

  /**
   * 答える前に、その英文の日本語訳を見ていたか。
   * 新しい記録は translationShown を持つ。古い記録は、当時の問題の出し方から推定する。
   */
  function sawTranslation(a, bank) {
    if (typeof a.translationShown === 'boolean') return a.translationShown;
    if (a.format === 'meaning') return false;
    if (a.format === 'fill') {
      var q = EA.findQuestion(bank, a.questionId);
      return !(q && q.showJa === 'after' && a.questionVersion >= (q.showJaAfterFrom || q.version));
    }
    return true; // 並び替え・日→英は日本語を見て答える
  }

  /**
   * 意味・理由の確認の結果。null ＝ 確認していない（理由を聞かなかった回答は「理解している」とは扱わない）
   *   ok          正しいか
   *   independent 日本語訳・解説・ヒントを見ずに答えたか（true のときだけ意味理解の根拠にする。false は参考）
   */
  function meaningCheck(a, bank) {
    var r = reasonResult(a, bank);
    var indep = !a.hintUsed && !a.afterExplanation && a.attemptType !== 'retry';
    if (r !== null) return { ok: r, independent: indep && !sawTranslation(a, bank), via: 'reason' };
    if (a.format === 'meaning') return { ok: G.isSkillCorrect(a.result), independent: indep, via: 'meaning' };
    return null;
  }

  function analyze(skillId, attempts, bank) {
    var all = attempts.filter(function (a) { return a.skillId === skillId; })
      .sort(function (x, y) { return x.answeredAt - y.answeredAt; });
    var counted = all.filter(function (a) { return !isExcluded(a, bank) && !isPending(a); });
    var pending = all.filter(function (a) { return !isExcluded(a, bank) && isPending(a); }).length;

    var c = { diagnostic: 0, retry: 0, similar: 0, followup: 0, review: 0 };
    var solidQs = {}, spaced = null;
    var n = { solid: 0, unsure: 0, hint: 0, afterExpl: 0, wrong: 0, hold: 0, retryOk: 0, otherAfterExplOk: 0, reviewSolid: 0,
      mIndepOk: 0, mIndepNg: 0, mRefOk: 0, mRefNg: 0 };
    var issues = {};           // type → { since, sessionId, questionId, count }
    var meaningIndepOk = false, meaningRefOk = false;
    var afterExplCorrectSinceError = 0;

    function open(type, a) {
      var i = issues[type];
      if (i) { i.count++; i.last = a; return; }
      issues[type] = { type: type, since: a, last: a, sessionId: a.sessionId, questionId: a.questionId, count: 1, afterExplErrors: 0 };
    }
    function laterSessionOtherQuestion(i, a) {
      return a.sessionId !== i.sessionId && a.questionId !== i.questionId && a.answeredAt > i.last.answeredAt;
    }

    counted.forEach(function (a, idx) {
      c[a.attemptType] = (c[a.attemptType] || 0) + 1;
      var mc = meaningCheck(a, bank);
      var wrong = G.isSkillWrong(a.result);
      var correct = G.isSkillCorrect(a.result);
      var indep = isIndependentCorrect(a);
      var solid = isSolid(a);

      // ---- 解消の判定（この回答より前に開いていたもの）
      if (issues.error && solid && laterSessionOtherQuestion(issues.error, a)) delete issues.error;
      if (issues.hint && solid && laterSessionOtherQuestion(issues.hint, a)) delete issues.hint;
      if (issues.meaning && mc && mc.ok && mc.independent && laterSessionOtherQuestion(issues.meaning, a)) delete issues.meaning;
      if (issues.unsure && solid && a.questionId !== issues.unsure.questionId) delete issues.unsure;

      // ---- 数える
      if (a.result === 'unmatched' || a.result === 'alt') n.hold++;
      if (wrong) { n.wrong++; open('error', a); if (a.afterExplanation || a.attemptType === 'retry') issues.error.afterExplErrors++; delete issues.hint; delete issues.unsure; afterExplCorrectSinceError = 0; }
      if (correct && a.hintUsed) { n.hint++; if (!issues.error) open('hint', a); }
      if (correct && !a.hintUsed && (a.afterExplanation || a.attemptType === 'retry')) {
        n.afterExpl++;
        if (a.attemptType === 'retry') n.retryOk++; else n.otherAfterExplOk++;
        if (issues.error && a.questionId !== issues.error.questionId) afterExplCorrectSinceError++;
      }
      if (indep && a.confidence === 'unsure') { n.unsure++; if (!issues.error && !issues.hint) open('unsure', a); }
      if (mc) {
        if (mc.ok && mc.independent) { n.mIndepOk++; meaningIndepOk = true; }
        if (mc.ok && !mc.independent) { n.mRefOk++; meaningRefOk = true; }
        if (!mc.ok) {
          if (mc.independent) n.mIndepNg++; else n.mRefNg++;
          // 理由・意味の誤りは、訳を見たあとでも「再確認が必要」の合図として扱う（理解していないとは断定しない）
          open('meaning', a);
        }
      }
      if (solid) {
        n.solid++;
        if (a.attemptType === 'review') n.reviewSolid++;
        solidQs[a.questionId] = true;
        if (a.attemptType === 'review' && idx > 0) {
          var prev = counted[idx - 1];
          if (EA.util.dayDiff(prev.answeredAt, a.answeredAt) >= cfg('spacedLevelMinDays', 3)) spaced = a;
        }
      }
    });

    var distinct = Object.keys(solidQs).length;
    var achievement = 0;
    if (distinct >= 1) achievement = 1;
    if (distinct >= 2) achievement = 2;
    if (achievement === 2 && spaced) achievement = 3;

    var order = ['error', 'meaning', 'hint', 'unsure'];
    var issueList = order.filter(function (t) { return issues[t]; }).map(function (t) {
      var i = issues[t];
      return { type: t, label: ISSUE_LABEL[t], since: i.since.answeredAt, questionId: i.questionId, count: i.count, rule: RESOLVE_RULE[t] };
    });
    // 講師に相談する候補：最近の誤答が2回以上あり、そのうち解説を見たあとの誤答がある（説明を読んでもつまずいた）
    var teacherCandidate = !!(issues.error && issues.error.count >= 2 && issues.error.afterExplErrors >= 1);

    var headline, tone;
    if (counted.length === 0) { headline = 'まだ回答なし'; tone = 'none'; }
    else if (issueList.length) {
      headline = issueList[0].label; tone = issueList[0].type === 'unsure' ? 'note' : 'recheck';
      if (teacherCandidate) headline = 'くり返し誤答・講師に相談する候補';
    } else if (achievement > 0) { headline = ACHIEVEMENTS[achievement].label; tone = 'ok'; }
    else if (n.afterExpl) { headline = '解説後に正解・自力の確認はまだ'; tone = 'note'; }
    else if (n.hold) { headline = '採点保留のみ（自動で判定できない答え）'; tone = 'none'; }
    else { headline = 'まだ自力の正解なし'; tone = 'none'; }

    // 意味の確認：recheck 再確認が必要 / confirmed 訳を見ずに確認できた / reference 訳・解説を見たあとの回答だけ（参考）/ unchecked まだ
    var meaning = issues.meaning ? 'recheck' : (meaningIndepOk ? 'confirmed' : (meaningRefOk ? 'reference' : 'unchecked'));

    var evidence = [];
    if (counted.length) {
      evidence.push('回答 ' + counted.length + '回（初回診断 ' + c.diagnostic + '・解き直し ' + c.retry + '・類題 ' + c.similar +
        '・確認問題 ' + c.followup + '・復習 ' + c.review + '）');
      evidence.push('自力で安定して正解：' + n.solid + '回（異なる問題 ' + distinct + '問）');
      if (n.unsure) evidence.push('自力で正解・自信なし：' + n.unsure + '回');
      if (n.hint) evidence.push('ヒントを使って正解：' + n.hint + '回');
      if (n.afterExpl) evidence.push('解説を見たあとの正解：' + n.afterExpl + '回（自力の正解には数えていません）');
      if (n.wrong) evidence.push('不正解・「わからない」：' + n.wrong + '回');
      if (n.hold) evidence.push('採点保留・指定の形と違う答え：' + n.hold + '回（正解にも誤りにも数えていません）');
      if (n.retryOk) evidence.push('同じ問題の解き直しで正解：' + n.retryOk + '回');
      if (n.otherAfterExplOk) evidence.push('別の問題・解説直後に正解：' + n.otherAfterExplOk + '回（直後の確認）');
      if (n.reviewSolid) evidence.push('後日の復習で自力正解：' + n.reviewSolid + '回');
      if (n.mIndepOk + n.mIndepNg) evidence.push('意味・理由の問い（訳を見ずに）：正しい ' + n.mIndepOk + '回・違う ' + n.mIndepNg + '回');
      if (n.mRefOk + n.mRefNg) evidence.push('意味・理由の問い（訳・解説を見たあと＝参考）：正しい ' + n.mRefOk + '回・違う ' + n.mRefNg + '回');
      if (spaced) evidence.push(EA.util.fmtDate(spaced.answeredAt) + 'の復習で、日を空けて自力正解');
      if (issues.error && afterExplCorrectSinceError) evidence.push('誤答のあと、解説後に別の問題で正解：' + afterExplCorrectSinceError + '回（自力の確認はまだ）');
    } else {
      evidence.push('まだ回答がありません。');
    }
    var excluded = all.length - counted.length - pending;
    if (excluded) evidence.push('判定から除外した回答：' + excluded + '回（問題の修正・開発用の日付など）');
    if (pending) evidence.push('意味の問いが未回答の回答：' + pending + '回（途中の学習で答えると判定に使います）');

    return {
      skillId: skillId,
      attemptCount: counted.length,
      achievement: achievement,
      achievementLabel: ACHIEVEMENTS[achievement].label,
      issues: issueList,
      needsRecheck: issueList.some(function (i) { return i.type !== 'unsure'; }),
      unsure: !!issues.unsure,
      teacherCandidate: teacherCandidate,
      meaning: meaning,
      headline: headline,
      tone: tone,
      evidence: evidence,
      counts: n,
      distinctSolid: distinct
    };
  }

  EA.mastery = {
    ACHIEVEMENTS: ACHIEVEMENTS,
    ISSUE_LABEL: ISSUE_LABEL,
    RESOLVE_RULE: RESOLVE_RULE,
    isExcluded: isExcluded,
    isPending: isPending,
    isIndependentCorrect: isIndependentCorrect,
    isSolid: isSolid,
    meaningCheck: meaningCheck,
    sawTranslation: sawTranslation,
    reasonResult: reasonResult,
    analyze: analyze
  };
})(typeof window !== 'undefined' ? window : globalThis);
