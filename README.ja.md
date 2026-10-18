<div align="center">

<img src="web/public/logo.png" alt="Agent Boardのロゴ" width="120">

# Agent Board

**ユーザーとAIが一緒に作業を進める共有ボード。**

AIが作業と進捗を登録し、ユーザーは同じボードで状態を確認したり、質問に回答したりできます。

[English](README.md) · [使い方](https://fooqoo.github.io/agent-board/ja/guide/) · [開発に参加する](CONTRIBUTING.ja.md) · [GitHubリポジトリ](https://github.com/FooQoo/agent-board)

![ローカル完結](https://img.shields.io/badge/data-local%20only-1f6feb)
![通常のファイル](https://img.shields.io/badge/storage-plain%20files-1f6feb)
![macOS と Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1f6feb)

<img src="docs/images/board.ja.png" alt="タスク内の回答欄、受入条件の達成数、詳細の4タブを表示した現在のPCボード" width="860">

</div>

## Agent Boardとは

エージェントに長時間の作業を任せると、進捗や、回答を待っている質問を把握しにくくなります。Agent Boardでは、ユーザーとエージェントが同じボードと履歴を確認しながら、質問・回答・作業の再開を繰り返して進められます。

```mermaid
flowchart LR
    A["AIエージェント"] -- "agboard CLI・Hook" --> D[("ローカルの共有フォルダ")]
    U["ユーザー"] -- "Agent Board UI" --> D
    D -- "ローカルサーバー" --> B["ブラウザ"]
```

## 特徴

**1. 人とAIが同じボードで作業を進める。** Todo・Doing・Doneの3列で進捗を管理し、稼働中・待機中の状態でAIの動きを確認できます。PCやスマホから、タスクに表示された質問へ回答でき、判断と状態変更の理由が履歴に残ります。

**2. 一つのAIセッションでタスクを順番に進める。** エピックでタスクの進行順を決め、`agboard progress`で今進められる作業と計画・タスクのファイルパスを取得できます。`agboard --project "My project" wait --until task --idle-timeout 300 --json`で、次の対象タスクを明示的に待ち受けられます。一件を処理してから同じセッションで次を待ち、リッスン前からTodoにあるタスクに加え、agentStatusがIdleのままDoingにあるAIタスクも対象です。指定した待機時間に対象がなければ正常終了します。作業フォルダからのプロジェクト選択とHookで必要な情報を渡し、自動完了の対象となるAI担当タスクは、すべての受入条件を満たすとDoneの列へ移ります。完了した作業はAIから変更できません。

**3. 計画・結果・証跡をローカルのMarkdownで管理する。** エピックの計画は`PLAN.md`、タスクは`TASK.md`に保存し、画像や証跡も同じフォルダで管理します。データはすべてローカルにあり、アカウントやクラウドサービスは不要です。

タスクの計画と検証結果は`TASK.md`の本文に、受入条件と履歴はfrontmatterに保存します。現在の状態などのメタデータは`task.json`で管理します。履歴の各項目は、日時の`at`と内容の`reason`だけです。AIが自動で記録した進捗も、画面やCLIからの操作も同じ履歴に残ります。操作理由は任意で、空欄の場合は現在の状態に応じた文言をAgent Boardが生成します。

編集・画像添付・アーカイブ・設定の詳細は[使い方ガイド](https://fooqoo.github.io/agent-board/ja/guide/)を参照してください。

<details>
<summary>エピックの進行表とモバイルの画面を見る</summary>

<img src="docs/images/epic.ja.png" alt="タスクの進行表とMarkdown本文を持つエピック編集画面" width="860">

<img src="docs/images/mobile.ja.png" alt="本文・受入条件・履歴・エピックの4タブを持つモバイルの下部ドロワー" width="300">

</details>

## インストール

Git、Rust（edition 2024に対応したCargoを含む）、Node.js、pnpmを使い、ソースからビルドします。

```sh
git clone https://github.com/FooQoo/agent-board.git
cd agent-board
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
```

`~/.cargo/bin`（または`$CARGO_HOME/bin`）を`PATH`に追加してください。`agboard`はWeb画面を含むため、先にWeb画面をビルドします。更新や導入確認は[使い方ガイド](https://fooqoo.github.io/agent-board/ja/guide/getting-started)を参照してください。

## 使い始める

```sh
agboard project create "My project"
agboard serve --port 7420
```

[http://127.0.0.1:7420/](http://127.0.0.1:7420/)を開き、プロジェクトを選んでタスクを追加します。`agboard progress`とHookはカレントフォルダに最も近い登録済みプロジェクトを使います。別プロジェクトを対象にする場合は`--project NAME`で指定します。

## ドキュメント

- [使い方ガイド](https://fooqoo.github.io/agent-board/ja/guide/) — ブラウザ操作、CLIの例、エージェントの作業手順、共有ファイル、バックアップ。
- [モバイルモニター](https://fooqoo.github.io/agent-board/ja/guide/operations/mobile-monitor) — LAN・Tailscale接続、HTTPS、スマホの証明書設定。
- [Claude Code・Codexとの連携（英語）](integrations/README.md) — Hookとエージェントの設定。
- [開発に参加する](CONTRIBUTING.ja.md) — 開発と検証。
