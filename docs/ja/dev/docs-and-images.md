# ドキュメントと画像

ドキュメントサイトは`docs/`にあります。このページでは、プレビューとビルドの方法、スクリーンショットとデモ動画の再生成方法を説明します。

## ドキュメントサイト

ドキュメントサイトは`docs/`にあり、VitePressでビルドします。利用者向けのガイド(`docs/guide/`)と、この開発者向けの章(`docs/dev/`)があります。英語が正本で、英語を変えるたびに`docs/ja/`の日本語ページも揃えます。`main`から`.github/workflows/docs.yml`でGitHub Pagesに公開し、`docs/**`を変えるプルリクエストではビルドだけを行います。

```sh
pnpm --dir docs install
pnpm --dir docs dev --port <port>       # ライブプレビュー
pnpm --dir docs build                   # リンク切れも検査
pnpm --dir docs preview --port <port>   # ビルドしたサイトを配信
```

`docs/`の下を変更したら、コミット前に`pnpm --dir docs build`を実行してください。`docs/`の外にあるリポジトリのファイルへは、GitHubの絶対URLでリンクします。

図は一つの流れに絞って描きます。フローチャートとシーケンス図は文字サイズを保ち、本文より横に広い場合は枠内でスクロールします。システム構成図は左から右の流れに揃え、大きな図は目的ごとに分けてください。サイトのテストでは、図の文字サイズと、本文に未処理の太字記号が残っていないことを確認します。 表は読みやすい最小列幅を保ち、本文より広い場合は横スクロールします。セル内の文章は適度に折り返します。

ガイドの画像とデモ動画は、次のスクリプトで再生成します。どちらも先に[Web画面とCLIをビルド](./getting-started/setup.md#ビルド)し、[検証](./getting-started/pull-request.md#検証)のPlaywrightのブラウザをインストールしておく必要があります。

```sh
node e2e/scripts/docs-screenshots.mjs   # docs/images/guide/*.png(英日14枚)
node e2e/scripts/demo-video.mjs         # docs/public/videos/(ffmpegも必要)
```

どちらのスクリプトも、一時的な`AGBOARD_HOME`と専用のループバックポートを使うため、普段のボードやポート7420には影響しません。生成した画像と動画は、コミット前に確認してください。

## READMEの画像

[Web画面とCLIをビルド](./getting-started/setup.md#ビルド)したあと、READMEの画像を再生成します。

```sh
pnpm --dir e2e install --frozen-lockfile
pnpm --dir e2e exec playwright install chromium
node e2e/scripts/readme-screenshots.mjs
```

スクリプトは一時的な`AGBOARD_HOME`に使い捨てのプロジェクトを作り、空いているループバックのポートで独自のサーバーを起動し、PCのボード、エピックの進行表、モバイルのドロワーを英語と日本語で撮影します。保存されたボードやポート7420は使いません。ブラウザはビルドした画面を実際のAPIに接続して描画し、その画面を撮影します。詳細の4タブ、タスクの編集画面の折りたたまれた条件欄、ブラウザのエラーを確かめ、終わったら一時データを消します。

`docs/images/`の6枚は、コミット前にすべて確認し、サンプルの文章に個人情報を含めないでください。スクリーンショットは回帰テストやスマホのキーボードの確認の代わりにはなりません。`docs/images/guide/`のガイドの画像(14枚)は上の別のスクリプトで作るので、作り直したときはそれも確認してください。
