/*
 * infinitive.js — 単元「不定詞（基本）」の問題集
 *
 * ■ 講師の方へ（編集のしかた）
 *   - 文字は '…' の中だけを書き換えてください。記号（, や { } ）を消すと動かなくなります。
 *   - 問題を直したら version の数字を 1 増やしてください。古い版の回答と区別して記録されます。
 *   - 問題に不備が見つかったら status を 'excluded' にし、excludeReason に理由を書きます。
 *     その問題の回答は「確認状況」の判定から除外され、出題もされなくなります（履歴は残ります）。
 *   - 特定の版だけ除外したいときは excludedVersions: [1] のように書きます。
 *   - 変更後は `node tools/validate-bank.mjs` で形式チェックができます。
 *
 * ■ 形式（format）
 *   fill    … 空所補充（選択肢から選ぶ）
 *   order   … 並び替え（タップまたはドラッグ）
 *   ja2en   … 日本語→英語（選択肢なしの入力）
 *   meaning … 意味の確認（文法用語を使わずに「誰が・何のために」などを問う）
 *   ※ 正誤判断＋理由選択（judge）は追加候補で、まだ実装していません。
 *
 * ■ 日本語訳の見せ方（showJa）と、その問題で測るもの
 *   'prompt'（省略時）… 日本語を問題文として最初から見せる。日本語の意味に合う「形」を選べるか・作れるかを測る。
 *                        訳を見ているので、そのあとの意味・理由の答えは「参考」として記録し、意味理解の根拠にはしない。
 *   'after'           … 英文だけで出題し、日本語訳は答えたあと（解説）で見せる。選択肢の中で文法的に正しいものが
 *                        1つだけになるように作る。訳を見ていないので、意味・理由の答えを意味理解の根拠にできる。
 *   meaning（意味の確認問題）は常に英文だけ。訳を見ずに「何のため」「どの言葉を説明」などを読み取れるかを測る。
 *
 * ■ 空所補充の選択肢
 *   to で始まる選択肢を2つ以上入れる（「to があるものを選ぶ」だけで正解できないように）。
 *   表示の順番は毎回入れ替わります（正答の位置を覚えて答えられないように）。
 *
 * ■ 意味の問い（reason）… 空所補充・並び替えに答えたあとに出す追加の問い（出題形式の「意味の確認（meaning）」とは別）
 *   問題ごとに、英文に即した短い質問と3つの選択肢を書きます。
 *     target   … 聞いている部分。英文（explanation.answer）の中で太字にする。英文の中に1回だけ出てくる語句にする
 *                （to が複数ある文でも、どこを聞いているか一目でわかるように to から始まるまとまり全体を書く）
 *     prompt   … 短い質問。「目的」「理由」など正解の言葉を質問文に入れない
 *     choices  … 3つ。同じ粒度の自然な日本語にそろえ、長さ・位置だけで正解を推測できないようにする。
 *                誤答は英文の読み違いとしてあり得るものにし、feedback に「どこが違うか」を書く
 *     answer   … 正解の選択肢ID（表示順は毎回入れ替わるので、ID で判定します）
 *     link     … 回答後の説明。head（つながる先の語句）と text（どうつながるか）、term（文法の名前）
 *   出すのは類題・復習・確認問題で、答えが正解かつヒントなしのときだけです（診断と意味の確認問題では聞きません）。
 *   設問を変えたら version を上げ、reasonValidFrom を新しい版にします（古い設問への回答は判定に使わない）。
 *
 * ■ 版（version）と過去の記録
 *   changes に、版を上げた理由と過去の記録の扱いを書きます。
 *   excludedVersions … その版の回答を判定に使わない
 *   reasonValidFrom  … その版より前の設問への「意味の問い」の回答は判定に使わない（答えの正誤は有効）
 *   showJaAfterFrom  … 英文だけで出題（showJa: 'after'）にした版。古い記録の「訳を見たか」の推定に使う
 *
 * ■ ja2en の採点
 *   入力は「大文字小文字・前後や連続する空白・文末の . ! ?・’ と '」を区別せずに比べます。
 *   短縮形（don't / I'd など）は元の形に直してから比べます。
 *   accepted     … 正答として認める英文（小文字・文末記号なしで書く）
 *   acceptedPatterns … 正答として認める英文の正規表現（store / shop などの言いかえをまとめて書くとき）
 *   errors       … よくある誤り（正規表現）。result: 'incorrect' か 'minor'
 *                  minor = 不定詞の部分は正しいが、冠詞など別の小さな直しがある
 *   alternatives … 指示した形（to＋動詞）を使っていない答え（正規表現）。英文として正しいかどうかは判定しない
 *   どれにも当てはまらない答えは「自動では判定できない（判定保留）」として扱い、誤りとは断定しません。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};

  // 以前の版の意味の問い（全問共通の3択。正解は skill の ID）。過去の記録の表示だけに使う
  var LEGACY_ROLE_CHOICES = [
    { id: 'inf-noun', text: '「何を」したい・好き・始めたのか、その中身を表す（〜すること）' },
    { id: 'inf-adj', text: 'すぐ前の言葉が「どんな〜か」を説明する（〜するための・〜すべき）' },
    { id: 'inf-adv', text: '「何のために」その行動をしたのかを表す（〜するために）' }
  ];

  var bank = {
    unit: {
      id: 'infinitive',
      title: '不定詞（基本）',
      description: 'to＋動詞の原形 の3つの基本の使い方（〜すること／〜するための／〜するために）',
      diagnosticMinutes: 10, // 初回診断の目安の時間（分）。ホームの「6問・約10分」に使う。問題数は診断の問題から数える
      scopeNote: '副詞的用法は「目的（〜するために）」のみ。感情の原因（glad to など）や、疑問詞＋to、It is … to … などはまだ扱いません。'
    },

    skills: [
      {
        id: 'inf-noun',
        label: '〜すること',
        term: '名詞的用法',
        plain: '「何をしたいのか」「何が好きなのか」「夢は何か」を to＋動詞 で表す',
        basics: { example: 'I want to play tennis.', exampleJa: '私はテニスをしたい。', mark: 'to play tennis',
          point: 'want（望む）の中身＝「テニスをすること」。want to ～ で「～したい」。like to ～ は「～することが好き」。' }
      },
      {
        id: 'inf-adj',
        label: '〜するための・〜すべき',
        term: '形容詞的用法',
        plain: '前にある「もの・こと・時間」などを、to＋動詞 があとから説明する',
        basics: { example: 'I have homework to do.', exampleJa: '私にはやるべき宿題がある。', mark: 'to do',
          point: 'homework（宿題）→「どんな宿題？」→ to do（やるべき）。この形では、説明の to＋動詞 が名詞のうしろに来ます。' }
      },
      {
        id: 'inf-adv',
        label: '〜するために',
        term: '副詞的用法（目的）',
        plain: '「何のために」その行動をしたのかを to＋動詞 で表す',
        basics: { example: 'I went to the park to play soccer.', exampleJa: '私はサッカーをするために公園へ行った。', mark: 'to play soccer',
          point: '「公園へ行った」→「何のために？」→ to play soccer（サッカーをするために）。行動のあとに目的をつけ加えます。' }
      }
    ],

    questions: [
      /* ============ 初回診断（6問） ============ */
      {
        id: 'inf-d1', version: 3, status: 'active', excludedVersions: [1, 2],
        changes: [{ version: 2, what: '選択肢 plays の説明を、主語の形の説明に修正', oldRecords: '答えの正誤は有効（問題文・正答は同じ）' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }],
        role: 'diagnostic', skill: 'inf-noun', format: 'fill',
        checks: 'want のあとに「したいこと」を to＋動詞の原形 で表せるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '私は放課後テニスをしたい。',
        sentence: 'I want ___ tennis after school.',
        choices: [
          { id: 'a', text: 'play', feedback: 'want のすぐあとに動詞の原形だけを置くことはできません。' },
          { id: 'b', text: 'to play' },
          { id: 'c', text: 'plays', feedback: 'plays は主語が he・she などのときの形です。この文では want のあとに置けません。' },
          { id: 'd', text: 'to playing', feedback: 'この文では、to のあとに動詞の原形を置きます。 want to play の形にします。' }
        ],
        answer: 'b',
        hint: '「テニスをすること」を want（〜をほしい・望む）の中身にします。',
        explanation: {
          answer: 'I want to play tennis after school.',
          translation: '私は放課後テニスをしたい。',
          chunks: [
            { en: 'I want', ja: '私は望む（何を？）' },
            { en: 'to play tennis', ja: 'テニスをすること', mark: true },
            { en: 'after school', ja: '放課後に' }
          ],
          point: 'want の中身（何をしたいのか）を to play tennis が表します。want to ～ で「～したい」。',
          term: '名詞的用法（〜すること）'
        },
        similar: ['inf-p-n1', 'inf-p-n2']
      },
      {
        id: 'inf-d2', version: 3, status: 'active', excludedVersions: [1, 2],
        changes: [{ version: 2, what: '選択肢の説明を、この文に限った言い方に修正', oldRecords: '答えの正誤は有効（問題文・正答は同じ）' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }],
        role: 'diagnostic', skill: 'inf-adv', format: 'fill',
        checks: '行動の目的（何のために）を to＋動詞の原形 で表せるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '彼女は本を借りるために図書館へ行った。',
        sentence: 'She went to the library ___ some books.',
        choices: [
          { id: 'a', text: 'borrow', feedback: 'この文では、went … library のあとに borrow をそのまま続けることはできません。「借りるために」は to borrow です。' },
          { id: 'b', text: 'to borrowing', feedback: 'この文では、to のあとに動詞の原形を置きます。「借りるために」は to borrow です。' },
          { id: 'c', text: 'to borrow' },
          { id: 'd', text: 'borrowed', feedback: '「行って借りた」と言いたいなら and が必要です。ここでは「借りるために」です。' }
        ],
        answer: 'c',
        hint: '彼女は「何のために」図書館へ行ったのでしょう？',
        explanation: {
          answer: 'She went to the library to borrow some books.',
          translation: '彼女は本を借りるために図書館へ行った。',
          chunks: [
            { en: 'She went to the library', ja: '彼女は図書館へ行った（何のために？）' },
            { en: 'to borrow some books', ja: '本を借りるために', mark: true }
          ],
          point: '「行った」理由・目的を、文のうしろの to borrow … がつけ加えています。',
          term: '副詞的用法（目的：〜するために）'
        },
        similar: ['inf-p-v1', 'inf-p-v2']
      },
      {
        id: 'inf-d3', version: 2, status: 'active',
        changes: [{ version: 2, what: '解説の「日本語とは逆に」という一般化を、この文の説明に修正', oldRecords: '答えの正誤は有効（問題文・正答は同じ）' }],
        role: 'diagnostic', skill: 'inf-adj', format: 'order',
        checks: '名詞（time）を to＋動詞 があとから説明する語順を作れるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: '私にはテレビを見る時間がない。',
        tokens: ['I', "don't", 'have', 'time', 'to', 'watch', 'TV'],
        answers: ["I don't have time to watch TV"],
        hint: '「時間」→「どんな時間？」→「テレビを見る（ための）時間」の順に考えます。',
        explanation: {
          answer: "I don't have time to watch TV.",
          translation: '私にはテレビを見る時間がない。',
          chunks: [
            { en: "I don't have", ja: '私は持っていない' },
            { en: 'time', ja: '時間（どんな？）' },
            { en: 'to watch TV', ja: 'テレビを見る（ための）', mark: true }
          ],
          point: 'to watch TV は time を説明しています。この文では、説明の to watch TV が time のうしろに来ます。',
          term: '形容詞的用法（〜するための）'
        },
        similar: ['inf-p-a1', 'inf-p-a3']
      },
      {
        id: 'inf-d4', version: 1, status: 'active',
        role: 'diagnostic', skill: 'inf-adv', format: 'order',
        checks: '「場所へ行った」のあとに目的を to＋動詞 で続けられるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: 'ケンはサッカーをするために公園へ行った。',
        tokens: ['Ken', 'went', 'to', 'the park', 'to', 'play', 'soccer'],
        answers: ['Ken went to the park to play soccer'],
        hint: 'まず「ケンは公園へ行った」を作り、そのあとに「何のために」を続けます。',
        explanation: {
          answer: 'Ken went to the park to play soccer.',
          translation: 'ケンはサッカーをするために公園へ行った。',
          chunks: [
            { en: 'Ken went to the park', ja: 'ケンは公園へ行った（何のために？）' },
            { en: 'to play soccer', ja: 'サッカーをするために', mark: true }
          ],
          point: '1つめの to は「〜へ（場所）」、2つめの to は動詞の前について「〜するために」。同じ to でも役割が違います。',
          term: '副詞的用法（目的：〜するために）'
        },
        similar: ['inf-p-v3', 'inf-p-v1']
      },
      {
        id: 'inf-d5', version: 2, status: 'active',
        changes: [{ version: 2, what: '指示に「to＋動詞の原形を使って」を明記。別の形の答えを「正しい英文」と表示しないよう変更', oldRecords: '答えの正誤は有効。版1の「別の正しい表現」は「指定の形と違う」として扱う' }],
        role: 'diagnostic', skill: 'inf-noun', format: 'ja2en',
        checks: '「〜になること」を to＋動詞の原形 で表し、文を作れるか',
        instruction: 'to＋動詞の原形 を使って、日本語の意味になるように英文を書きましょう。',
        ja: '私の夢は先生になることです。',
        accepted: ['my dream is to be a teacher', 'my dream is to become a teacher'],
        errors: [
          { pattern: '^my dream is (be|become) a teacher$', result: 'incorrect',
            feedback: '「なること」には to が必要です。be / become の前に to を入れましょう。' },
          { pattern: '^my dream is (a |an )?teacher$', result: 'incorrect',
            feedback: 'この文だと「私の夢は先生（という人）です」となり、「なること」が表せていません。' },
          { pattern: '^my dream is to (be|become) teacher$', result: 'minor',
            feedback: 'to be / to become の部分は正しくできています。teacher の前に a が必要です。' },
          { pattern: '^i dream is to (be|become) a teacher$', result: 'minor',
            feedback: 'to be / to become の部分は正しくできています。「私の夢」は My dream です。' }
        ],
        alternatives: [
          { pattern: '^my dream is (being|becoming) a teacher$',
            feedback: 'この問題は to＋動詞の原形 を使う条件です。to be / to become を使って書いてみましょう。' }
        ],
        hint: '「なる」は be または become。「なること」をどう表すかがポイントです。',
        explanation: {
          answer: 'My dream is to be a teacher.',
          also: 'My dream is to become a teacher. も正解です。',
          translation: '私の夢は先生になることです。',
          chunks: [
            { en: 'My dream is', ja: '私の夢は〜です（何？）' },
            { en: 'to be a teacher', ja: '先生になること', mark: true }
          ],
          point: '「夢＝先生になること」。to be a teacher が is のあとで夢の中身を表します。My dream is a teacher. とすると「夢＝先生（という人）」という文になります。',
          term: '名詞的用法（〜すること）'
        },
        similar: ['inf-p-n2', 'inf-p-n3']
      },
      {
        id: 'inf-d6', version: 2, status: 'active',
        changes: [{ version: 2, what: '指示に「to＋動詞の原形を使って」を明記。「bookの前に読むを置けない」という一般化を修正', oldRecords: '答えの正誤は有効（正答は同じ）' }],
        role: 'diagnostic', skill: 'inf-adj', format: 'ja2en',
        checks: '「読む本」のように、名詞を to＋動詞 があとから説明する文を作れるか',
        instruction: 'to＋動詞の原形 を使って、日本語の意味になるように英文を書きましょう。',
        ja: '私は読む本がほしい。',
        accepted: [
          'i want a book to read', 'i want some books to read', 'i want books to read',
          'i would like a book to read', 'i would like some books to read'
        ],
        errors: [
          { pattern: '^i (want|would like) to read (a |some |the )?books?$', result: 'incorrect',
            feedback: 'この文は「私は本を読みたい」という意味です。「読む（ための）本がほしい」とは意味が違います。ほしいのは「本」です。' },
          { pattern: '^i (want|would like) (a |some )?books? read$', result: 'incorrect',
            feedback: 'read の前に to が必要です。「読むための」は to read で表します。' },
          { pattern: '^i (want|would like) (a |some )?read(ing)? books?$', result: 'incorrect',
            feedback: 'この文では、「読む（ための）本」を book のうしろに to read を置いて表します。' },
          { pattern: '^i (want|would like) book to read$', result: 'minor',
            feedback: 'to read の部分は正しくできています。book の前に a（または books と複数形）が必要です。' }
        ],
        alternatives: [],
        hint: 'ほしいのは「本」です。「どんな本？」を本のうしろに続けます。',
        explanation: {
          answer: 'I want a book to read.',
          also: 'I want some books to read. / I\'d like a book to read. なども正解です。',
          translation: '私は読む本がほしい。',
          chunks: [
            { en: 'I want', ja: '私はほしい（何が？）' },
            { en: 'a book', ja: '本（どんな？）' },
            { en: 'to read', ja: '読む（ための）', mark: true }
          ],
          point: 'to read は a book を説明しています。I want to read a book.（本を読みたい）とは意味が違うので注意。',
          term: '形容詞的用法（〜するための）'
        },
        similar: ['inf-p-a2', 'inf-p-a4']
      },

      /* ============ 類題・復習用 ============ */
      /* --- 〜すること（名詞的用法） --- */
      {
        id: 'inf-p-n1', version: 4, status: 'active', showJaAfterFrom: 3, reasonValidFrom: 4, excludedVersions: [1, 2],
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）、英文だけで出題し日本語訳は答えたあとに表示', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }, { version: 4, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版3以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-noun', format: 'fill',
        checks: 'like のあとに「好きなこと」を to＋動詞 で表せるか',
        showJa: 'after',
        instruction: '英文に合うように、空所に入るものを選びましょう。',
        ja: 'ミカは絵をかくことが好きです。',
        sentence: 'Mika likes ___ pictures.',
        choices: [
          { id: 'a', text: 'draw', feedback: 'likes のすぐあとに動詞の原形だけを置くことはできません。' },
          { id: 'b', text: 'draws', feedback: 'この文では、likes と draws をつなぐ言葉がないため、そのまま並べられません。' },
          { id: 'c', text: 'to drawing', feedback: 'この文では、to のあとに動詞の原形を置きます。' },
          { id: 'd', text: 'to draw' }
        ],
        answer: 'd',
        hint: '「絵をかくこと」が、ミカの好きなものです。',
        reason: {
          kind: 'meaning', target: 'to draw pictures',
          prompt: '太字の部分は、何を表していますか？',
          choices: [
            { id: 'a', text: 'ミカが好きなこと' },
            { id: 'b', text: 'ミカが好きな絵', feedback: 'どんな絵かを説明しているのではありません。likes のあとで「何が好きか」を表しています。' },
            { id: 'c', text: 'ミカが好きな理由', feedback: '「〜だから好き」という理由を表す語はありません。likes の中身を表しています。' }
          ],
          answer: 'a',
          link: { head: 'likes', text: 'likes（好きだ）の中身＝「何が好きか」を to draw pictures が表しています。「絵をかくことが好き」。', term: '名詞的用法（〜すること）' }
        },
        explanation: {
          answer: 'Mika likes to draw pictures.',
          translation: 'ミカは絵をかくことが好きです。',
          chunks: [
            { en: 'Mika likes', ja: 'ミカは好き（何が？）' },
            { en: 'to draw pictures', ja: '絵をかくこと', mark: true }
          ],
          point: 'likes の中身（好きなこと）を to draw pictures が表します。',
          term: '名詞的用法（〜すること）'
        }
      },
      {
        id: 'inf-p-n2', version: 2, status: 'active',
        changes: [{ version: 2, what: '理由の質問を削除（意味の確認問題そのものが意味の確認のため）。選択肢を「〜たい」でそろえ、言葉の形から推測しにくくした', oldRecords: '答えの正誤は有効' }],
        role: 'practice', skill: 'inf-noun', format: 'meaning',
        checks: 'want to be の意味（〜になりたい）を理解しているか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'My brother wants to be a doctor.',
        question: 'お兄さんは、何をしたいと思っていますか？',
        choices: [
          { id: 'a', text: '医者に会いたい', feedback: '「会う」は meet / see です。be はここでは「〜になる」です。' },
          { id: 'b', text: '医者になりたい' },
          { id: 'c', text: '医者に診てもらいたい', feedback: '「診てもらう」にあたる語は英文にありません。be はここでは「〜になる」です。' },
          { id: 'd', text: '医者と話したい', feedback: '「話す」にあたる語は英文にありません。' }
        ],
        answer: 'b',
        hint: 'wants to ～ は「～したい」。be はここでは「～になる」です。',
        explanation: {
          answer: 'My brother wants to be a doctor.',
          translation: '兄は医者になりたいと思っている。',
          chunks: [
            { en: 'My brother wants', ja: '兄は望んでいる（何を？）' },
            { en: 'to be a doctor', ja: '医者になること', mark: true }
          ],
          point: 'wants の中身が to be a doctor。「医者になることを望む」＝「医者になりたい」。',
          term: '名詞的用法（〜すること）'
        }
      },
      {
        id: 'inf-p-n3', version: 3, status: 'active', reasonValidFrom: 3,
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版2以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-noun', format: 'order',
        checks: 'like to ＋動詞 の語順を作れるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: '私は英語を話すことが好きです。',
        tokens: ['I', 'like', 'to', 'speak', 'English'],
        answers: ['I like to speak English'],
        hint: '「私は好き」→「何が？」→「英語を話すこと」の順です。',
        reason: {
          kind: 'meaning', target: 'to speak English',
          prompt: '太字の部分は、何を表していますか？',
          choices: [
            { id: 'a', text: '英語が好きな理由', feedback: '「〜だから」という理由を表す語はありません。like の中身を表しています。' },
            { id: 'b', text: '私が好きなこと' },
            { id: 'c', text: '私が話す英語', feedback: 'どんな英語かを説明しているのではありません。like のあとで「何が好きか」を表しています。' }
          ],
          answer: 'b',
          link: { head: 'like', text: 'like（好きだ）の中身＝「何が好きか」を to speak English が表しています。「英語を話すことが好き」。', term: '名詞的用法（〜すること）' }
        },
        explanation: {
          answer: 'I like to speak English.',
          translation: '私は英語を話すことが好きです。',
          chunks: [
            { en: 'I like', ja: '私は好き（何が？）' },
            { en: 'to speak English', ja: '英語を話すこと', mark: true }
          ],
          point: 'like の中身（好きなこと）を to speak English が表します。',
          term: '名詞的用法（〜すること）'
        }
      },
      {
        id: 'inf-p-n4', version: 4, status: 'active', showJaAfterFrom: 3, reasonValidFrom: 4, excludedVersions: [1, 2],
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）、英文だけで出題し日本語訳は答えたあとに表示', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }, { version: 4, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版3以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-noun', format: 'fill',
        checks: 'start のあとに「始めたこと」を to＋動詞 で表せるか',
        showJa: 'after',
        instruction: '英文に合うように、空所に入るものを選びましょう。',
        ja: '私たちは正午に昼食を食べ始めた。',
        sentence: 'We started ___ lunch at noon.',
        choices: [
          { id: 'a', text: 'to eat' },
          { id: 'b', text: 'eat', feedback: 'started のすぐあとに動詞の原形だけを置くことはできません。' },
          { id: 'c', text: 'ate', feedback: 'この文では、started と ate をつなぐ言葉がないため、そのまま並べられません。' },
          { id: 'd', text: 'to eating', feedback: 'この文では、to のあとに動詞の原形を置きます。' }
        ],
        answer: 'a',
        hint: '始めたのは「昼食を食べること」です。',
        reason: {
          kind: 'meaning', target: 'to eat lunch',
          prompt: '太字の部分は、何を表していますか？',
          choices: [
            { id: 'a', text: '私たちが食べた昼食', feedback: 'どんな昼食かを説明しているのではありません。started のあとで「何を始めたか」を表しています。' },
            { id: 'b', text: '私たちが始めた目的', feedback: '「〜するために始めた」ではありません。started の中身（始めたこと）を表しています。' },
            { id: 'c', text: '私たちが始めたこと' }
          ],
          answer: 'c',
          link: { head: 'started', text: 'started（始めた）の中身＝「何を始めたか」を to eat lunch が表しています。at noon は「いつ」です。', term: '名詞的用法（〜すること）' }
        },
        explanation: {
          answer: 'We started to eat lunch at noon.',
          translation: '私たちは正午に昼食を食べ始めた。',
          chunks: [
            { en: 'We started', ja: '私たちは始めた（何を？）' },
            { en: 'to eat lunch', ja: '昼食を食べること', mark: true },
            { en: 'at noon', ja: '正午に' }
          ],
          point: 'started の中身（始めたこと）を to eat lunch が表します。',
          term: '名詞的用法（〜すること）'
        }
      },

      /* --- 〜するための・〜すべき（形容詞的用法） --- */
      {
        id: 'inf-p-a1', version: 4, status: 'active', showJaAfterFrom: 3, reasonValidFrom: 4, excludedVersions: [1, 2],
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）、英文だけで出題し日本語訳は答えたあとに表示', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }, { version: 4, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版3以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-adj', format: 'fill',
        checks: '名詞（homework）を to＋動詞 があとから説明する形を選べるか',
        showJa: 'after',
        instruction: '英文に合うように、空所に入るものを選びましょう。',
        ja: '私には今夜やるべき宿題がたくさんある。',
        sentence: 'I have a lot of homework ___ tonight.',
        choices: [
          { id: 'a', text: 'do', feedback: 'homework のあとに動詞の原形だけを置いても、「やるべき」という説明になりません。' },
          { id: 'b', text: 'to do' },
          { id: 'c', text: 'did', feedback: 'did は過去の形です。' },
          { id: 'd', text: 'to doing', feedback: 'この文では、to のあとに動詞の原形を置きます。' }
        ],
        answer: 'b',
        hint: '「宿題」→「どんな宿題？」→「今夜やるべき」。',
        reason: {
          kind: 'meaning', target: 'to do tonight',
          prompt: '太字の部分は、何を説明していますか？',
          choices: [
            { id: 'a', text: '私が今夜したいこと', feedback: 'want などの「〜したい」を表す語はありません。すぐ前の homework を説明しています。' },
            { id: 'b', text: '宿題がどんなものか' },
            { id: 'c', text: '宿題を持っている目的', feedback: '「〜するために持っている」ではありません。すぐ前の homework を説明しています。' }
          ],
          answer: 'b',
          link: { head: 'homework', text: 'to do tonight が、すぐ前の homework（宿題）を後ろから説明しています。「今夜やるべき宿題」。', term: '形容詞的用法（〜するための・〜すべき）' }
        },
        explanation: {
          answer: 'I have a lot of homework to do tonight.',
          translation: '私には今夜やるべき宿題がたくさんある。',
          chunks: [
            { en: 'I have a lot of homework', ja: '私は宿題をたくさん持っている（どんな？）' },
            { en: 'to do tonight', ja: '今夜やるべき', mark: true }
          ],
          point: 'to do tonight が homework を説明しています。',
          term: '形容詞的用法（〜すべき・〜するための）'
        }
      },
      {
        id: 'inf-p-a2', version: 2, status: 'active',
        changes: [{ version: 2, what: '理由の質問を削除（意味の確認問題そのものが意味の確認のため）', oldRecords: '答えの正誤は有効' }],
        role: 'practice', skill: 'inf-adj', format: 'meaning',
        checks: 'to visit が説明している名詞を見分けられるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'Kyoto has many places to visit.',
        question: 'to visit は、どの言葉を説明していますか？',
        choices: [
          { id: 'a', text: 'Kyoto（京都）', feedback: '京都が「訪れる」のではありません。' },
          { id: 'b', text: 'has（持っている）', feedback: 'has は動作です。to visit は「どんな〜か」を説明しています。' },
          { id: 'c', text: 'places（場所）' },
          { id: 'd', text: 'many（たくさんの）', feedback: 'many は数を表す語です。' }
        ],
        answer: 'c',
        hint: '「どんな場所？」と聞いてみましょう。',
        explanation: {
          answer: 'Kyoto has many places to visit.',
          translation: '京都には訪れるべき場所がたくさんある。',
          chunks: [
            { en: 'Kyoto has', ja: '京都は持っている' },
            { en: 'many places', ja: 'たくさんの場所（どんな？）' },
            { en: 'to visit', ja: '訪れるべき', mark: true }
          ],
          point: 'to visit は places を説明しています。「訪れるべき場所」。',
          term: '形容詞的用法（〜すべき・〜するための）'
        }
      },
      {
        id: 'inf-p-a3', version: 3, status: 'active', reasonValidFrom: 3,
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版2以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-adj', format: 'order',
        checks: 'time を to＋動詞 があとから説明する語順を作れるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: 'もう寝る時間です。',
        tokens: ["It's", 'time', 'to', 'go', 'to', 'bed'],
        answers: ["It's time to go to bed"],
        hint: '「時間です」→「どんな時間？」→「寝る（ための）」。go to bed で「寝る」。',
        reason: {
          kind: 'meaning', target: 'to go to bed',
          prompt: '太字の部分は、何を説明していますか？',
          choices: [
            { id: 'a', text: '寝るのにかかる時間', feedback: '時間の長さを表す語はありません。すぐ前の time を説明しています。' },
            { id: 'b', text: '寝るまでの時間', feedback: '「あと何分」のような残りの時間を表す語はありません。' },
            { id: 'c', text: '今がどんな時間か' }
          ],
          answer: 'c',
          link: { head: 'time', text: 'to go to bed が、すぐ前の time（時間）を後ろから説明しています。「寝る（ための）時間」。2つめの to は go to bed（寝る）の一部で、「〜へ」の to です。', term: '形容詞的用法（〜するための・〜すべき）' }
        },
        explanation: {
          answer: "It's time to go to bed.",
          translation: 'もう寝る時間です。',
          chunks: [
            { en: "It's time", ja: '時間です（どんな？）' },
            { en: 'to go to bed', ja: '寝る（ための）', mark: true }
          ],
          point: 'to go to bed が time を説明しています。2つめの to は「ベッドへ」の to です。',
          term: '形容詞的用法（〜するための）'
        }
      },
      {
        id: 'inf-p-a4', version: 4, status: 'active', showJaAfterFrom: 3, reasonValidFrom: 4, excludedVersions: [1, 2],
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）、英文だけで出題し日本語訳は答えたあとに表示', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }, { version: 4, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版3以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-adj', format: 'fill',
        checks: 'something を to＋動詞 があとから説明する形を選べるか',
        showJa: 'after',
        instruction: '英文に合うように、空所に入るものを選びましょう。',
        ja: '何か飲むものをください。',
        sentence: 'Please give me something ___.',
        choices: [
          { id: 'a', text: 'drink', feedback: 'something のあとに動詞の原形だけを置いても、「飲むための」という説明になりません。' },
          { id: 'b', text: 'drank', feedback: 'drank は過去の形です。' },
          { id: 'c', text: 'to drink' },
          { id: 'd', text: 'to drinking', feedback: 'この文では、to のあとに動詞の原形を置きます。' }
        ],
        answer: 'c',
        hint: '「何か」→「どんな何か？」→「飲むための」。',
        reason: {
          kind: 'meaning', target: 'to drink',
          prompt: '太字の部分は、何を説明していますか？',
          choices: [
            { id: 'a', text: '「何か」がどんな物か' },
            { id: 'b', text: '「何か」をもらう目的', feedback: '「〜するためにもらう」ではありません。すぐ前の something を説明しています。' },
            { id: 'c', text: '「私」がしたいこと', feedback: 'want などの「〜したい」を表す語はありません。すぐ前の something を説明しています。' }
          ],
          answer: 'a',
          link: { head: 'something', text: 'to drink が、すぐ前の something（何か）を後ろから説明しています。「飲むための何か＝飲み物」。', term: '形容詞的用法（〜するための・〜すべき）' }
        },
        explanation: {
          answer: 'Please give me something to drink.',
          translation: '何か飲むものをください。',
          chunks: [
            { en: 'Please give me', ja: '私にください' },
            { en: 'something', ja: '何か（どんな？）' },
            { en: 'to drink', ja: '飲む（ための）', mark: true }
          ],
          point: 'to drink は something を説明しています。「飲むための何か」＝「飲み物」。',
          term: '形容詞的用法（〜するための）'
        }
      },

      /* --- 〜するために（副詞的用法・目的） --- */
      {
        id: 'inf-p-v1', version: 4, status: 'active', showJaAfterFrom: 3, reasonValidFrom: 4, excludedVersions: [1, 2],
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）、英文だけで出題し日本語訳は答えたあとに表示', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }, { version: 4, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版3以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-adv', format: 'fill',
        checks: '行動の目的を to＋動詞 で表す形を選べるか',
        showJa: 'after',
        instruction: '英文に合うように、空所に入るものを選びましょう。',
        ja: 'トムは始発電車に乗るために早く起きた。',
        sentence: 'Tom got up early ___ the first train.',
        choices: [
          { id: 'a', text: 'take', feedback: '「起きた」のあとに、もう一つの動詞をそのまま続けることはできません。' },
          { id: 'b', text: 'to take' },
          { id: 'c', text: 'took', feedback: '「起きて乗った」と言いたいなら and が必要です。ここでは「乗るために」です。' },
          { id: 'd', text: 'to taking', feedback: 'この文では、to のあとに動詞の原形を置きます。' }
        ],
        answer: 'b',
        hint: 'トムは「何のために」早く起きたのでしょう？',
        reason: {
          kind: 'meaning', target: 'to take the first train',
          prompt: '太字の部分は、何を説明していますか？',
          choices: [
            { id: 'a', text: 'トムが早く起きた時刻', feedback: '時刻を表す語はありません。early は「早く」です。' },
            { id: 'b', text: 'トムが早く起きた目的' },
            { id: 'c', text: 'トムが起きてすぐしたこと', feedback: '「起きて、そして乗った」なら and が必要です。乗ったかどうかはこの文からはわかりません。' }
          ],
          answer: 'b',
          link: { head: 'got up early', text: 'to take the first train が、got up early（早く起きた）に「何のために」をつけ加えています。「始発電車に乗るために早く起きた」。', term: '副詞的用法（目的：〜するために）' }
        },
        explanation: {
          answer: 'Tom got up early to take the first train.',
          translation: 'トムは始発電車に乗るために早く起きた。',
          chunks: [
            { en: 'Tom got up early', ja: 'トムは早く起きた（何のために？）' },
            { en: 'to take the first train', ja: '始発電車に乗るために', mark: true }
          ],
          point: '早く起きた目的を to take the first train がつけ加えています。',
          term: '副詞的用法（目的：〜するために）'
        }
      },
      {
        id: 'inf-p-v2', version: 2, status: 'active', excludedVersions: [1],
        changes: [{ version: 2, what: '選択肢を「〜ため」でそろえ、質問の言葉から答えを推測できないようにした。理由の質問を削除', oldRecords: '版1は選択肢から推測できたため判定に使わない' }],
        role: 'practice', skill: 'inf-adv', format: 'meaning',
        checks: 'to＋動詞 が行動の目的を表すと読み取れるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'I went to the station to meet my aunt.',
        question: '「私」は、何のために駅へ行きましたか？',
        choices: [
          { id: 'a', text: 'おばさんを見送るため', feedback: '「見送る」は see off です。meet は「会う・出迎える」です。' },
          { id: 'b', text: 'おばさんと買い物をするため', feedback: '「買い物をする」にあたる語は英文にありません。' },
          { id: 'c', text: 'おばさんに会うため' },
          { id: 'd', text: 'おばさんに荷物を届けるため', feedback: '「届ける」にあたる語は英文にありません。' }
        ],
        answer: 'c',
        hint: 'to meet my aunt が「行った」に何をつけ加えているか考えましょう。',
        explanation: {
          answer: 'I went to the station to meet my aunt.',
          translation: '私はおばに会うために駅へ行った。',
          chunks: [
            { en: 'I went to the station', ja: '私は駅へ行った（何のために？）' },
            { en: 'to meet my aunt', ja: 'おばに会うために', mark: true }
          ],
          point: '駅へ行った目的を to meet my aunt が表しています。',
          term: '副詞的用法（目的：〜するために）'
        }
      },
      {
        id: 'inf-p-v3', version: 3, status: 'active', reasonValidFrom: 3,
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版2以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-adv', format: 'order',
        checks: '「場所へ行った」のあとに目的を続ける語順を作れるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: '私は写真をとるために京都へ行った。',
        tokens: ['I', 'went', 'to', 'Kyoto', 'to', 'take', 'pictures'],
        answers: ['I went to Kyoto to take pictures'],
        hint: 'まず「私は京都へ行った」、そのあとに「何のために」。',
        reason: {
          kind: 'meaning', target: 'to take pictures',
          prompt: '太字の部分は、何を説明していますか？',
          choices: [
            { id: 'a', text: '京都で撮った写真の種類', feedback: 'pictures の種類を説明しているのではありません。went to Kyoto に「何のために」をつけ加えています。' },
            { id: 'b', text: '京都へ行った時刻', feedback: '時刻を表す語はありません。' },
            { id: 'c', text: '京都へ行った目的' }
          ],
          answer: 'c',
          link: { head: 'went to Kyoto', text: 'to take pictures が、went to Kyoto（京都へ行った）に「何のために」をつけ加えています。1つめの to は「〜へ（場所）」、2つめの to は動詞 take の前について「〜するために」です。', term: '副詞的用法（目的：〜するために）' }
        },
        explanation: {
          answer: 'I went to Kyoto to take pictures.',
          translation: '私は写真をとるために京都へ行った。',
          chunks: [
            { en: 'I went to Kyoto', ja: '私は京都へ行った（何のために？）' },
            { en: 'to take pictures', ja: '写真をとるために', mark: true }
          ],
          point: '1つめの to は「京都へ」、2つめの to は「とるために」。',
          term: '副詞的用法（目的：〜するために）'
        }
      },
      {
        id: 'inf-p-v4', version: 4, status: 'active', showJaAfterFrom: 3, reasonValidFrom: 4, excludedVersions: [1, 2],
        changes: [{ version: 2, what: '理由の質問を、正答がわからない形（意味の役割を選ぶ3択）に変更', oldRecords: '答えの正誤は有効。版1の理由の回答は判定に使わない' }, { version: 3, what: '選択肢に to で始まる誤りを加え（正答だけが to で始まらないように）、英文だけで出題し日本語訳は答えたあとに表示', oldRecords: '版2までは正答だけが to で始まり、形の手がかりだけで選べたため判定に使わない（履歴には残す）' }, { version: 4, what: '意味の問いを、この英文に即した短い質問と3つの選択肢に変更（聞いている部分を太字で示す）', oldRecords: '答えの正誤は有効。版3以前の意味の問いの回答は設問が違うため判定に使わない（履歴には残す）' }],
        role: 'practice', skill: 'inf-adv', format: 'fill',
        checks: '努力の目的を to＋動詞 で表す形を選べるか',
        showJa: 'after',
        instruction: '英文に合うように、空所に入るものを選びましょう。',
        ja: '彼はテストに合格するために一生懸命勉強した。',
        sentence: 'He studied hard ___ the test.',
        choices: [
          { id: 'a', text: 'passed', feedback: '「勉強して合格した」と言いたいなら and が必要です。ここでは「合格するために」です。' },
          { id: 'b', text: 'pass', feedback: 'studied hard のあとに動詞の原形だけを置くことはできません。' },
          { id: 'c', text: 'to passing', feedback: 'この文では、to のあとに動詞の原形を置きます。' },
          { id: 'd', text: 'to pass' }
        ],
        answer: 'd',
        hint: '彼は「何のために」一生懸命勉強したのでしょう？',
        reason: {
          kind: 'meaning', target: 'to pass the test',
          prompt: '太字の部分は、何を説明していますか？',
          choices: [
            { id: 'a', text: '彼が一生懸命勉強した結果', feedback: '「勉強して合格した」なら and が必要です。合格したかどうかはこの文からはわかりません。' },
            { id: 'b', text: '彼が勉強したテストの種類', feedback: 'test の種類を説明しているのではありません。studied hard に「何のために」をつけ加えています。' },
            { id: 'c', text: '彼が一生懸命勉強した目的' }
          ],
          answer: 'c',
          link: { head: 'studied hard', text: 'to pass the test が、studied hard（一生懸命勉強した）に「何のために」をつけ加えています。「テストに合格するために勉強した」。', term: '副詞的用法（目的：〜するために）' }
        },
        explanation: {
          answer: 'He studied hard to pass the test.',
          translation: '彼はテストに合格するために一生懸命勉強した。',
          chunks: [
            { en: 'He studied hard', ja: '彼は一生懸命勉強した（何のために？）' },
            { en: 'to pass the test', ja: 'テストに合格するために', mark: true }
          ],
          point: '勉強した目的を to pass the test が表しています。',
          term: '副詞的用法（目的：〜するために）'
        }
      },

      /* --- 意味の確認（理由を取り違えたときの確認問題にも使う） --- */
      {
        id: 'inf-p-n5', version: 1, status: 'active',
        role: 'practice', skill: 'inf-noun', format: 'meaning',
        checks: 'want to ～（～したい）と「～するための…がほしい」の意味の違いがわかるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'I want to read a book.',
        question: 'この英文の意味に合うものはどれですか？',
        choices: [
          { id: 'a', text: '読むための本がほしい', feedback: 'それなら I want a book to read. です。この文の to read a book は want の中身（したいこと）です。' },
          { id: 'b', text: '本を読みたい' },
          { id: 'c', text: '本を読むために出かけたい', feedback: '「出かける」にあたる語は英文にありません。' }
        ],
        answer: 'b',
        hint: 'want のすぐあとの to read a book は「何をしたいのか」を表しています。',
        explanation: {
          answer: 'I want to read a book.',
          translation: '私は本を読みたい。',
          chunks: [
            { en: 'I want', ja: '私は望む（何を？）' },
            { en: 'to read a book', ja: '本を読むこと', mark: true }
          ],
          point: 'want の中身が to read a book。I want a book to read.（読む本がほしい）とは意味が違います。',
          term: '名詞的用法（〜すること）'
        }
      },
      {
        id: 'inf-p-a5', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adj', format: 'meaning',
        checks: '名詞のうしろの to＋動詞 が、その名詞を説明していると読み取れるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'He has a lot of work to do today.',
        question: 'この英文の意味に合うものはどれですか？',
        choices: [
          { id: 'a', text: '彼は今日、たくさん仕事をしたい', feedback: '「〜したい」にあたる want などの語は英文にありません。' },
          { id: 'b', text: '彼には今日やるべき仕事がたくさんある' },
          { id: 'c', text: '彼は今日、仕事をするためにたくさん持ってきた', feedback: '「持ってきた」にあたる語は英文にありません。has は「持っている・ある」です。' }
        ],
        answer: 'b',
        hint: 'work（仕事）→「どんな仕事？」と考えましょう。',
        explanation: {
          answer: 'He has a lot of work to do today.',
          translation: '彼には今日やるべき仕事がたくさんある。',
          chunks: [
            { en: 'He has a lot of work', ja: '彼はたくさんの仕事を持っている（どんな？）' },
            { en: 'to do today', ja: '今日やるべき', mark: true }
          ],
          point: 'to do today が work を説明しています。',
          term: '形容詞的用法（〜すべき・〜するための）'
        }
      },
      {
        id: 'inf-p-v5', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adv', format: 'meaning',
        checks: '行動のうしろの to＋動詞 を「目的」として読み取れるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'She went to the shop to buy some milk.',
        question: '彼女が店へ行った目的はどれですか？',
        choices: [
          { id: 'a', text: '牛乳を売るため', feedback: '「売る」は sell です。buy は「買う」です。' },
          { id: 'b', text: '牛乳を届けるため', feedback: '「届ける」にあたる語は英文にありません。' },
          { id: 'c', text: '牛乳を買うため' },
          { id: 'd', text: '牛乳を飲むため', feedback: '「飲む」は drink です。' }
        ],
        answer: 'c',
        hint: 'to buy some milk が「行った」に何をつけ加えているか考えましょう。',
        explanation: {
          answer: 'She went to the shop to buy some milk.',
          translation: '彼女は牛乳を買うために店へ行った。',
          chunks: [
            { en: 'She went to the shop', ja: '彼女は店へ行った（何のために？）' },
            { en: 'to buy some milk', ja: '牛乳を買うために', mark: true }
          ],
          point: '店へ行った目的を to buy some milk が表しています。',
          term: '副詞的用法（目的：〜するために）'
        }
      },
      {
        id: 'inf-p-n6', version: 1, status: 'active',
        role: 'practice', skill: 'inf-noun', format: 'meaning',
        checks: 'is のあとの to＋動詞 が「計画の中身」を表すと、訳なしで読み取れるか（ほかの用法との取り違えを選択肢にしている）',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'My plan is to clean my room.',
        question: '「私の計画（my plan）」の中身はどれですか？',
        choices: [
          { id: 'a', text: '部屋を掃除すること' },
          { id: 'b', text: '部屋を掃除するための道具', feedback: 'to clean が名詞を説明しているときの読み方です。この文では is のあとで「計画＝部屋を掃除すること」を表します。' },
          { id: 'c', text: '部屋を掃除するために早く起きること', feedback: '「早く起きる」にあたる語は英文にありません。' }
        ],
        answer: 'a',
        hint: 'My plan is ～ で「私の計画は～です」。',
        explanation: {
          answer: 'My plan is to clean my room.',
          translation: '私の計画は、部屋を掃除することです。',
          chunks: [
            { en: 'My plan is', ja: '私の計画は〜です（何？）' },
            { en: 'to clean my room', ja: '部屋を掃除すること', mark: true }
          ],
          point: 'is のあとの to clean my room が、計画の中身（〜すること）を表します。',
          term: '名詞的用法（〜すること）'
        }
      },
      {
        id: 'inf-p-a6', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adj', format: 'meaning',
        checks: 'time を to＋動詞 が説明していると、訳なしで読み取れるか（目的・したいことの読み違いを選択肢にしている）',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'She has no time to sleep.',
        question: 'この英文の意味に合うものはどれですか？',
        choices: [
          { id: 'a', text: '彼女は寝るために時間を使わない', feedback: 'to sleep を「何のために」と読んだときの意味です。この文では time を説明しています。' },
          { id: 'b', text: '彼女には寝る時間がない' },
          { id: 'c', text: '彼女は寝たいと思っていない', feedback: '「〜したい」にあたる want などの語は英文にありません。' }
        ],
        answer: 'b',
        hint: 'no time（時間がない）→「どんな時間？」と考えましょう。',
        explanation: {
          answer: 'She has no time to sleep.',
          translation: '彼女には寝る時間がない。',
          chunks: [
            { en: 'She has no time', ja: '彼女には時間がない（どんな？）' },
            { en: 'to sleep', ja: '寝る（ための）', mark: true }
          ],
          point: 'to sleep が time を説明しています。「寝る時間」。',
          term: '形容詞的用法（〜するための）'
        }
      },
      {
        id: 'inf-p-v6', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adv', format: 'meaning',
        checks: '行動（電話した）のうしろの to＋動詞 を目的として、訳なしで読み取れるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'Tom called Mary to ask about the homework.',
        question: 'トムがメアリーに電話した目的はどれですか？',
        choices: [
          { id: 'a', text: '宿題を手伝ってほしいと頼むため', feedback: 'ask about ～ は「～について尋ねる」です。「手伝う」にあたる語は英文にありません。' },
          { id: 'b', text: '宿題について尋ねるため' },
          { id: 'c', text: '宿題の答えを教えるため', feedback: '「教える」は tell / teach です。ask は「尋ねる」です。' }
        ],
        answer: 'b',
        hint: 'to ask about the homework が「電話した」に何をつけ加えているか考えましょう。',
        explanation: {
          answer: 'Tom called Mary to ask about the homework.',
          translation: 'トムは宿題について尋ねるためにメアリーに電話した。',
          chunks: [
            { en: 'Tom called Mary', ja: 'トムはメアリーに電話した（何のために？）' },
            { en: 'to ask about the homework', ja: '宿題について尋ねるために', mark: true }
          ],
          point: '電話した目的を to ask about the homework が表しています。',
          term: '副詞的用法（目的：〜するために）'
        }
      },
      {
        id: 'inf-p-v7', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adv', format: 'ja2en',
        checks: '「〜するために」を to＋動詞の原形 で表し、選択肢なしで文を作れるか',
        instruction: 'to＋動詞の原形 を使って、日本語の意味になるように英文を書きましょう。',
        ja: '私は牛乳を買うために店へ行った。',
        accepted: ['i went to the store to buy some milk', 'i went to the shop to buy some milk', 'i went to the store to buy milk', 'i went to the shop to buy milk'],
        acceptedPatterns: ['^i went to the (store|shop|supermarket) to buy (some |the )?milk$'],
        errors: [
          { pattern: '^i went to the (store|shop|supermarket) (buy|bought) (some |the )?milk$', result: 'incorrect',
            feedback: '「行った」のあとに「買うために」を続けるには、to buy の形にします。' },
          { pattern: '^i went to the (store|shop|supermarket) to (buying|bought) (some |the )?milk$', result: 'incorrect',
            feedback: 'この文では、to のあとに動詞の原形（buy）を置きます。' },
          { pattern: '^i went (to )?(store|shop) to buy (some |the )?milk$', result: 'minor',
            feedback: 'to buy の部分は正しくできています。「店へ」は to the store（または to the shop）です。' }
        ],
        alternatives: [
          { pattern: '^i went to the (store|shop|supermarket) (and bought|for buying|for) (some |the )?milk$',
            feedback: 'この問題は to＋動詞の原形 を使う条件です。「買うために」を to buy で書いてみましょう。' }
        ],
        hint: 'まず「私は店へ行った」、そのあとに「何のために」を続けます。',
        explanation: {
          answer: 'I went to the store to buy some milk.',
          also: 'store の代わりに shop、some milk の代わりに milk でも正解です。',
          translation: '私は牛乳を買うために店へ行った。',
          chunks: [
            { en: 'I went to the store', ja: '私は店へ行った（何のために？）' },
            { en: 'to buy some milk', ja: '牛乳を買うために', mark: true }
          ],
          point: '店へ行った目的を to buy some milk が表しています。',
          term: '副詞的用法（目的：〜するために）'
        }
      }
    ]
  };

  // 意味の問いで見せる英文（正しい文）。太字にする target は、この中に1回だけ出てくる語句にする
  bank.questions.forEach(function (q) {
    if (q.reason && !q.reason.sentence) q.reason.sentence = q.explanation.answer;
  });
  // 以前の版（共通の3択）の意味の問いに答えた記録を表示するための文言。出題には使わない
  bank.legacyReasonChoices = LEGACY_ROLE_CHOICES;
  EA.registerBank(bank);
})(typeof window !== 'undefined' ? window : globalThis);
