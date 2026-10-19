# 開発環境のセットアップ

Agent Boardの開発に必要な環境を用意し、ビルド・動作確認・ソースからのインストールまでを行います。動作確認には一時的なボードを使います。コマンドはすべてリポジトリのルートで実行します。

## 始める前に

必要なもの:

- Rustのstableツールチェーン（`cargo`）。
- Node.jsと`pnpm`（Corepack経由）。
- 任意: 定型コマンドを実行する[`just`](https://github.com/casey/just)と、`just serve`のためのWatchexec（`cargo install --locked watchexec-cli`）。
- E2Eテストとスクリーンショット: PlaywrightのChromium（インストール方法は後述）。デモ動画: `ffmpeg`。

普段使っているボードへの影響を避けるため、次の二点を守ってください。

- **一時的なデータ領域を使う。** 既定のデータ領域（macOSは`~/.agent-board/`、Windowsは`%USERPROFILE%\.agent-board\`）は普段使っているボードの保存先です。試すときやテストでは、`AGBOARD_HOME`に一時ディレクトリを設定してください。この設定は現在のシェル内で有効です。
- **ポート7420を空けておく。** 通常の利用の既定のポートです。ほかのポートか、テストではポート0を使ってください。

## ビルド

CLIはビルドしたWeb画面を埋め込むので、先に画面をビルドします。

```sh
pnpm --dir web install
pnpm --dir web build
cargo build
```

実行ファイルは`target/debug/agboard`です。`cargo build`が`Run "pnpm --dir web build" first.`で止まったら、Web画面がまだビルドされていません。

## 開発

よく使う手順は`just`で実行できます。

```sh
just dev          # サンプルのボードとViteのHMR(ポート5173)
just build        # Web画面とCLIを順にビルド
just serve        # 保存されたボードとViteのHMR、Rustの監視(ポート7420)
```

- `just dev`はサンプルデータを配信し、Webのファイルが変わるとHMRでブラウザを更新します。
- `just serve`は実際のAPIに接続します。Rustのファイルが変わるとRustのサーバーを起動し直し、画面はViteのHMRで配信します。`http://127.0.0.1:7420/`を開きます。RustのAPIはポート7421を使います。ボードは通常の場所、または設定されていれば`AGBOARD_HOME`から読みます。Rustが起動し直すと、書き込み用トークンを更新するためにページが再読み込みされます。
- ほかのポートは引数で渡します。例: `just dev 5174`、`just serve 7500 7501`（Webのポート、RustのAPIのポートの順）。

サンプルデータでWeb画面だけを開発するには:

```sh
pnpm --dir web dev --mode mock --port <port>
```

手でCLIを試すときは、一時的なデータ領域を使います。

```sh
export AGBOARD_HOME="$(mktemp -d)"
cargo run -- project create dev
cargo run -- --project dev add "Try it" --assignee ai --actor ai
cargo run -- serve --port <port>
```

データ領域には、プロジェクトのファイルを保存する`shared/`、サーバーの稼働情報を示す`serve.json`、多重起動を防ぐ`lifecycle.lock`があります。データベースは使いません。`task.json`はタスクの現在の状態（`formatVersion: 1`）を、`TASK.md`は本文・受入条件と`at`/`reason`の履歴を持ちます。`formatVersion`が1でないファイルは未対応として報告し、移行しません。すべてのファイルは[データモデル](../reference/files.md#ディスク上のファイル)で説明しています。

## Storybook

Storybookでは、Web画面の各部品を架空のデータで表示できます。ツールバーで表示言語、ライト・ダークモード、アクセントの色、表示幅を切り替えられます。Storyは部品と同じ場所に、`web/src/**/*.stories.tsx`として置きます。共通のfixture、decorator、テスト用の部品は`web/.storybook/`にあります。

```sh
pnpm --dir web storybook
pnpm --dir web build-storybook
pnpm --dir web typecheck:storybook
TZ=UTC pnpm --dir web test:storybook
```

- `storybook`は開発サーバーを`http://127.0.0.1:8610/`で起動します。
- `build-storybook`は静的ビルドを`web/storybook-static/`に出力します。
- `typecheck:storybook`はStoryとStorybookの設定を型検査します。
- `test:storybook`はChromiumでブラウザの試験を2つのプロジェクトとして実行します。1つはすべてのStoryを、再生関数を含めて実行します。もう1つは`web/.storybook/`の共通部分の試験を実行します。

表示幅の切り替えでは、デスクトップの1280px、携帯の監視画面の375pxと390pxを選べます。

Storybookのビルドはアプリのビルドと分けています。Storybookは専用のViteの設定（`web/.storybook/vite.config.ts`）を使うため、アプリのモック、実APIへの接続、チャンクの設定は適用されません。出力先も異なり、Storybookは`web/storybook-static/`、アプリは`web/dist/`です。

製品のコードからStoryや`web/.storybook/`の内容をimportしてはいけません。Storyとテストだけが共通の部分を使えます。`pnpm --dir web check`がこの規則を確認します。300行の上限は`web/src`の製品のファイルだけに適用され、Storyとテストはこの上限の対象外です。また、Storyは製品のAPIとイベントストリームへのリクエストを拒否するため、それらを呼ぶStoryは失敗します。

Storyで使う架空の画像は`web/.storybook/static/`にあります。Storybookとテストはこのフォルダをルートから配信するため、Storyは設定なしに`/sample-attachment.png`のようなURLを使えます。

各UIのフォルダには`story-coverage.json`を置きます。これは隣にあるソースファイルの公開された部品、各部品を表示するStory、Storyが示す状態を一覧にします。同じフォルダでほかのファイルも対象にする場合は`story-coverage.<name>.json`を使います。形式と規則は`web/.storybook/support/component-coverage.json`にあります。台帳の検査はこれらのファイルを検証し、Story IDをStorybookが登録するStoryと照合します。ただし、製品の公開された部品をすべて列挙する検査はまだありません。

## ソースからインストール

エージェントとHookは`PATH`の`agboard`を実行するので、変更をエージェント経由で試すには、ビルドした実行ファイルをインストールします。

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
command -v agboard
```

`cargo install`は`~/.cargo/bin`（または`$CARGO_HOME/bin`）に書き込みます。そのディレクトリが`PATH`に入っている必要があります。`command -v agboard`が何も表示しなければ、例えば`export PATH="$HOME/.cargo/bin:$PATH"`で追加し、新しいシェルを開きます。

インストールした`agboard`と開発中のビルドは別のファイルです。Hookはインストールした方を呼び、`cargo build`・`cargo run`・`target/debug/agboard`は作業ツリーを使います。Hookで変更を確かめる前に、インストールし直してください。

`~/.cargo/bin`や自分のボードに触れずにインストールを試すには:

```sh
root="$(mktemp -d)"
cargo install --path . --locked --root "$root"
export AGBOARD_HOME="$(mktemp -d)"
"$root/bin/agboard" --help
"$root/bin/agboard" project create demo
"$root/bin/agboard" --project demo ls
```
