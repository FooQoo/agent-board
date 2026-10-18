---
title: インストールと起動
---

# インストールと起動

このページでは、`agboard`のインストールからサーバーの起動、ブラウザでボードを開くまでを説明します。起動できたら、[クイックスタート](./quickstart)で基本操作を試してください。

## 始める前に

Git、edition 2024に対応したRust、Node.js、pnpmが必要です。

## インストール

[READMEのインストール](https://github.com/FooQoo/agent-board/blob/main/README.ja.md#インストール)に従って、Web画面をビルドし、`agboard`をインストールします。インストールしたコマンドは`~/.cargo/bin`（`CARGO_HOME`を設定していれば`$CARGO_HOME/bin`）にあります。シェルから実行できることを確認します。

```sh
command -v agboard
agboard --help
```

PowerShellでは`Get-Command agboard`を使います。見つからなければ、Cargoの`bin`ディレクトリを`PATH`に加えて、新しいシェルを開きます。macOSの既定のインストールなら、シェルのプロファイルに`export PATH="$HOME/.cargo/bin:$PATH"`を加えます。

## ボードを開始する

プロジェクトを作成して、サーバーを起動します。

```sh
agboard project create "My project"
agboard serve --port 7420
```

[http://127.0.0.1:7420/](http://127.0.0.1:7420/)を開き、ヘッダーでプロジェクトを選びます。ボードを使っている間や、エージェントが回答を待っている間は、サーバーを起動したままにしてください。止めるには、そのターミナルでCtrl+Cを押します。サーバーは`127.0.0.1`だけで待ち受けます。7420が使われているときは、`--port`で別のポートを選びます。

![プロジェクトを選んだブラウザのAgent Board。未着手・進行中・完了にタスクが並ぶ](../../images/board.ja.png){.screenshot}

選んだプロジェクトがヘッダーに表示されてボードが開きます。タスクは未着手・進行中・完了の列に並びます。

ほとんどのコマンドでは、`--project NAME`で対象のプロジェクトを指定します。このガイドの例は`My project`を使っています。自分のプロジェクト名に置き換え、CLIが返すタスクIDを使ってください。プロジェクトの名前変更とフォルダの登録は、[データとバックアップ](./operations/data#プロジェクトとフォルダ)を参照してください。

## 更新する

リポジトリの変更を取り込んだら、リポジトリのルートで、ビルドしてインストールし直します。

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

CLIはビルドしたWeb画面を埋め込むので、先にWeb画面をビルドします。`--force`でインストール済みの版を置き換えます。更新したら、新しい実行ファイルと画面を使うために、`agboard serve`を止めて起動し直します。開いているボードやモニターは、サーバーが戻ると自動で再読み込みします。編集中や回答の入力中は、それが終わるまで待ちます。

Hookとエージェントのスキルは、`PATH`の`agboard`を実行するので、インストールした版を使います。開発中のビルド（`cargo build`、`cargo run`、`target/debug/agboard`）は別の実行ファイルです。Hookで使うには、インストールし直します。

## 次に読む

- [クイックスタート](./quickstart): 一つのタスクを作成から完了まで進めます。
- [エージェントとの連携](./automation/agents): Claude CodeやCodexをつなぎます。
