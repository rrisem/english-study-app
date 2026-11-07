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
 * ■ ja2en の採点
 *   入力は「大文字小文字・前後や連続する空白・文末の . ! ?・’ と '」を区別せずに比べます。
 *   短縮形（don't / I'd など）は元の形に直してから比べます。
 *   accepted     … 正答として認める英文（小文字・文末記号なしで書く）
 *   errors       … よくある誤り（正規表現）。result: 'incorrect' か 'minor'
 *                  minor = 不定詞の部分は正しいが、冠詞など別の小さな直しがある
 *   alternatives … 正しい英文だが、今回確認したい不定詞を使っていないもの（正規表現）
 *   どれにも当てはまらない答えは「自動では判定できない（判定保留）」として扱い、誤りとは断定しません。
 */
(function (root) {
  'use strict';
  var EA = root.EA = root.EA || {};

  EA.registerBank({
    unit: {
      id: 'infinitive',
      title: '不定詞（基本）',
      description: 'to＋動詞の原形 の3つの基本の使い方（〜すること／〜するための／〜するために）',
      scopeNote: '副詞的用法は「目的（〜するために）」のみ。感情の原因（glad to など）や、疑問詞＋to、It is … to … などはまだ扱いません。'
    },

    skills: [
      {
        id: 'inf-noun',
        label: '〜すること',
        term: '名詞的用法',
        plain: '「何をしたいのか」「何が好きなのか」「夢は何か」を to＋動詞 で表す'
      },
      {
        id: 'inf-adj',
        label: '〜するための・〜すべき',
        term: '形容詞的用法',
        plain: '前にある「もの・こと・時間」などを、to＋動詞 があとから説明する'
      },
      {
        id: 'inf-adv',
        label: '〜するために',
        term: '副詞的用法（目的）',
        plain: '「何のために」その行動をしたのかを to＋動詞 で表す'
      }
    ],

    questions: [
      /* ============ 初回診断（6問） ============ */
      {
        id: 'inf-d1', version: 1, status: 'active',
        role: 'diagnostic', skill: 'inf-noun', format: 'fill',
        checks: 'want のあとに「したいこと」を to＋動詞の原形 で表せるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '私は放課後テニスをしたい。',
        sentence: 'I want ___ tennis after school.',
        choices: [
          { id: 'a', text: 'play', feedback: 'want のすぐあとに動詞の原形だけを置くことはできません。' },
          { id: 'b', text: 'to play' },
          { id: 'c', text: 'plays', feedback: 'plays は「（彼が）する」の形です。want のあとには続きません。' },
          { id: 'd', text: 'played', feedback: 'played は過去の形です。「したい（こと）」にはなりません。' }
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
        id: 'inf-d2', version: 1, status: 'active',
        role: 'diagnostic', skill: 'inf-adv', format: 'fill',
        checks: '行動の目的（何のために）を to＋動詞の原形 で表せるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '彼女は本を借りるために図書館へ行った。',
        sentence: 'She went to the library ___ some books.',
        choices: [
          { id: 'a', text: 'borrow', feedback: 'went のあとに、もう一つの動詞をそのまま続けることはできません。' },
          { id: 'b', text: 'borrows', feedback: '1つの文に「行った」「借りる」の2つの動詞をそのまま並べることはできません。' },
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
        id: 'inf-d3', version: 1, status: 'active',
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
          point: 'to watch TV は time を説明しています。日本語とは逆に、説明が名詞のうしろに来ます。',
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
        id: 'inf-d5', version: 1, status: 'active',
        role: 'diagnostic', skill: 'inf-noun', format: 'ja2en',
        checks: '「〜になること」を to＋動詞の原形 で表し、文を作れるか',
        instruction: '日本語の意味になるように、英文を書きましょう。',
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
            feedback: '英文としては正しいです。今回は to＋動詞の原形 で書く練習なので、to be / to become でも書いてみましょう。' }
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
          point: '「夢＝先生になること」。to be a teacher が is のあとで夢の中身を表します。to がないと「夢＝先生（人）」のようになってしまいます。',
          term: '名詞的用法（〜すること）'
        },
        similar: ['inf-p-n2', 'inf-p-n3']
      },
      {
        id: 'inf-d6', version: 1, status: 'active',
        role: 'diagnostic', skill: 'inf-adj', format: 'ja2en',
        checks: '「読む本」のように、名詞を to＋動詞 があとから説明する文を作れるか',
        instruction: '日本語の意味になるように、英文を書きましょう。',
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
            feedback: '英語では「読む本」の「読む」を book の前に置けません。book のうしろに to read を続けます。' },
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
        id: 'inf-p-n1', version: 1, status: 'active',
        role: 'practice', skill: 'inf-noun', format: 'fill',
        checks: 'like のあとに「好きなこと」を to＋動詞 で表せるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: 'ミカは絵をかくことが好きです。',
        sentence: 'Mika likes ___ pictures.',
        choices: [
          { id: 'a', text: 'draw', feedback: 'likes のすぐあとに動詞の原形だけを置くことはできません。' },
          { id: 'b', text: 'draws', feedback: '「好き」と「かく」の2つの動詞をそのまま並べることはできません。' },
          { id: 'c', text: 'drew', feedback: 'drew は過去の形です。' },
          { id: 'd', text: 'to draw' }
        ],
        answer: 'd',
        hint: '「絵をかくこと」が、ミカの好きなものです。',
        reason: {
          prompt: 'なぜ to draw になりますか？',
          choices: [
            { id: 'a', text: '「かくこと」が、好きなものの中身を表すから' },
            { id: 'b', text: '「かくために」好きになったから' },
            { id: 'c', text: '「絵」がどんな絵かを説明しているから' }
          ],
          answer: 'a'
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
        id: 'inf-p-n2', version: 1, status: 'active',
        role: 'practice', skill: 'inf-noun', format: 'meaning',
        checks: 'want to be の意味（〜になりたい）を理解しているか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'My brother wants to be a doctor.',
        question: 'お兄さんは、何をしたいと思っていますか？',
        choices: [
          { id: 'a', text: '医者に会いたい', feedback: '「会う」は meet / see です。be は「〜である・〜になる」。' },
          { id: 'b', text: '医者になりたい' },
          { id: 'c', text: '医者になるために勉強している', feedback: '「勉強している」にあたる語は英文にありません。' },
          { id: 'd', text: '医者が好きだ', feedback: 'wants は「好き」ではなく「望む・〜したい」です。' }
        ],
        answer: 'b',
        hint: 'wants to ～ は「～したい」。be はここでは「～になる」です。',
        reason: {
          prompt: 'to be a doctor は、どんな意味のまとまりですか？',
          choices: [
            { id: 'a', text: '医者になるために' },
            { id: 'b', text: '医者になること（＝したいことの中身）' },
            { id: 'c', text: '医者になるべき人' }
          ],
          answer: 'b'
        },
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
        id: 'inf-p-n3', version: 1, status: 'active',
        role: 'practice', skill: 'inf-noun', format: 'order',
        checks: 'like to ＋動詞 の語順を作れるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: '私は英語を話すことが好きです。',
        tokens: ['I', 'like', 'to', 'speak', 'English'],
        answers: ['I like to speak English'],
        hint: '「私は好き」→「何が？」→「英語を話すこと」の順です。',
        reason: {
          prompt: 'to speak English は、文の中でどんな役割ですか？',
          choices: [
            { id: 'a', text: '「何のために」好きなのかを表す' },
            { id: 'b', text: '「何が」好きなのか（好きなことの中身）を表す' },
            { id: 'c', text: '「英語」がどんな英語かを説明する' }
          ],
          answer: 'b'
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
        id: 'inf-p-n4', version: 1, status: 'active',
        role: 'practice', skill: 'inf-noun', format: 'fill',
        checks: 'start のあとに「始めたこと」を to＋動詞 で表せるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '私たちは正午に昼食を食べ始めた。',
        sentence: 'We started ___ lunch at noon.',
        choices: [
          { id: 'a', text: 'to eat' },
          { id: 'b', text: 'eat', feedback: 'started のすぐあとに動詞の原形だけを置くことはできません。' },
          { id: 'c', text: 'ate', feedback: '「始めた」と「食べた」の2つの過去形をそのまま並べることはできません。' },
          { id: 'd', text: 'eats', feedback: 'eats は「（彼が）食べる」の形です。' }
        ],
        answer: 'a',
        hint: '始めたのは「昼食を食べること」です。',
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
        id: 'inf-p-a1', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adj', format: 'fill',
        checks: '名詞（homework）を to＋動詞 があとから説明する形を選べるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '私には今夜やるべき宿題がたくさんある。',
        sentence: 'I have a lot of homework ___ tonight.',
        choices: [
          { id: 'a', text: 'do', feedback: 'homework のあとに動詞の原形だけを置いても、「やるべき」という説明になりません。' },
          { id: 'b', text: 'to do' },
          { id: 'c', text: 'did', feedback: 'did は過去の形です。' },
          { id: 'd', text: 'does', feedback: '「持っている」と「する」の2つの動詞をそのまま並べることはできません。' }
        ],
        answer: 'b',
        hint: '「宿題」→「どんな宿題？」→「今夜やるべき」。',
        reason: {
          prompt: 'to do は、どの言葉を説明していますか？',
          choices: [
            { id: 'a', text: 'I（私）' },
            { id: 'b', text: 'homework（宿題）' },
            { id: 'c', text: 'tonight（今夜）' }
          ],
          answer: 'b'
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
        id: 'inf-p-a2', version: 1, status: 'active',
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
        reason: {
          prompt: 'この英文は、どんな意味ですか？',
          choices: [
            { id: 'a', text: '京都には訪れるべき場所がたくさんある' },
            { id: 'b', text: '京都は多くの場所を訪れたい' },
            { id: 'c', text: '京都を訪れるために、場所がたくさんある' }
          ],
          answer: 'a'
        },
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
        id: 'inf-p-a3', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adj', format: 'order',
        checks: 'time を to＋動詞 があとから説明する語順を作れるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: 'もう寝る時間です。',
        tokens: ["It's", 'time', 'to', 'go', 'to', 'bed'],
        answers: ["It's time to go to bed"],
        hint: '「時間です」→「どんな時間？」→「寝る（ための）」。go to bed で「寝る」。',
        reason: {
          prompt: 'to go to bed は、どの言葉を説明していますか？',
          choices: [
            { id: 'a', text: 'time（時間）' },
            { id: 'b', text: "It's（それは〜です）" },
            { id: 'c', text: 'bed（ベッド）' }
          ],
          answer: 'a'
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
        id: 'inf-p-a4', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adj', format: 'fill',
        checks: 'something を to＋動詞 があとから説明する形を選べるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '何か飲むものをください。',
        sentence: 'Please give me something ___.',
        choices: [
          { id: 'a', text: 'drink', feedback: 'something のあとに動詞の原形だけを置いても、「飲むための」という説明になりません。' },
          { id: 'b', text: 'drank', feedback: 'drank は過去の形です。' },
          { id: 'c', text: 'to drink' },
          { id: 'd', text: 'drinks', feedback: 'drinks は「（彼が）飲む」の形です。' }
        ],
        answer: 'c',
        hint: '「何か」→「どんな何か？」→「飲むための」。',
        reason: {
          prompt: 'to drink は、どの言葉を説明していますか？',
          choices: [
            { id: 'a', text: 'me（私に）' },
            { id: 'b', text: 'give（ください）' },
            { id: 'c', text: 'something（何か）' }
          ],
          answer: 'c'
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
        id: 'inf-p-v1', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adv', format: 'fill',
        checks: '行動の目的を to＋動詞 で表す形を選べるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: 'トムは始発電車に乗るために早く起きた。',
        sentence: 'Tom got up early ___ the first train.',
        choices: [
          { id: 'a', text: 'take', feedback: '「起きた」のあとに、もう一つの動詞をそのまま続けることはできません。' },
          { id: 'b', text: 'to take' },
          { id: 'c', text: 'took', feedback: '「起きて乗った」と言いたいなら and が必要です。ここでは「乗るために」です。' },
          { id: 'd', text: 'takes', feedback: '2つの動詞をそのまま並べることはできません。' }
        ],
        answer: 'b',
        hint: 'トムは「何のために」早く起きたのでしょう？',
        reason: {
          prompt: 'なぜ to take になりますか？',
          choices: [
            { id: 'a', text: '「何のために」早く起きたのかを表すから' },
            { id: 'b', text: '「電車」がどんな電車かを説明しているから' },
            { id: 'c', text: '「乗ること」が好きだと言っているから' }
          ],
          answer: 'a'
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
        id: 'inf-p-v2', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adv', format: 'meaning',
        checks: 'to＋動詞 が行動の目的を表すと読み取れるか',
        instruction: '英文を読んで、質問に答えましょう。',
        sentence: 'I went to the station to meet my aunt.',
        question: '「私」は、何のために駅へ行きましたか？',
        choices: [
          { id: 'a', text: 'おばさんが駅で働いているから', feedback: '「働いている」にあたる語は英文にありません。' },
          { id: 'b', text: 'おばさんに会うことが好きだから', feedback: '「好き」にあたる語は英文にありません。' },
          { id: 'c', text: 'おばさんに会うため' },
          { id: 'd', text: 'おばさんと別れたあと、駅へ行った', feedback: '「別れた」にあたる語は英文にありません。' }
        ],
        answer: 'c',
        hint: 'to meet my aunt が「行った」に何をつけ加えているか考えましょう。',
        reason: {
          prompt: 'to meet my aunt は、どんな意味のまとまりですか？',
          choices: [
            { id: 'a', text: 'おばさんに会うこと（したいことの中身）' },
            { id: 'b', text: 'おばさんに会うために（目的）' },
            { id: 'c', text: 'おばさんに会うべき（駅の説明）' }
          ],
          answer: 'b'
        },
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
        id: 'inf-p-v3', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adv', format: 'order',
        checks: '「場所へ行った」のあとに目的を続ける語順を作れるか',
        instruction: '日本語に合うように、語句を並べかえましょう。',
        ja: '私は写真をとるために京都へ行った。',
        tokens: ['I', 'went', 'to', 'Kyoto', 'to', 'take', 'pictures'],
        answers: ['I went to Kyoto to take pictures'],
        hint: 'まず「私は京都へ行った」、そのあとに「何のために」。',
        reason: {
          prompt: '2つめの to（to take の to）は、どんな意味を作っていますか？',
          choices: [
            { id: 'a', text: '「〜へ（場所）」' },
            { id: 'b', text: '「〜するために（目的）」' },
            { id: 'c', text: '「〜すること（好きなこと）」' }
          ],
          answer: 'b'
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
        id: 'inf-p-v4', version: 1, status: 'active',
        role: 'practice', skill: 'inf-adv', format: 'fill',
        checks: '努力の目的を to＋動詞 で表す形を選べるか',
        instruction: '日本語に合うように、空所に入るものを選びましょう。',
        ja: '彼はテストに合格するために一生懸命勉強した。',
        sentence: 'He studied hard ___ the test.',
        choices: [
          { id: 'a', text: 'passed', feedback: '「勉強して合格した」と言いたいなら and が必要です。ここでは「合格するために」です。' },
          { id: 'b', text: 'pass', feedback: 'studied hard のあとに動詞の原形だけを置くことはできません。' },
          { id: 'c', text: 'passes', feedback: '2つの動詞をそのまま並べることはできません。' },
          { id: 'd', text: 'to pass' }
        ],
        answer: 'd',
        hint: '彼は「何のために」一生懸命勉強したのでしょう？',
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
      }
    ]
  });
})(typeof window !== 'undefined' ? window : globalThis);
