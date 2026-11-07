/*
 * config.js — 学習ルールの設定（講師が調整してよい値）
 *
 * ここにある数字は「仮の初期設定」です。全員に当てはまる忘却曲線ではありません。
 * 塾での試用結果を見て、自由に変更してください。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};

  EA.config = {
    // 復習の間隔（日数）。段階 0 → 1 → 2 … と進みます。
    reviewIntervalsDays: [1, 3, 7, 14, 30],

    // 初回の学習（診断＋類題）のあと、自力で安定して正解できた場合に始める段階。
    // 1 なら「3日後」から。それ以外（誤答・自信なし・ヒント・解説後の正解のみ）は段階 0（1日後）。
    firstStepWhenStrong: 1,

    // 1回の復習で扱う「知識・技能」の最大数。休んで溜まっても一度に押し付けないための上限です。
    maxReviewSkillsPerSession: 3,

    // 復習で 1つの知識・技能につき出す問題数
    questionsPerReviewSkill: 2,

    // 確認状況「時間を空けても解けた」に必要な、前回の回答からの間隔（日数）
    spacedLevelMinDays: 3,

    // 毎日の学習時間の目標（分）。設定画面で変更できます。
    defaultDailyGoalMinutes: 10,

    // 1問あたり、学習時間に数える上限（ミリ秒）。画面を開いたまま放置した時間を除くため。
    maxCountedMsPerQuestion: 5 * 60 * 1000
  };
})(typeof window !== 'undefined' ? window : globalThis);
