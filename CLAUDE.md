# english-study-app

英文法ドリル（中学英語「不定詞（基本）」）。ソースは `app/`、ChatGPT と共同開発中。

## 変更を届けるときのルール（ユーザーの指定）
- 変更のたびに **ファイル（`english-drill-app.zip`）とアプリのリンクをセットで送る**。
- アプリのリンク：https://claude.ai/artifact/DVd6BQGMa99wwrRkoeQQiK
  - `app/index.html` が読み込む CSS・JS を1つの HTML にまとめ、Artifact ツールで上の URL に公開し直す（新しいリンクは作らない）。
- zip は `app/` を固めたもの（`app/tests/out/` は含めない）。リポジトリ直下に置き、コミットする。

## 確認
- `node app/tests/logic.test.cjs` と `node app/tests/browser.check.cjs`、`node app/tests/home.check.cjs` を実行してから送る。
