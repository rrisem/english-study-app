/*
 * scheduler.js — 復習予定のルール（説明できる単純なルール）
 *
 * 復習予定は「知識・技能（skill）」ごとに1つ。段階 step に対応する日数は data/config.js の
 * reviewIntervalsDays（初期値 1・3・7・14・30日）。この日数は調整用の仮の値で、
 * 全員に当てはまる「正しい間隔」ではありません。
 *
 * 学習回（セッション）が終わるたびに、その学習回で回答した skill について次の順に決めます。
 * （確認状況 mastery.analyze の「現在の再確認の必要」と同じ根拠を使うので、表示と予定が食い違いません）
 *   1. 最近の誤答・意味の再確認・ヒント使用が残っている → 段階0（1日後）
 *   2. 「自信がない」が残っている                     → 段階1以下（3日以内）
 *   3. 初回診断で、回答がすべて自力で安定して正解       → 段階 firstStepWhenStrong（3日後）
 *      初回診断でそれ以外                             → 段階0（1日後）
 *   4. 類題・確認問題（解説のあと）                   → 今の段階のまま（解説直後の正解では延ばさない）
 *   5. 復習で、自力で安定して正解し、意味・理由の問いも違っていない → 段階を1つ上げる
 *   6. 復習で、採点保留・指定の形と違う答えだけ        → 今の段階のまま（理解不足とは決めつけない）
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var G = EA.grading;

  /**
   * schedule: state.schedule（書き換える）/ sessionAttempts: この学習回の回答 / allAttempts: これまでの全回答（今回を含む）
   */
  function applySession(schedule, sessionType, sessionAttempts, allAttempts, now, config, bank) {
    var intervals = config.reviewIntervalsDays;
    var maxStep = intervals.length - 1;
    var bySkill = {};
    sessionAttempts.forEach(function (a) {
      if (EA.mastery.isExcluded(a, bank)) return;
      (bySkill[a.skillId] = bySkill[a.skillId] || []).push(a);
    });

    var changes = [];
    Object.keys(bySkill).forEach(function (skillId) {
      var list = bySkill[skillId];
      var st = EA.mastery.analyze(skillId, allAttempts, bank);
      var cur = schedule[skillId];
      var curStep = cur ? cur.step : 0;
      var types = st.issues.map(function (i) { return i.type; });
      var step, why;

      var solidNoMeaningNg = list.filter(function (a) {
        var mc = EA.mastery.meaningCheck(a, bank);
        return EA.mastery.isSolid(a) && !(mc && !mc.ok);
      });
      var onlyHold = list.every(function (a) { return a.result === 'unmatched' || a.result === 'alt'; });

      if (types.indexOf('error') >= 0) { step = 0; why = '最近の誤答あり → 1日後に別の問題で再確認'; }
      else if (types.indexOf('meaning') >= 0) { step = 0; why = '答えは正解・意味の問いが違った → 1日後に意味を再確認'; }
      else if (types.indexOf('hint') >= 0) { step = 0; why = 'ヒントを使って正解 → 1日後に自力で再確認'; }
      else if (types.indexOf('unsure') >= 0) {
        step = Math.min(curStep, 1);
        why = '自力で正解・本人は自信なし → ' + intervals[step] + '日後に再確認（間隔を延ばさない）';
      } else if (sessionType === 'diagnostic') {
        var strong = list.every(function (a) { return EA.mastery.isSolid(a); });
        step = strong ? Math.min(config.firstStepWhenStrong, maxStep) : 0;
        why = strong ? '初回から自力で安定して正解 → ' + intervals[step] + '日後' : '初回は確認が足りない → 1日後';
      } else if (sessionType === 'practice') {
        step = curStep; why = '解説直後の正解のため、間隔は延ばさない';
      } else if (onlyHold) {
        step = curStep; why = '採点保留・指定の形と違う答えのみ → 同じ間隔（理解不足とは扱わない）';
      } else if (solidNoMeaningNg.length && list[0] && EA.mastery.isSolid(list[0])) {
        step = Math.min(curStep + 1, maxStep);
        why = '復習で自力で安定して正解 → 間隔を ' + intervals[curStep] + '日から ' + intervals[step] + '日へ';
      } else {
        step = curStep; why = '解説後の正解のみ → 同じ間隔';
      }

      var dueAt = EA.util.addDays(now, intervals[step]);
      var entry = {
        skillId: skillId, step: step, intervalDays: intervals[step], dueAt: dueAt,
        lastReason: why, updatedAt: now,
        history: ((cur && cur.history) || []).concat([{ at: now, sessionType: sessionType, fromStep: cur ? cur.step : null, toStep: step, dueAt: dueAt, why: why }])
      };
      schedule[skillId] = entry;
      changes.push(entry);
    });
    return changes;
  }

  /** 今日までに期限が来ている skill（優先度の小さい順 → 期限の古い順） */
  function dueSkills(schedule, now, priorityOf) {
    var today = EA.util.startOfDay(now);
    return Object.keys(schedule)
      .map(function (k) { return schedule[k]; })
      .filter(function (e) { return e.dueAt <= today; })
      .sort(function (a, b) {
        var pa = priorityOf ? priorityOf(a) : 0, pb = priorityOf ? priorityOf(b) : 0;
        if (pa !== pb) return pa - pb;
        return a.dueAt - b.dueAt;
      });
  }

  EA.scheduler = { applySession: applySession, dueSkills: dueSkills };
})(typeof window !== 'undefined' ? window : globalThis);
