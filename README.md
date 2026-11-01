# ベイドラNEWS

横浜DeNAベイスターズと2027年ドラフト候補のニュースを集める PWA です。Node.js 22.2 以降で動き、依存パッケージはありません。

## 使い方

```sh
npm run fetch   # ニュースを取得して public/data/news.json を更新
npm run dev     # http://127.0.0.1:8137 で表示
npm test        # テスト
```

## 仕組み

- `scripts/fetch-news.mjs` が Google News RSS と野球メディアの RSS を読み、見出しで判定して `public/data/news.json` に蓄積します。保存するのは見出し・媒体名・リンク・日時だけです。
- `public/` がそのまま静的サイトになります。Service Worker によりオフラインでも前回のデータを読めます。
- 既読と保存（☆）はブラウザの localStorage に保存されるので、端末間では共有されません。

## 候補選手や取得元を変える

`config/sources.json` を編集して `npm run fetch` を実行します。判定は過去の記事にもやり直されます。

- `candidates`: 候補選手。`aliases` に異体字などの別表記を書けます。
- `searches`: Google News の検索語。
- `feeds`: 直接読む RSS。
- `filters`: 除外する見出し・媒体（正規表現）。

## GitHub Pages で公開する

1. GitHub に**公開リポジトリ**を作り、このフォルダを `main` ブランチに push します。
2. リポジトリの Settings → Pages → Source を **GitHub Actions** にします。
3. Actions タブで「ニュース更新とデプロイ」を手動実行します。以降は1時間ごとに自動更新されます。

スマホでは公開された URL を開き、「ホーム画面に追加」でインストールできます。

## 注意

- Google News RSS の利用規約は「個人的・非商用のフィードリーダーでの表示」に限られています。個人利用にとどめ、広告掲載や広い宣伝はしないでください。
- 非公式のファンメイドアプリです。球団のロゴや公式画像は使っていません。
