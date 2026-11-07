# 英文法ドリル（試作品）

中高生向けの英文法の自己学習Webアプリです。初期版では単元「不定詞（基本）」について、
**初回診断 → 結果 → 解説 → 解き直し・類題 → 復習予定 → 後日の復習** の流れが動きます。

- 設計の考え方・判定ルール・今後の計画： [docs/design.md](docs/design.md)
- 外部レビューへの対応・問題の点検・テスト結果： [docs/review-response.md](docs/review-response.md)
- 第3回の改善（答えと理解の確認を分ける）・学習例： [docs/review-response-3.md](docs/review-response-3.md)、[docs/learning-examples.txt](docs/learning-examples.txt)
- 問題の編集のしかた（講師向け）： [data/infinitive.js](data/infinitive.js) の先頭の説明

## iPad で開く

### 方法A：claude.ai のページとして開く（いちばん簡単）
Claude が作ったページ https://claude.ai/artifact/37Px7633MSSzHZQtcoPeDC を、iPad の Safari で開くだけで使えます。
（コードを直したら `npm run build` で dist/english-drill.html を作り直し、同じページに更新します）
claude.ai にログインしている必要があります。

- 学習記録は **そのiPadのそのブラウザの中** に保存されます。
- リンクの中身を更新しても、記録はそのまま残ります。
- 生徒に試してもらうときは、ページ右上の共有から公開範囲を選べます（初期状態は本人だけが見られます）。

**ホーム画面に置く**：Safari で開いて「共有」ボタン →「ホーム画面に追加」。アプリのように起動できます。

### 方法B：GitHub Pages で公開する（将来の選択肢）
このリポジトリは非公開のため、GitHub Pages を使うには GitHub の有料プランか、リポジトリの公開が必要です。
使う場合は github.com の Settings → Pages で `main` ブランチのルートを指定すると、
`index.html` がそのまま Web ページになります（ビルド不要）。

## パソコンで動かす（開発者向け）

ビルドは不要です。フォルダを Web サーバーで配信してブラウザで開きます。

```
python3 -m http.server 8000      # → http://localhost:8000 を開く
npm run check                     # 問題集の形式チェック ＋ ルール・学習の流れのテスト
npm run e2e                       # iPad を想定したブラウザでの通し確認（Playwright が必要）
node tests/repro-screen.mjs       # 意味の問いの画面に訳・正誤・解説が出ないかの確認
node tools/scenario.mjs           # 2人の生徒の学習を、実際の判定ロジックで再現して表示
npm run build                     # 1つのHTMLにまとめる（dist/english-drill.html）
```

## 後日の復習を試す（デモモード）
「設定」→ いちばん下の「講師・開発者向け：動作確認用デモモード」→「デモモードを始める」。
デモモードは通常の記録とは別の保存領域を使い、「+1日 / +3日 / +7日」でアプリ内の日付を進められます。
「デモを終えて通常の記録に戻る」を押すとデモの記録は消え、通常の記録は元のまま残ります。
通常の利用では日付を動かす操作は表示されません。

## フォルダ構成

| 場所 | 中身 |
|---|---|
| `index.html` | 入口のページ |
| `css/app.css` | 見た目 |
| `data/infinitive.js` | 問題・正答・解説（講師が編集する場所） |
| `data/config.js` | 復習間隔などのルールの数値（講師が調整してよい） |
| `js/grading.js` | 採点 |
| `js/mastery.js` | 確認状況（4段階）の判定 |
| `js/scheduler.js` | 復習予定の決め方 |
| `js/planner.js` | 次の課題・出題する問題の選び方（将来AIに置き換える候補） |
| `js/session.js` | 学習回の進行（解説後の記録・理由の問い・確認問題の追加・今日はここまで） |
| `js/storage.js` | 端末内保存（将来サーバー保存に置き換える場所） |
| `js/app.js` / `js/ui-order.js` / `css/app.css` | 画面と操作・見た目だけ（デザイン変更はここだけで済む） |
| `tools/` `tests/` | チェック・テスト・まとめ用の道具 |
