// 実際の判定ロジックで、2人の生徒の学習を再現して表示する（設計資料の学習例の根拠）
// 使い方： node tools/scenario.mjs
import { setup } from '../tests/helpers.mjs';

const TYPE = { diagnostic: '初回診断', retry: '解き直し', similar: '類題', followup: '確認問題', review: '復習' };
const RES = { correct: '○', minor: '○', incorrect: '×', gaveup: '—', unmatched: '？', alt: '△' };
function line(c, a) {
  const q = c.q(a.questionId);
  const why = a.reasonDecision ? a.reasonDecision.why : '';
  const r = a.reason ? `／意味の問い ${a.reason.correct ? '○' : '×'}${a.reason.independent ? '（訳なし）' : '（参考）'}` : (why && why !== 'not-applicable' ? `／意味の問いなし（${why}）` : '');
  return `  ${TYPE[a.attemptType]}  ${q.id}（${q.format}${q.showJa === 'after' ? '・英文だけ' : ''}）答え ${RES[a.result]}${a.confidence === 'unsure' ? '・自信なし' : ''}${a.afterExplanation ? '・解説後' : ''}${r}${a.followUp && a.followUp.added ? ` → 確認問題 ${a.followUp.added}` : ''}`;
}
function run(c, decide) {
  const before = c.state.attempts.length;
  while (c.state.activeSession) {
    const it = c.current();
    const d = it.kind === 'explain' ? {} : (decide(it) || {});
    c.answer(d.how || 'correct', d);
  }
  c.state.attempts.slice(before).forEach((a) => console.log(line(c, a)));
}
function status(c, label) {
  console.log(`  ── ${label}`);
  for (const sk of c.bank.skills) {
    const st = c.EA.mastery.analyze(sk.id, c.state.attempts, c.bank);
    const sch = c.state.schedule[sk.id];
    console.log(`    ${sk.label}：${st.headline}／実績■${st.achievement}／意味の確認 ${st.meaning}／次回 ${sch ? c.EA.util.dayDiff(c.t().app, sch.dueAt) + '日後' : '—'}`);
  }
}
function student(name, diagPlan, practiceDecide, reviewDecide) {
  console.log(`\n■ ${name}`);
  const c = setup();
  console.log(' 1日目：初回診断');
  c.start(c.EA.planner.buildDiagnosticSession(c.bank, c.t().app));
  run(c, (it) => diagPlan[it.questionId] || {});
  console.log(' 1日目：解説と類題');
  c.start(c.EA.planner.buildPracticeSession(c.state, c.bank, c.t().app));
  run(c, practiceDecide);
  status(c, '1日目の終わり');
  for (const day of [1, 4, 7]) {
    c.setDay(day);
    if (!c.EA.planner.dueReviews(c.state, c.bank, c.t().app).length) continue;
    console.log(` ${day + 1}日目：復習`);
    c.start(c.EA.planner.buildReviewSession(c.state, c.bank, c.t().app));
    run(c, (it) => reviewDecide(it, day));
    status(c, `${day + 1}日目の終わり`);
  }
}

student('生徒A：診断で「〜すること」を間違え、類題で意味の問いを取り違える',
  { 'inf-d1': { how: 'wrong' } },
  (it) => it.attemptType === 'similar' ? { reason: false } : {},
  () => ({}));
student('生徒B：診断・類題はすべて正解。5日目の復習で「〜するために」を自信なしで正解',
  {}, () => ({}),
  (it, day) => (day === 4 && it.forSkill === 'inf-adv' && it.questionId === 'inf-p-v2' ? { unsure: true } : {}));
