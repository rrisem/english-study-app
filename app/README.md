# 英文法ドリル（ソース一式）

中学英語「不定詞（基本）」を学ぶ、ブラウザだけで動く学習アプリです。
ビルド不要。`index.html` をブラウザで開くと動きます（記録は端末の localStorage に保存）。

## ファイル構成（読み込み順）

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の入れ物。下のファイルを順に読み込む |
| `css/app.css` | 見た目（色・レイアウト） |
| `js/core.js` | 共通の道具（名前空間 `window.EA`・日付・時計・エスケープ） |
| `data/config.js` | 学習ルールの設定値（復習間隔など） |
| `data/infinitive.js` | 単元「不定詞（基本）」の問題集（問題・選択肢・正答・解説） |
| `data/structure-trial.js` | 試作：英文の構造を読む問題（1問） |
| `js/grading.js` | 採点 |
| `js/mastery.js` | 確認状況（どこまでできているか）の判定 |
| `js/scheduler.js` | 復習予定 |
| `js/storage.js` | 端末内保存（localStorage） |
| `js/planner.js` | 出題する問題の選び方 |
| `js/session.js` | 1回の学習の進行 |
| `js/structure.js` | 英文構造の段階解説 |
| `js/ui-order.js` | 並べかえ問題の操作（タップ・ドラッグ） |
| `js/app.js` | 画面の表示と操作 |

- すべてのファイルは import/export を使わない普通の `<script>` で、`window.EA` に機能を登録します。読み込み順を変えると動きません。
- 問題の追加・修正は `data/infinitive.js` の先頭コメントに書き方の説明があります。

## 動作確認（テスト）

```
node tests/logic.test.cjs       # 学習の進行・保存・意味の問い・旧データの読み込み（ブラウザ不要）
node tests/browser.check.cjs    # 画面での確認（Playwright が必要）。スクリーンショットは tests/out/
```
