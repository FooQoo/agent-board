# Agent Boardへの貢献

[English](CONTRIBUTING.md)

## ビルド

最初にWeb画面をビルドし、その後CLIをビルドします。CLIにはビルド済みのWeb画面が含まれます。

```sh
pnpm --dir web install
pnpm --dir web build
cargo build
```

実行ファイルは`target/debug/agboard`です。

## ソースからインストール

エージェントとHookは`PATH`上の`agboard`を実行するため、ビルドしたものを`PATH`上に導入します。

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
command -v agboard
```

CLIはWeb画面を含むため、先にWeb画面をビルドします。`cargo install`は`~/.cargo/bin`(または`$CARGO_HOME/bin`)へ書き込むので、そのディレクトリが`PATH`に入っている必要があります。`command -v agboard`が何も表示しない場合は、`export PATH="$HOME/.cargo/bin:$PATH"`のように追加し、新しいシェルを開いてください。コードを変更したら、3つのコマンドを再実行して導入版を更新します。

導入した`agboard`と開発中のビルドは別のファイルです。Hookのコマンドは導入版を呼び、`cargo build`・`cargo run`・`target/debug/agboard`は作業ツリーの版を使います。Hookで変更を確認する前に再導入してください。

`~/.cargo/bin`や自分のボードに触れずに導入を試すには、一時ディレクトリへ導入し、一時のデータ領域を使います。

```sh
root="$(mktemp -d)"
cargo install --path . --locked --root "$root"
export AGBOARD_HOME="$(mktemp -d)"
"$root/bin/agboard" --help
"$root/bin/agboard" project create demo
"$root/bin/agboard" --project demo ls
```

## 開発

すべてのコマンドはリポジトリのルートから実行します。

よく使う操作は`just`で実行できます。

```sh
just dev          # サンプルデータでWeb画面を開発（ポート5173、Vite HMR）
just build        # Web画面、CLIの順にビルド
just serve        # 保存済みボードを表示（ポート7420、Vite HMRとRust監視）
```

`just dev`はWebファイルの変更を監視し、HMRで画面に反映します。`just serve`にはWatchexecが必要です。`cargo install --locked watchexec-cli`でインストールできます。Rustファイルを監視してAPIを再起動し、Web画面はViteのHMRで更新します。画面は`http://127.0.0.1:7420/`で開き、Rust APIはポート7421を使います。ボードは通常の保存先から読み込み、`AGBOARD_HOME`が設定されていればその保存先を使います。Rustの再起動時には削除用トークンを更新するため画面を再読み込みします。

ポートを変える場合は`just dev 5174`、または`just serve 7500 7501`（Web、Rust APIの順）のように指定します。

CLIを手動で試したりテストしたりするときは、実際のボードに触れないよう`AGBOARD_HOME`を一時ディレクトリに設定してください。macOSの既定のデータ保存先は`~/Library/Application Support/agboard/`、Windowsでは`%APPDATA%\agboard\`です。

```sh
export AGBOARD_HOME="$(mktemp -d)"
cargo run -- project create dev
cargo run -- --project dev add "試す" --assignee ai --actor ai
cargo run -- serve --port <port>
```

exportした`AGBOARD_HOME`は、そのシェルセッション内のコマンドで共有されます。新しいセッションでは再度設定してください。

データ領域には、`shared/`(プロジェクトのフォルダをプレーンファイルとして保存)、サーバー稼働中の`serve.json`、`lifecycle.lock`ファイルがあります。データベースは使いません。

各タスクの`task.json`には現在のレーンや担当などのメタデータを保存し、形式の版は3です。本文・受け入れ条件・操作履歴の正本は`TASK.md`です。画面やCLIで状態を変えると履歴が`TASK.md`に追記され、本文や受け入れ条件の編集では最新の履歴が保たれます。トップレベルの`history` frontmatterには、日時の`at`と内容の`reason`だけを持つ履歴を保存します。作業の進捗とカード操作は、ファイル・API・CLIで同じ形式です。本文には計画・検証結果・証跡への参照を記述し、時系列の履歴は記述しません。エピックの計画は`PLAN.md`に保存します。進行順はpriorityメタデータに、参考条件はMarkdown本文に記述し、エピックには履歴を保存しません。

タスクの形式の版が1と2のファイルは未対応で、アプリは問題として報告し、ファイルを変更しません。移行、旧形式へのフォールバック、旧タスクデータの削除・初期化は行いません。ほかの共有JSONファイルは形式の版が1のままです。

サンプルデータでWeb画面だけを開発するには、次を実行します。

```sh
pnpm --dir web dev --mode mock --port <port>
```

検証コマンド:

```sh
pnpm --dir web install
pnpm --dir web build               # cargo buildの前に必要
cargo build
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
TZ=UTC cargo test
pnpm --dir web typecheck
pnpm --dir web check
TZ=UTC pnpm --dir web test
```

Web のフォーマットを適用するには `pnpm --dir web format` を実行します。

テストでは表示時刻を固定するため`TZ=UTC`を設定します。テストは既定のデータ領域を使わず、それぞれ`AGBOARD_HOME`を一時ディレクトリに設定します。テストでは通常利用のために空けているポート7420を使わないでください。接続先には`localhost`ではなく`http://127.0.0.1:<port>/`を使います。

## ドキュメントサイト

ドキュメントサイトは`docs/`にあり、VitePressでビルドします。英語を正本とし、英語を変更するときは`docs/ja/`の日本語ページも同じ変更で追従させます。`main`への変更は`.github/workflows/docs.yml`でGitHub Pagesに公開され、`docs/**`を変えるプルリクエストではビルドだけを行います。

```sh
pnpm --dir docs install
pnpm --dir docs dev --port <port>       # ライブプレビュー
pnpm --dir docs build                   # リンク切れの検査も行う
pnpm --dir docs preview --port <port>   # ビルドしたサイトを配信
```

`docs/`以下を変更したら、コミット前に`pnpm --dir docs build`を実行してください。

ガイドのスクリーンショットとデモ動画は次のスクリプトで再生成します。どちらも先にWeb画面とCLIを[ビルド](#ビルド)し、[READMEの画像](#readmeの画像)のブラウザ用ツールを導入しておく必要があります。

```sh
node e2e/scripts/docs-screenshots.mjs   # docs/images/guide/*.png(英日の12枚)
node e2e/scripts/demo-video.mjs         # docs/public/videos/(ffmpegも必要)
```

どちらのスクリプトも一時の`AGBOARD_HOME`のデータと専用のループバックポートを使うため、通常のボードとポート7420には触れません。生成した画像と動画はコミット前に確認してください。

## READMEの画像

[Web画面とCLIをビルド](#ビルド)した後、ブラウザ用のツールを導入して画像を再生成します。

```sh
pnpm --dir e2e install --frozen-lockfile
pnpm --dir e2e exec playwright install chromium
node e2e/scripts/readme-screenshots.mjs
```

スクリプトは一時の`AGBOARD_HOME`にサンプルプロジェクトを作成し、空いているループバックポートで専用サーバーを起動します。PCボード・エピックの進行表・モバイルのドロワーを日英で撮影し、4タブ・カード編集の畳まれた受け入れ条件・ブラウザエラーを確認します。通常データとポート7420は使いません。ビルド済み画面と実APIを使うため、画像はモックではありません。終了時に専用サーバーを停止し、一時データを削除します。

コミット前に`docs/images/`の6枚を目視確認してください。サンプルに個人情報を含めないでください。この撮影は回帰テストやスマホのキーボード確認の代わりにはなりません。ガイド用の`docs/images/guide/`の12枚は別のスクリプトで生成します。再生成したときは、こちらも目視確認してください([ドキュメントサイト](#ドキュメントサイト)を参照)。
