/*
 * 動作確認専用の仮データ（不定詞 Lv2・128問の形だけをそろえたもの）。アプリには含めません。
 * 原本の問題セットを取り込む前でも、出題・採点・途中保存の流れを確かめるために、
 * tests/lv2.check.cjs が LV2_FIXTURE=1 のときだけページより先に読み込みます（window.EA.lv2Source）。
 * 文の中身は確認用で、原本の問題ではありません（すべて「［確認用］」を含みます）。
 */
(function (root) {
  var EA = root.EA = root.EA || {};
  var KEYS = ['gi', 'not', 'enough', 'inorder', 'wh'];
  var src = {};
  KEYS.forEach(function (k) {
    var ord = [];
    for (var n = 1; n <= 6; n++) {
      ord.push(n % 2
        ? { ja: '［確認用］' + k + n + '：私は今年留学することに決めた。', fixedStart: 'I', tokens: ['decided', 'to', 'study', 'abroad', 'this year'],
            answer: 'I decided to study abroad this year.', explain: { point: '［確認用］decide は to do をとる。' } }
        : { ja: '［確認用］' + k + n + '：このアプリの使い方を教えてください。', fixedEnd: 'please.', tokens: ['tell', 'me', 'how', 'to', 'use', 'this app'],
            answer: 'Tell me how to use this app please.', explain: { point: '［確認用］how to do で「〜のしかた」。' } });
    }
    ord.push({ ja: '［確認用］' + k + '7：彼は遅れないように走った。', fixedStart: 'He', tokens: ['ran', 'so as', 'not', 'to', 'be', 'late', 'for'],
      answer: 'He ran so as not to be late.', extra: 'for', explain: { point: '［確認用］not は to の直前。for は不要。' } });
    ord.push(k === 'enough'
      ? { ja: '［確認用］その音は隣の部屋で聞こえるほど大きかった。', tokens: ['The sound', 'was', 'loud', 'to', 'be', 'heard', 'in the next room'],
          answer: 'The sound was loud enough to be heard in the next room.', missing: 'enough', explain: { point: '［確認用］形容詞＋enough＋to do。' } }
      : { ja: '［確認用］' + k + '8：私は何を言えばよいか分からなかった。', fixedStart: 'I', tokens: ['didn\'t', 'know', 'to', 'say'],
          answer: 'I didn\'t know what to say.', missing: 'what', explain: { point: '［確認用］what to do。' } });
    var fact = [], wo = [], tf = [];
    for (var m = 1; m <= 8; m++) {
      fact.push({ en: 'She decided not to go out. [' + k + m + ']',
        choices: [['［確認用］彼女は外出しないことに決めた。', null], ['［確認用］彼女は外出することに決めなかった。', '［確認用］not は to go を否定している。'], ['［確認用］彼女はすでに外出した。', '［確認用］書かれていない。']],
        explain: { translation: '［確認用］彼女は外出しないことに決めた。', point: '［確認用］not to go の not は to go を否定。' } });
      wo.push({ ja: '［確認用］' + k + m + '：彼は遅れないように早く出た。',
        choices: [['He left early not to be late. [' + m + 'a]', '［確認用］語順は正しいが意味が違う想定。'], ['He left early in order not to be late. [' + m + 'b]', null], ['He left early in order to not be late. [' + m + 'c]', '［確認用］not の位置。']],
        explain: { point: '［確認用］in order not to do。' } });
    }
    if (k === 'gi') {
      for (var t = 1; t <= 8; t++) {
        tf.push(t % 2
          ? { en: 'I enjoy reading books. [' + t + ']', ja: '［確認用］私は本を読むのを楽しむ。', answer: 'o', explain: { point: '［確認用］enjoy は doing をとる。' } }
          : { en: 'I enjoy to read books. [' + t + ']', ja: '［確認用］私は本を読むのを楽しむ。', answer: 'x', correction: 'I enjoy reading books. [' + t + ']', wrong: t === 4 ? 'meaning' : 'grammar',
              explain: { point: '［確認用］enjoy のあとは to do ではなく doing。' } });
      }
    }
    src[k] = { ord: ord, fact: fact, wo: wo };
    if (tf.length) src[k].tf = tf;
  });
  EA.lv2Source = src;
})(typeof window !== 'undefined' ? window : globalThis);
