<div align="center">

<img src="web/public/logo.png" alt="Agent Boardのロゴ" width="120">

# Agent Board

**ユーザーとAIが一緒に作業を進める共有ボード。**

AIが作業を登録し、ユーザーも状態の更新や判断への回答を行います。

[English](README.md) · [開発に参加する](CONTRIBUTING.ja.md) · [GitHubリポジトリ](https://github.com/FooQoo/agent-board)

![ローカル完結](https://img.shields.io/badge/data-local%20only-1f6feb)
![SQLite](https://img.shields.io/badge/storage-SQLite-1f6feb)
![macOS と Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1f6feb)

<img src="docs/images/board.png" alt="Agent Boardのボード" width="860">

</div>

## Agent Boardとは

エージェントに長い作業を任せると、どの作業が進み、何を待ち、何の返事が必要なのか分かりにくくなります。Agent Boardはユーザーとエージェントが同じ履歴つきボードを見て、作業の往復を続けられるようにします。

- **AIが人とAIの作業を登録します。** 担当はAIまたはユーザーに固定され、カードの列と状態で進み具合を示します。
- **ユーザーとAIが同じボードを更新します。** 状態変更には理由を残します。ユーザーが判断依頼に答えると、次のHookや`agboard snapshot`がその回答を含む全履歴をAIへ渡します。
- **すべてのコマンドが対象プロジェクトを指定します。** ボードには複数のプロジェクトがあり、コマンド・Hook・待機は`--project NAME`で対象を明示します。Web画面や別のエージェントの選択から推測することはありません。
- **データはマシンの外へ出ません。** カードはローカルのSQLiteに保存され、Web画面は`127.0.0.1`だけで待ち受けます。

```mermaid
flowchart LR
    A["AIエージェント"] -- "agboard CLI・Hook" --> D[("ローカルのSQLite")]
    U["ユーザー"] -- "Agent Board UI" --> D
    D -- "ローカルサーバー" --> B["ブラウザ"]
```

## 特徴

**次に必要なことが分かります。** カードには担当と列が表示されます。進行中のAI担当カードにはIDLE・RUNNING・PENDINGを表示し、PENDINGの理由と履歴を確認できます。

**判断の経緯が残ります。** ユーザーは理由を添えてカードを移動し、判断依頼へ回答できます。AIは回答を読んで方針を見直し、作業を再開します。

**あえてシンプルにしています。** プロジェクトごとに列は3つ、データ領域はローカルに1つだけ。アカウントもクラウドも要りません。

**言語と配色を選べます。** ヘッダーの設定から、Web画面の言語(日本語/English)と、24種類のカラーテーマ(12色のライトとダーク)を切り替えられます。

## インストール

Agent Boardはソースからビルドします。エージェントやHookが実行できるよう、`agboard`を`PATH`上に導入します。

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

CLIはビルド済みのWeb画面を含むため、先にWeb画面をビルドします。`cargo install`は`agboard`を`~/.cargo/bin`(または`$CARGO_HOME/bin`)へ置くので、そのディレクトリが`PATH`に入っている必要があります。次で確認します。

```sh
command -v agboard
agboard --help
```

`command -v agboard`が何も表示しない場合は、シェルのプロファイルに`export PATH="$HOME/.cargo/bin:$PATH"`のようにディレクトリを追加し、新しいシェルを開いてください。変更を取り込んで更新するときは、上の3つのコマンドを再実行します。`--force`で導入済みの版を置き換えます。

Hookとエージェントスキルは`PATH`上の`agboard`を実行するため、この導入版が使われます。開発中のビルド(`cargo build`、`cargo run`、`target/debug/agboard`)は別の実行ファイルで、導入版は変わりません。変更をHookに反映するには再導入してください。

## はじめかた

```sh
agboard project create "My project"
agboard serve --port 7420
```

`project create`、`project ls`、`serve`以外のすべてのコマンドは`--project NAME`が必須です。ブラウザからカードを登録するか、`agboard --project "My project" add "作業" --assignee ai --actor ai`で登録できます。Claude CodeとCodexのHook設定は[連携ガイド](integrations/README.md)を参照してください。ビルド方法は[CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)にあります。

<details>
<summary><strong>コマンド例</strong></summary>

```sh
agboard project ls --json
agboard --project "My project" snapshot --json
agboard --project "My project" mv 1 doing --actor ai --reason "実装を開始する"
agboard --project "My project" state 1 running --actor ai --reason "承認済みの変更を実装中"
agboard --project "My project" state 1 pending --actor ai --reason "動作方針の判断が必要"
agboard --project "My project" state 1 idle --actor human --request <request-id> --reason "現在の動作を維持する"
agboard --project "My project" state 1 running --actor ai --reason "ユーザーの方針に沿って再開する"
agboard --project "My project" mv 1 done --actor ai --reason "実装と検証が完了した"
agboard --project "My project" wait --after <cursor>
```

その他のコマンド: `add`、`edit`、`show`、`rm`、`export`、`import`、`project rename`、`project rm`、`hook`。詳しくは`agboard --help`または`agboard <command> --help`を実行してください。`--json`で機械処理向けの出力になります。`<cursor>`は同じプロジェクトのsnapshotの`cursor`(`<プロジェクトID>:<revision>`)です。

`agboard --help`と[Agent Skills](integrations/README.md)にも同じ進め方を記載しています。

</details>

<details>
<summary><strong>エージェントの作業手順</strong></summary>

```text
agboard --project "<名前>" snapshot --json   # ボードと全履歴を読む
agboard --project "<名前>" mv <id> doing --actor ai --reason "<理由>"
agboard --project "<名前>" state <id> running --actor ai --reason "<理由>"
agboard --project "<名前>" state <id> pending --actor ai --reason "<必要な判断>"
agboard --project "<名前>" state <id> idle --actor human --request <id> --reason "<回答・方針>"
agboard --project "<名前>" state <id> running --actor ai --reason "<回答を踏まえた進め方>"
agboard --project "<名前>" mv <id> done --actor ai --reason "<完了した内容>"
agboard --project "<名前>" wait --after "<cursor>"   # 進められる作業がないとき
```

状態を変更するときはactorとreasonを必ず指定します。指示された対象のプロジェクトだけを使い、指定がなければ確認します。snapshotやHookの内容が、期待する`project`と`cursor`であることを確かめてから動きます。進められる作業がない場合は、定期取得せず変更通知を待ちます。プロジェクトの名前が変わっても同じプロジェクトとして作業を続け、Hookコマンドの名前を更新します。読み取れない場合(`AGBOARD_ERROR`、プロジェクトなし、タイムアウト)は、ボードに依存する変更を止めて報告します。

</details>

<details>
<summary><strong>表示言語とテーマ</strong></summary>

Web画面は英語・ライトブルーで開きます。ヘッダーの設定からEnglishまたは日本語とカラーテーマを選べます。変更はすぐに反映され、ブラウザに保存されます。ブラウザやOSの言語・配色設定からは自動選択しません。CLI、helpとエラーメッセージ、APIとJSONの値は英語です。入力したカード内容は翻訳されません。

</details>
