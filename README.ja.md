# SimpleKanban

[English](README.md)

コーディングエージェント向けのローカルなカンバンボードです。

## 概要

エージェントはコマンドラインの`skan`でカードを管理し、人間はブラウザで進捗を確認できます。

- CLIの`skan`では、カードの作成・編集、列間の移動、稼働状態の報告、一覧表示、詳細表示、エクスポート、インポートができます。人間もCLIを使えます。
- Web画面(`skan serve`)は人間向けです。ボードを表示して自動更新し、カードを削除できます。
- 列はTodo、Doing、Doneの3つです。稼働状態(idle、running、pending)があるのはDoing列のカードだけです。
- すべてのデータはローカルのSQLiteデータベースに保存されます。マシンの外へデータは送信されません。`skan serve`は`127.0.0.1`だけで待ち受けます。

## 表示言語

Web画面は英語で開きます。ヘッダーの地球ボタンからEnglishまたは日本語を選べます。選択した言語はブラウザに保存されます。ブラウザやOSの言語設定から表示言語を自動選択することはありません。CLI、helpとエラーメッセージ、APIとJSONの値は英語のままです。入力したカードの内容は翻訳されません。

## ビルド

最初にWeb画面をビルドし、その後CLIをビルドします。CLIにはビルド済みのWeb画面が含まれます。

```sh
pnpm --dir web install
pnpm --dir web build
cargo build
```

実行ファイルは`target/debug/skan`です。

## 使い方

```sh
skan init --name my-board          # ボードを作成
skan add "Write the setup guide"   # Todo列にカードを追加
skan mv 1 doing                    # カード#1をDoingへ移動
skan state 1 running               # カード#1を実行中として報告
skan state 1 pending --reason "Waiting for review"
skan ls                            # 列ごとにカードを表示
skan ls --column doing --state running
skan serve --port 7420             # ブラウザでボードを表示
```

その他のコマンド: `edit`、`show`、`rm`、`export`、`import`。詳しくは`skan --help`または`skan <command> --help`を実行してください。

- どのコマンドにも`--json`を付けると、機械処理向けの出力になります。
- カードの削除(`rm`)、既存ボードへの`init`の再実行、既存ボードへの`import`では、人間に確認を求めます。エージェントはこれらを実行できません。

## エージェント向けルール

同じ進め方とルールは`skan --help`にも表示されます。コマンドの出力は英語のままです。

```text
Workflow for agents:
  skan ls --json                             # read the board first; a human may have moved cards
  skan mv <id> doing                         # you start a card
  skan state <id> running                    # you are working on it
  skan state <id> pending --reason "<text>"  # you are waiting for a human or an external result
  skan state <id> running                    # the wait is over
  skan mv <id> done                          # you are finished (the card returns to idle)
Do not leave a card running when you stop: finish it, or run `skan state <id> idle`.

Rules for agents:
  - Move a card to doing before you report running or pending.
  - Report pending with --reason when you are waiting for something.
  - Moving a card to todo or done resets it to idle.
  - You cannot delete cards or replace the board. Ask a human to do it.
  - Add --json to any command for machine-readable output.
```

## 開発

すべてのコマンドはリポジトリのルートから実行します。

CLIを実行またはテストするときは、実際のボードに触れないよう`SKAN_HOME`を一時ディレクトリに設定してください。macOSの既定のデータ保存先は`~/Library/Application Support/skan/`、Windowsでは`%APPDATA%\skan\`です。

```sh
export SKAN_HOME="$(mktemp -d)"
cargo run -- init --name dev
cargo run -- serve --port <port>
```

exportした`SKAN_HOME`は、そのシェルセッション内のコマンドで共有されます。新しいセッションでは再度設定してください。

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
TZ=UTC pnpm --dir web test
```

テストでは表示時刻を固定するため`TZ=UTC`を設定します。テストでは通常利用のために空けているポート7420を使わないでください。接続先には`localhost`ではなく`http://127.0.0.1:<port>/`を使います。
