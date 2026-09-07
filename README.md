# 珀翔diary

保育園と家庭の連絡を日付ごとに保存し、家族で過去の記録を振り返るための個人用Webアプリです。

## 主な機能

- 日付ごとの「園からの返事」「こちらからの連絡」の登録・編集・削除
- 登録データから生成した年選択と、1週間前・1か月前・3か月前・半年前の振り返り
- 記録のある前後週への移動と最大12期間の先読みキャッシュ
- 1週間の様子を3行で表示
- ブラウザ内Tesseract.jsによる画像OCR
- 7日分のテキストコピー
- 全記録のExcelバックアップ
- ChatGPT個人用プラグインからの確認付き新規登録
- 6桁暗証番号、Sitesアクセス制御、OAuthによる保護

## 公開先

- 珀翔diary: <https://hakuto-diary.hirokazu601218.chatgpt.site>
- 珀翔diary連携: <https://hakuto-diary-connector.hirokazu601218.chatgpt.site>
## ドキュメント

- [基本設計書](docs/basic-design.md)
- [詳細設計書](docs/detailed-design.md)

## ソース構成

- `app/`: 画面、画面用API、スタイル
- `lib/`: セッション、D1、MCP登録処理
- `db/`、`drizzle/`: 日記データベース定義・マイグレーション
- `worker/`: 珀翔diaryのCloudflare Worker入口
- `connector/`: ChatGPT向けOAuth・MCP連携サイト一式
- `tests/`: 珀翔diaryの自動テスト
- `docs/`: 基本設計書・詳細設計書

## 技術構成

- React 19 / TypeScript
- Vinext / Cloudflare Workers
- OpenAI Sites
- Cloudflare D1 / Drizzle ORM
- Tesseract.js
- ExcelJS
- MCP / OAuth 2.0 Authorization Code + PKCE S256

## セットアップ上の注意

- 秘密値はSitesの環境変数として設定し、Gitへ保存しません。
- `.openai/hosting.json`には論理バインディングとSitesプロジェクトIDだけを保持します。
- `drizzle/`の適用済みマイグレーションは変更せず、スキーマ変更時は新しいマイグレーションを追加します。
- `connector/`は珀翔diary本体とは別のSitesプロジェクトとしてビルド・公開します。

## 検証

珀翔diary本体:

```bash
npm test
```

連携サイト:

```bash
cd connector
npm test
npm run build
npm run validate
```
