// 問題集の形式チェック： node tools/validate-bank.mjs
import { loadEA } from './load.mjs';
const EA = loadEA();
const N = EA.grading.normalize;
const problems = [];
const warn = (id, msg) => problems.push(`${id}: ${msg}`);

for (const bank of Object.values(EA.banks)) {
  const ids = new Set();
  const skills = new Set(bank.skills.map((s) => s.id));
  for (const q of bank.questions) {
    if (ids.has(q.id)) warn(q.id, 'IDが重複しています');
    ids.add(q.id);
    if (!skills.has(q.skill)) warn(q.id, `skill「${q.skill}」が skills にありません`);
    if (typeof q.version !== 'number') warn(q.id, 'version は数字にしてください');
    for (const k of ['checks', 'instruction', 'hint', 'explanation']) if (!q[k]) warn(q.id, `${k} がありません`);
    if (q.format === 'fill' || q.format === 'meaning') {
      if (!q.choices.some((c) => c.id === q.answer)) warn(q.id, 'answer が選択肢にありません');
      if (q.format === 'fill' && !q.sentence.includes('___')) warn(q.id, 'sentence に空所 ___ がありません');
      if (q.format === 'fill') {
        const filled = q.sentence.replace('___', q.choices.find((c) => c.id === q.answer).text);
        if (N(filled) !== N(q.explanation.answer)) warn(q.id, `正答を入れた文「${filled}」が解説の英文と一致しません`);
      }
    } else if (q.format === 'order') {
      for (const a of q.answers) {
        if (N(a).split(' ').sort().join(' ') !== N(q.tokens.join(' ')).split(' ').sort().join(' ')) warn(q.id, `正答「${a}」が語句と一致しません`);
      }
      if (N(q.answers[0]) !== N(q.explanation.answer)) warn(q.id, '正答が解説の英文と一致しません');
    } else if (q.format === 'ja2en') {
      if (!q.accepted?.length) warn(q.id, 'accepted がありません');
      for (const e of [...(q.errors || []), ...(q.alternatives || [])]) {
        let re; try { re = new RegExp(e.pattern); } catch { warn(q.id, `正規表現が不正: ${e.pattern}`); continue; }
        for (const a of q.accepted) if (re.test(N(a))) warn(q.id, `正答「${a}」が誤り・別表現のパターンにも一致します`);
      }
      if (EA.grading.grade(q, q.explanation.answer).result !== 'correct') warn(q.id, '解説の英文が正答として判定されません');
    } else warn(q.id, `未対応の形式 ${q.format}`);
    const joined = q.explanation.chunks.map((c) => c.en).join(' ');
    if (N(joined) !== N(q.explanation.answer)) warn(q.id, `解説の区切り「${joined}」が英文と一致しません`);
    if (q.reason && !q.reason.choices.some((c) => c.id === q.reason.answer)) warn(q.id, 'reason.answer が選択肢にありません');
    if (q.reason && q.format === 'meaning') warn(q.id, '意味の確認問題には reason を付けません（問題そのものが意味の確認のため）');
    if (q.reason && q.format === 'fill') {
      const ans = q.choices.find((c) => c.id === q.answer).text;
      if (q.reason.prompt.includes(ans)) warn(q.id, `理由の質問文に正答「${ans}」が含まれています`);
    }
    if (q.format === 'ja2en' && (q.alternatives || []).length && !/to/.test(q.instruction)) warn(q.id, '指定の形と違う答えを扱うなら、指示に条件（to＋動詞）を書いてください');
    if (q.version > 1 && !(q.changes || []).some((c) => c.version === q.version)) warn(q.id, `版${q.version}の changes（変更内容と過去の記録の扱い）がありません`);
    for (const sid of q.similar || []) {
      const s = bank.questions.find((x) => x.id === sid);
      if (!s) warn(q.id, `類題 ${sid} がありません`);
      else if (s.skill !== q.skill) warn(q.id, `類題 ${sid} の skill が違います`);
    }
  }
  const diag = bank.questions.filter((q) => q.role === 'diagnostic');
  console.log(`単元「${bank.unit.title}」: 問題 ${bank.questions.length}問（診断 ${diag.length}問）`);
  for (const s of bank.skills) console.log(`  ${s.label}: ${bank.questions.filter((q) => q.skill === s.id).length}問`);
}
if (problems.length) { console.log('\n問題が見つかりました:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('問題集のチェック: OK');
