---
title: インストールと開始
---

# インストールと開始

## インストールと更新

[READMEのInstall](https://github.com/FooQoo/agent-board/blob/main/README.md#install)(英語)の手順で、Web画面をビルドして`agboard`をインストールします。前提は、Git、edition 2024に対応したRust、Node.js、pnpmです。

インストールしたコマンドは`~/.cargo/bin`(`CARGO_HOME`を設定している場合は`$CARGO_HOME/bin`)に置かれます。シェルから見つかることを確認します。

```sh
command -v agboard
agboard --help
```

PowerShellでは`Get-Command agboard`を使います。コマンドが見つからない場合は、Cargoの`bin`フォルダをシェルの`PATH`に追加し、新しいシェルを開きます。macOSの標準的なインストールでは、シェルのプロファイルに`export PATH="$HOME/.cargo/bin:$PATH"`を追加します。

リポジトリの変更を取り込んだ後は、リポジトリのルートで再ビルドして再インストールします。

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

CLIはビルド済みのWeb画面を含むため、先にWeb画面をビルドします。`--force`でインストール済みの版を置き換えます。更新後は`agboard serve`を止めて再起動し、新しい実行ファイルと画面を使います。

Hookとエージェントのスキルは`PATH`上の`agboard`を実行します。開発ビルド(`cargo build`、`cargo run`、`target/debug/agboard`)は別の実行ファイルです。変更をHookから使うには、再インストールします。

## プロジェクトを始める

```sh
agboard project create "My project"
agboard serve --port 7420
```

[http://127.0.0.1:7420/](http://127.0.0.1:7420/)を開き、ヘッダーでプロジェクトを選びます。ブラウザを使う間や、ボードの変更を待つ間は、サーバーを起動したままにします。止めるには、そのターミナルでCtrl+Cを押します。サーバーは`127.0.0.1`だけで待ち受けます。必要なら`--port`で別のポートを選びます。

![プロジェクトを選んだブラウザのAgent Board。カードが未着手・進行中・完了の列に並ぶ](../../images/board.ja.png){.screenshot}

ボードはヘッダーに選択中のプロジェクトを表示して開きます。カードは未着手・進行中・完了の列に並びます。

プロジェクトの作成・名前変更・削除はCLIで行います。

```sh
agboard project ls --json
agboard --project "My project" project rename "Website launch"
```

名前を変更しても、プロジェクトのID、フォルダの登録、カードは保たれます。`--project`を明示しているコマンドは名前を更新してください。フォルダに基づく進行表とHookは、同じプロジェクトを引き続き解決します。`project rm`は指定したプロジェクトとそのカードを削除します。人間による確認を求め、エージェントは使えません。

ほとんどのコマンドは`--project NAME`を明示します。`agboard progress`とHookは、最も近い登録済みのプロジェクトフォルダを解決し、`--project`を明示するとその登録より優先されます。それ以外のコマンドは、ブラウザや他のエージェントからプロジェクトを推測しません。

このガイドの例は`My project`を使います。実際のプロジェクト名と、CLIが返すIDに置き換えてください。

`project create`は、現在の作業フォルダにもプロジェクトを登録します。別の既存フォルダには`--folder`を、既存のプロジェクトには`project bind`を使います。

```sh
agboard project create "Website launch" --folder ./website
agboard project bind "My project"
agboard project bind "My project" --folder ./docs
```

1つのフォルダは1つのプロジェクトに属します。複数のフォルダを同じプロジェクトに登録できます。サブフォルダのコマンドは、最も近い登録済みの上位フォルダを使います。登録がない、または壊れている場合は、別のプロジェクトを推測せずエラーを返します。登録はローカルの設定で、持ち運べる共有ファイルとは別です。
