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
