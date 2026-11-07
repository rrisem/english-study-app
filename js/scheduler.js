/*
 * scheduler.js — 復習予定のルール（説明できる単純なルール）
 *
 * 復習予定は「知識・技能（skill）」ごとに1つ持ちます。
 * 段階 step に対応する日数は data/config.js の reviewIntervalsDays（初期値 1・3・7・14・30日）。
 *
 * 1回の学習（セッション）が終わったとき、その skill の回答をまとめて次のどれかに分類します。
 *   安定  … 解き直し以外の回答がすべて「ヒントなし・自信がない申告なし」で正解
 *   不安定 … 誤り・「わからない」がある
 *   途中  … それ以外（ヒントあり、自信がない、判定保留、解説直後の正解だけ など）
 *
 *   初回診断：安定 → 段階 firstStepWhenStrong（初期値1＝3日後）、それ以外 → 段階0（1日後）
 *   類題（解説のあと）：解説直後の正解だけでは延ばさない。不安定なら段階0、それ以外は今の段階のまま
 *   復習：安定 → 段階を1つ上げる / 途中 → 同じ段階 / 不安定 → 段階0に戻す
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};
  var G = EA.grading;

  function classify(attempts) {
    var main = attempts.filter(function (a) { return a.attemptType !== 'retry'; });
    if (main.length === 0) main = attempts;
    if (main.length === 0) return 'none';
    if (main.some(function (a) { return G.isSkillWrong(a.result); })) return 'weak';
    if (main.every(function (a) { return EA.mastery.isSolid(a); })) return 'strong';
    return 'partial';
  }

  var OUTCOME_LABEL = { strong: '自力で安定して正解', partial: 'ヒント・自信なし・判定保留などあり', weak: '誤りあり' };

  /**
   * セッション終了時に呼ぶ。schedule（state.schedule）を書き換え、変更内容を返す。
   * sessionType: 'diagnostic' | 'practice' | 'review'
   */
  function applySession(schedule, sessionType, attempts, now, config, bank) {
    var intervals = config.reviewIntervalsDays;
    var maxStep = intervals.length - 1;
    var bySkill = {};
    attempts.forEach(function (a) {
      if (bank && EA.mastery.isExcluded(a, bank)) return;
      (bySkill[a.skillId] = bySkill[a.skillId] || []).push(a);
    });

    var changes = [];
    Object.keys(bySkill).forEach(function (skillId) {
      var outcome = classify(bySkill[skillId]);
      if (outcome === 'none') return;
      var cur = schedule[skillId];
      var oldStep = cur ? cur.step : null;
      var step, why;

      if (sessionType === 'diagnostic' || !cur) {
        step = outcome === 'strong' ? Math.min(config.firstStepWhenStrong, maxStep) : 0;
        why = outcome === 'strong' ? '初回から自力で安定して正解' : '初回に' + OUTCOME_LABEL[outcome] + '→ 早めに確認';
      } else if (sessionType === 'practice') {
        if (outcome === 'weak') { step = 0; why = '解説後の類題でも誤りあり → 早めに確認'; }
        else { step = cur.step; why = '解説直後の正解のため、間隔は延ばさない'; }
      } else {
        if (outcome === 'strong') { step = Math.min(cur.step + 1, maxStep); why = '復習で自力正解 → 間隔を延ばす'; }
        else if (outcome === 'partial') { step = cur.step; why = '復習で' + OUTCOME_LABEL.partial + ' → 同じ間隔でもう一度'; }
        else { step = 0; why = '復習で誤りあり → 1日後にもう一度'; }
      }

      var dueAt = EA.util.addDays(now, intervals[step]);
      var entry = {
        skillId: skillId,
        step: step,
        intervalDays: intervals[step],
        dueAt: dueAt,
        lastOutcome: outcome,
        lastReason: why,
        updatedAt: now,
        history: ((cur && cur.history) || []).concat([{ at: now, sessionType: sessionType, outcome: outcome, fromStep: oldStep, toStep: step, dueAt: dueAt, why: why }])
      };
      schedule[skillId] = entry;
      changes.push(entry);
    });
    return changes;
  }

  /** 今日までに期限が来ている skill（優先度順） */
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

  EA.scheduler = { classify: classify, applySession: applySession, dueSkills: dueSkills, OUTCOME_LABEL: OUTCOME_LABEL };
})(typeof window !== 'undefined' ? window : globalThis);
