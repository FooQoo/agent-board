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

**あえてシンプルにしています。** 列は3つ、ボードはローカルに1つだけ。アカウントもクラウドも要りません。

**日本語と英語に対応しています。** ヘッダーの地球ボタンでWeb画面の言語を切り替えられます。

## はじめかた

```sh
agboard init --name agent-board
agboard serve --port 7420
```

ブラウザからカードを登録するか、`agboard add "作業" --assignee ai --actor ai`で登録できます。Claude CodeとCodexのHook設定は[連携ガイド](integrations/README.md)を参照してください。ビルド方法は[CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)にあります。

<details>
<summary><strong>コマンド例</strong></summary>

```sh
agboard snapshot --json
agboard mv 1 doing --actor ai --reason "実装を開始する"
agboard state 1 running --actor ai --reason "承認済みの変更を実装中"
agboard state 1 pending --actor ai --reason "動作方針の判断が必要"
agboard state 1 idle --actor human --request <request-id> --reason "現在の動作を維持する"
agboard state 1 running --actor ai --reason "ユーザーの方針に沿って再開する"
agboard mv 1 done --actor ai --reason "実装と検証が完了した"
agboard wait --after <revision>
```

その他のコマンド: `add`、`edit`、`show`、`rm`、`export`、`import`、`hook`。詳しくは`agboard --help`または`agboard <command> --help`を実行してください。`--json`で機械処理向けの出力になります。

`agboard --help`と[Agent Skills](integrations/README.md)にも同じ進め方を記載しています。

</details>

<details>
<summary><strong>エージェントの作業手順</strong></summary>

```text
agboard snapshot --json                    # ボードと全履歴を読む
agboard mv <id> doing --actor ai --reason "<理由>"
agboard state <id> running --actor ai --reason "<理由>"
agboard state <id> pending --actor ai --reason "<必要な判断>"
agboard state <id> idle --actor human --request <id> --reason "<回答・方針>"
agboard state <id> running --actor ai --reason "<回答を踏まえた進め方>"
agboard mv <id> done --actor ai --reason "<完了した内容>"
```

状態を変更するときはactorとreasonを必ず指定します。進められる作業がない場合は、定期取得せず変更通知を待ちます。

</details>

<details>
<summary><strong>表示言語</strong></summary>

Web画面は英語で開きます。ヘッダーの地球ボタンからEnglishまたは日本語を選べます。選択した言語はブラウザに保存されます。ブラウザやOSの言語設定からは自動選択しません。CLI、helpとエラーメッセージ、APIとJSONの値は英語です。入力したカード内容は翻訳されません。

</details>
