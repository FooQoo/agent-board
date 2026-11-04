# ドキュメントと画像

ドキュメントサイトは`docs/`にあります。このページでは、プレビューとビルドの方法、スクリーンショットとデモ動画の再生成方法を説明します。

## ドキュメントサイト

ドキュメントサイトは`docs/`にあり、VitePressでビルドします。利用者向けのガイド（`docs/guide/`）と、この開発者向けの章（`docs/dev/`）があります。英語が正本で、英語を変えるたびに`docs/ja/`の日本語ページも揃えます。`main`から`.github/workflows/docs.yml`でGitHub Pagesに公開し、`docs/**`を変えるプルリクエストではビルドだけを行います。

```sh
pnpm --dir docs install
pnpm --dir docs dev --port <port>       # ライブプレビュー
pnpm --dir docs build                   # リンク切れも検査
pnpm --dir docs preview --port <port>   # ビルドしたサイトを配信
```

`docs/`の下を変更したら、コミット前に`pnpm --dir docs build`を実行してください。`docs/`の外にあるリポジトリのファイルへは、GitHubの絶対URLでリンクします。

トップページにはMarkdownの本文がありません。文言は`docs/index.md`と`docs/ja/index.md`のfrontmatterにある`landing`に置き、`docs/.vitepress/theme/LandingPage.vue`がそれを配置します。言語に合ったスクリーンショットを選び、ダークテーマではボードの画像をダーク版に切り替えるのもこのコンポーネントです。文言は両方のファイルで直し、キーをそろえてください。frontmatterのリンクはbuildのリンク切れ検査の対象外なので、サイトのテストがトップページのすべてのリンクを開いて確かめます。配色は`custom.css`の`--lp-*`変数で、アプリの列と待機中の色に合わせています。

図は一つの流れに絞って描きます。フローチャートとシーケンス図は文字サイズを保ち、本文より横に広い場合は枠内でスクロールします。システム構成図は左から右の流れに揃え、大きな図は目的ごとに分けてください。サイトのテストでは、図の文字サイズと、本文に未処理の太字記号が残っていないことを確認します。表は読みやすい最小列幅を保ち、本文より広い場合は記事の中で横にスクロールします。セル内の文章は折り返せます。

ガイドの画像とデモ動画は、次のスクリプトで再生成します。どちらも先に[Web画面とCLIをビルド](./getting-started/setup.md#ビルド)し、[検証](./getting-started/pull-request.md#検証)のPlaywrightのブラウザをインストールしておく必要があります。

```sh
node e2e/scripts/docs-screenshots.mjs   # docs/images/guide/*.png(英日18枚)
node e2e/scripts/demo-video.mjs         # docs/public/videos/(ffmpegも必要)
```

どちらのスクリプトも、一時的な`AGBOARD_HOME`と専用のループバックポートを使うため、普段のボードやポート7420には影響しません。生成した画像と動画は、コミット前に確認してください。

## 公開済みリリースの情報をプレビューする

サイトのヘッダーの版は、リポジトリではなく、公開済みのGitHub Releaseから作ります。ビルドの前に、`node scripts/release/docs-release.mjs`が書き出します。サイトにはリリースノートのページはなく、GitHub Releaseがリリースノートです。

```sh
node scripts/release/docs-release.mjs --github --repo FooQoo/agent-board   # 公開するサイト
node scripts/release/docs-release.mjs --fixture                              # 公開済みの状態を手元で確認
node scripts/release/docs-release.mjs --none                                 # リリース前の状態（既定）
pnpm --dir docs build
```

- 対象にするのは、`draft=false`、`prerelease=false`で、タグが`vMAJOR.MINOR.PATCH`の形のリリースだけで、その中で版が最も新しいものを使います。`Cargo.toml`の版は使いません。各リリースの本文には、`## English`と`## 日本語`のセクションが必要で、それぞれに4つの見出し（`### Changes`、`### Fixes`、`### Breaking changes`、`### Required update steps`と、その日本語の見出し）が要ります。満たさないと、スクリプトは止まります。
- `docs/.vitepress/release.json`（Gitは無視します。ヘッダーが読みます）を書き出します。`--fixture`は`releases/`のレビュー用の原稿を使い、fixtureの状態として記録するので、ヘッダーには版を表示しません。
- Pagesのワークフローは、`main`へのプッシュ、`release`イベント（published、edited、deleted）、手動の実行で、ビルドの前にこのスクリプトを`--github`で実行します。APIの呼び出しが失敗する、またはリリースが不正なときは、ビルドが止まり、公開済みのサイトはそのまま残ります。プルリクエストは、コミットしてある状態で、オフラインでビルドします。ワークフロー自身のトークンで公開したリリースは、ワークフローを起動しないことがあります。その場合は手動で実行してください。
- `releases/vX.Y.Z.md`は、リリースノートのレビュー用の原稿です。公開後は、GitHub Releaseの本文が正本です。
- 公開したリリースのヘッダーを確認するには、GitHub APIの一覧と同じ形のファイルを`--releases-json`に渡してスクリプトを実行し、ビルドして、`pnpm --dir docs preview --port <port>`で開きます。確認したら、`--none`で戻します。

## UIのStoryとカバレッジ

Storybookでは、部品の状態を個別に表示したり、アプリと同じUI部品を組み合わせてページ全体を表示したりできます。各部品のStory、焦点を絞ったテスト、専用スタイル、カバレッジ台帳はソースの近くに置きます。部品やページを変更したら、Storyと画面状態の記録も更新し、対象の言語・テーマ・表示幅で画面を確認してください。自動検査の現在の範囲は[開発環境のセットアップ](./getting-started/setup.md#storybook)を参照してください。

## READMEの画像

[Web画面とCLIをビルド](./getting-started/setup.md#ビルド)したあと、READMEの画像を再生成します。

```sh
pnpm --dir e2e install --frozen-lockfile
pnpm --dir e2e exec playwright install chromium
node e2e/scripts/readme-screenshots.mjs
```

スクリプトは一時的な`AGBOARD_HOME`に使い捨てのプロジェクトを作り、空いているループバックのポートで独自のサーバーを起動し、PCのボード、エピックの進捗パネル、スマホの2画面（選択肢を選んだ質問、下部のドロワー）を英語と日本語で撮影します。普段のボードやポート7420は使いません。ブラウザはビルドした画面を実際のAPIに接続して描画するので、画像はモックではありません。詳細の4つのタブ、タスクの編集画面の折りたたんだ受入条件の欄、ブラウザのエラーを確かめ、終わったら一時データを消します。

`docs/images/`の8枚は、コミット前にすべて確認し、サンプルの文章に個人情報を含めないでください。スクリーンショットは回帰テストやスマホのキーボードの確認の代わりにはなりません。`docs/images/guide/`のガイドの画像（18枚）は上の別のスクリプトで作るので、作り直したときはそれも確認してください。
