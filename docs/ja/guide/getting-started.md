---
title: インストールと起動
---

# インストールと起動

このページを読み終えると、Homebrewで`agboard`をインストールし、作業フォルダにプロジェクトを作り、エージェントを設定し、ブラウザでボードを開けます。続いて[クイックスタート](./quickstart)で基本操作を試してください。

手順は、インストール、プロジェクトの作成またはフォルダの登録、エージェントの設定、サーバーの起動の順です。

## 始める前に

- macOS 15以降を搭載した、Apple SiliconまたはIntelのMac。
- [Homebrew](https://brew.sh)。Homebrew自体にも、環境によってはCommand Line Toolsなどの前提があります。その内容はHomebrewのドキュメントに従ってください。
- 設定の手順で使う、`PATH`上のClaude CodeまたはCodex（`claude`か`codex`のコマンド）と、GitHubへのネットワーク接続。

Agent Boardを自分でビルドする必要はありません。Homebrewで入るのは、Web画面を内蔵したビルド済みのコマンドです。Rust、Node.js、pnpmは不要で、リポジトリをcloneすることもありません。ソースからビルドする場合は、[開発環境のセットアップ](../dev/getting-started/setup)を参照してください。

## インストール

```sh
brew install fooqoo/tap/agboard
agboard --version
```

このコマンドは、Developer ID証明書で署名され、Appleの公証を受けています。macOSが実行を拒否したときは、Gatekeeperを無効にせず、[トラブルシューティング](./operations/troubleshooting#macos-will-not-run-agboard)を参照してください。

Agent BoardはMITライセンスで公開しています。ライセンスと、同梱する第三者コンポーネントの通知は、Homebrewのprefix配下の`share/agboard`（`$(brew --prefix)/share/agboard`）にインストールされます。

## プロジェクトを作成する、またはフォルダを登録する {#create-or-bind-a-project}

作業しているフォルダに移動します。プロジェクトは、登録したフォルダに属し、そのサブフォルダも同じプロジェクトを使います。フォルダごとに一度だけ行います。

```sh
cd my-project
agboard project create "My project"
```

`project create`は、プロジェクトを作成し、現在のフォルダをそのプロジェクトに登録します。プロジェクトがすでにある場合は、代わりにこのフォルダをそのプロジェクトに登録します。

```sh
agboard project bind "My project"
```

プロジェクトの名前変更や、ほかのフォルダの登録は、[データとバックアップ](./operations/data#projects-and-folders)を参照してください。

## エージェントを設定する

```sh
agboard setup
```

`setup`は、使うエージェントを尋ねて計画を表示し、`y`と答えると、Claude Code、Codex、または両方にAgent Boardプラグイン（SkillとHook）を導入します。コンピューターごとに一度実行すればよく、どのフォルダでも実行できます。尋ねる内容、変更するもの、その後の操作は、[エージェントを設定する](./delegate/agents#set-up-your-agents)を参照してください。

## ボードを開始する

サーバーを起動します。

```sh
agboard serve
```

[http://127.0.0.1:7420/](http://127.0.0.1:7420/)を開き、ヘッダーでプロジェクトを選びます。止めるには、そのターミナルでCtrl+Cを押します。エージェントのために動かし続ける必要はありません。サーバーが動いていなければ、待つコマンドとエージェントのHookが裏で起動し、そのサーバーは30分使われないと自分で止まります。裏で動かし続けたいときは、`agboard serve -d`を使います。サーバーは`127.0.0.1`だけで待ち受けます。7420が使われているときは、`--port`で別のポートを選びます。

![プロジェクトを選んだブラウザのAgent Board。未着手・進行中・完了にタスクが並ぶ](../../images/board.ja.png){.screenshot}

選んだプロジェクトがヘッダーに表示されてボードが開きます。タスクは未着手・進行中・完了の列に並びます。

ほとんどのコマンドでは、`--project NAME`で対象のプロジェクトを指定します。このガイドの例は`My project`を使っています。自分のプロジェクト名に置き換え、CLIが返すタスクIDを使ってください。プロジェクトの名前変更とフォルダの登録は、[データとバックアップ](./operations/data#projects-and-folders)を参照してください。

## 更新する

Homebrewでコマンドを更新し、続けてAgent Boardプラグインを同じ版にそろえます。

```sh
brew upgrade fooqoo/tap/agboard
agboard --version
agboard update
```

`brew upgrade`が置き換えるのは、コマンドとその中のWeb画面です。エージェントのプラグインは変わりません。それを更新するのが`agboard update`で、プラグインがあるすべてのエージェントが対象です。変更内容を表示して確認を求めます。`agboard update --yes`は、その質問にあらかじめ答えます。詳しくは[プラグインを更新する](./delegate/agents#update-the-plugin)を参照してください。

更新したら、新しいコマンドと画面を使うために、`agboard serve`を止めて起動し直します。開いているボードやモニターは、サーバーが戻ると自動で再読み込みします。編集中や回答の入力中は、それが終わるまで待ちます。

忘れても、新しいエージェントのセッションが知らせます。プラグインとコマンドの版が違うと、エージェントが`agboard update`の実行を促します。

Hookとエージェントのスキルは、`PATH`の`agboard`を実行するので、インストールした版を使います。開発中のビルド（`cargo build`、`cargo run`、`target/debug/agboard`）は別の実行ファイルです。

## 次に読む

- [クイックスタート](./quickstart): 一つのタスクを作成から完了まで進めます。
- [エージェントとの連携](./delegate/agents): `setup`が尋ねる内容と、エージェントがボードで作業する流れです。
- [機能の提供段階](./feature-stages): 一般提供の機能と、パブリックプレビューの機能を確認します。
