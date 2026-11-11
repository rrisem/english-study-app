/*
 * structure-trial.js — 試作：英文構造の段階解説（1問）
 *
 * ■ 講師の方へ
 *   structure（構造の段階解説）は、問題ごとにプログラムを書かずに、ここのデータだけで作れます。
 *   - sentence    … 英文（問題の英文と同じもの）
 *   - translation … 日本語訳（解説の中で、生徒が「訳を見る」を押したときだけ表示）
 *   - steps       … 段階。上から順に表示します。
 *       title  段階の見出し
 *       text   説明文
 *       marks  強調する語句。text は英文の中にそのまま含まれる語句（区切りは単語単位）。重ならないように書きます。
 *              role: subject（主語）/ verb（動詞）/ modifier（説明のまとまり）/ complement（補語）/ omit（骨格からはずす部分）
 *              label: 語句の下に出す短いラベル（色だけに頼らないため、必ず書く）
 *       skeleton 骨格として並べる部分（最後の段階など）。[{ text, label }]
 *   変更したら `node tools/validate-bank.mjs` で、語句が英文に含まれているか・重なっていないかを確かめられます。
 *
 * ■ この試作は、不定詞の確認状況・復習予定には反映しません（別の単元として記録します）。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};

  var SUBJECT = { text: 'The book', role: 'subject', label: '主語の中心（何が）' };
  var VERB = { text: 'is', role: 'verb', label: '文の動詞' };

  EA.registerBank({
    unit: {
      id: 'structure-trial',
      title: '試作：英文の構造を読む',
      description: '主語・動詞・説明のまとまりをとらえて、英文を正確に読む（1問の試作）',
      scopeNote: '関係代名詞 that が名詞を後ろから説明する文 1問のみ。確認状況・復習予定には反映しません。',
      trial: true
    },
    skills: [
      {
        id: 'structure-svo',
        label: '主語・動詞・説明のまとまり',
        term: '文の構造（試作）',
        plain: '長い主語の中から、主語の中心と文の動詞を見つける'
      }
    ],
    questions: [
      {
        id: 'st-1', version: 1, status: 'active',
        role: 'trial', skill: 'structure-svo', format: 'meaning',
        checks: '長い主語（名詞＋後ろから説明するまとまり）の中から、「何が」おもしろいのかを読み取れるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'The book that I bought yesterday is interesting.',
        question: 'おもしろいのは何ですか？',
        choices: [
          { id: 'a', text: '私が昨日買った本' },
          { id: 'b', text: '昨日、本を買ったこと', feedback: 'おもしろいのは「買ったこと」ではなく、book（本）です。that I bought yesterday は book を説明しています。' },
          { id: 'c', text: '昨日の私', feedback: 'I は that I bought yesterday というまとまりの中の主語です。文全体の主語は The book です。' }
        ],
        answer: 'a',
        hint: 'is interesting（おもしろい）と言われているものを、文の最初から読んで探しましょう。',
        explanation: {
          answer: 'The book that I bought yesterday is interesting.',
          translation: '私が昨日買った本はおもしろい。',
          chunks: [
            { en: 'The book', ja: '本（どんな？）' },
            { en: 'that I bought yesterday', ja: '私が昨日買った', mark: true },
            { en: 'is interesting', ja: 'おもしろい' }
          ],
          point: 'that I bought yesterday が book を後ろから説明しています。',
          term: '関係代名詞（目的格の that）'
        },
        structure: {
          sentence: 'The book that I bought yesterday is interesting.',
          translation: '私が昨日買った本はおもしろい。',
          steps: [
            {
              title: '文の中心：主語と動詞',
              text: '主語の中心は The book（本）、文全体の動詞は is です。bought も動詞ですが、あとで見る「説明のまとまり」の中の動詞で、文全体の動詞ではありません。',
              marks: [SUBJECT, VERB]
            },
            {
              title: 'book を説明するまとまり',
              text: 'that I bought yesterday は「私が昨日買った」というひとまとまりで、すぐ前の book を後ろから説明しています（どんな本？ → 私が昨日買った本）。that は、I bought（私が買った）の「買ったもの」にあたる book を指しています。',
              marks: [SUBJECT, { text: 'that I bought yesterday', role: 'modifier', label: '← book を説明' }, VERB]
            },
            {
              title: '文の骨格',
              text: '説明のまとまりを外すと、The book is interesting.（その本はおもしろい）という骨格が残ります。interesting は、主語の本が「どんなだ」かを表します。',
              marks: [SUBJECT, { text: 'that I bought yesterday', role: 'omit', label: '骨格からはずす' }, VERB,
                { text: 'interesting', role: 'complement', label: 'どんなだ' }],
              skeleton: [
                { text: 'The book', label: '主語' },
                { text: 'is', label: '動詞' },
                { text: 'interesting.', label: 'どんなだ（補語）' }
              ]
            }
          ]
        }
      }
    ]
  });
})(typeof window !== 'undefined' ? window : globalThis);
