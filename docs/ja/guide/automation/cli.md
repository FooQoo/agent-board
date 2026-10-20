---
title: CLIリファレンス
---

# CLIリファレンス

ブラウザは作業の確認と編集に、`agboard`はエージェントの更新とプロジェクトの管理に使います。ほとんどのコマンドは、`--project NAME`を明示します。例は`My project`を使っているので、自分のプロジェクト名に置き換え、CLIが返すタスクIDを使ってください。各オプションは`agboard --help`か`agboard <command> --help`で確認できます。

## コマンドの一覧

| したいこと | コマンド |
| --- | --- |
| タスクを追加する | `add` |
| タスクやボードを読む | `show`、`ls`、`snapshot` |
| タスクを移す、エージェントの状態を報告する | `mv`、`state` |
| 進捗を記録する | `history add` |
| タスクの本文を編集する | `edit` |
| 画像を添付する | `attachment` |
| タスクをまとめて順序づける | `epic`、`progress` |
| 変更を待つ | `wait` |
| プロジェクトとフォルダを管理する | `project`、`workspace` |
| サーバーを起動し、エージェント連携を設定する | `serve`、`setup`、`hook` |
| 削除する（人だけ） | `rm`、`project rm`、`epic rm`、`init` |

## タスクを追加して確認する

タスクを追加して、ボードを確認します。

```sh
agboard --project "My project" add "Write the setup guide" --assignee ai --actor ai
agboard --project "My project" ls --json
agboard --project "My project" show 1 --json
agboard --project "My project" snapshot --json
```

`--assignee`は担当を指します。`--actor`は変更を行う主体を指し、権限を決めます。人には`human`、エージェントには`ai`を使います。`snapshot`は、エピックとファイルの問題を含む、ボード全体と履歴を返します。

## 作業を報告する

作業の開始を報告します。

```sh
agboard --project "My project" mv 1 doing --actor ai --reason "Start implementation"
agboard --project "My project" state 1 running --actor ai --reason "Writing and checking the guide"
```

列の移動や、待機中以外への状態変更では、`--reason`で理由を指定できます。指定は任意で、上限は10,000 Unicode文字です。理由を省略するか空白にすると、現在の状態から生成します。これらの操作は履歴を自動で追加するので、同じ操作の履歴を重複して追加しないでください。質問と回答の文には、2,000文字という別の上限があります。

列や状態を変えない、意味のある進捗を記録します。

```sh
agboard --project "My project" history add 1 --reason "Checked the installation links and recorded the result in the task body"
agboard --project "My project" history add 1 --reason-file progress.txt
```

コマンドが時刻を付け、AIの書き込み権限を適用します。actor・イベントID・種別・時刻の指定は要りません。意味のある進捗、判断、検証、中断、再開のときに、実際の作業と検証に基づく簡潔な理由を書きます。理由を省略するか空白にすると、状態に合った既定の文を生成します。AIは、下書き・アーカイブ済み・完了のタスクに履歴を追加できません。

### タスクを終える

終えるには、`TASK.md`に検証を記録し、検証した受入条件の`done`を`true`にします。サーバーが動いていれば、対象のAI担当タスクを自動で完了に移すので、`mv ... done --actor ai`は実行しません。規則は[Markdownファイルの形式](./file-format)を参照してください。完了したタスクはエージェントから読み取り専用で、作業が必要になったら、ユーザーが再開できます。

### 質問する

判断を求めるには、`state ... pending`に`--request-json`を付けます。[判断依頼](../use/decisions)を参照してください。エピックと進行表は[エピックと進行表](../use/epics)を参照してください。

## ファイルを使って本文を編集する

長いMarkdown本文は、ファイルに書いてから読み込ませると編集しやすくなります。

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

説明とエピックの詳細（`EPIC.md`）は、50,000文字まで使えます。ファイルは[Markdownファイルの形式](./file-format)に従う必要があります。標準入力から説明を読むには、`--desc -`を使います。

`edit --desc-file`は、本文と受入条件を置き換え、`TASK.md`の最新の履歴を保ちます。入力ファイルの履歴は無視されます。CLIや画面からの移動・状態の変更などの操作は、`TASK.md`に履歴を追加し、`show`・`snapshot`・ブラウザは同じ履歴を読みます。

## エピックの詳細を編集する

エピックの詳細は、frontmatterを含む`EPIC.md`の全文です。文字列で直接渡すか、ファイルや標準入力から読み込みます。

```sh
agboard --project "My project" epic edit LAUNCH --document-file epic.md
agboard --project "My project" epic edit LAUNCH --document -
agboard --project "My project" epic edit LAUNCH --priority "3,1,2"
```

`--document`と`--document-file`は同時に指定できません。どちらも50,000文字まで受け付けます。以前の`--plan`と`--plan-file`は削除されました。新しい名前は[データとバックアップ](../operations/data)の移行の節を参照してください。

## 一覧を絞り込む

```sh
agboard --project "My project" ls --column doing --json
agboard --project "My project" ls --state pending --json
agboard ls --all-projects --json
```

`ls --all-projects`は、全プロジェクトを名前順に読み、タスクの説明と履歴を完全な形で返します。`--column`と`--state`の絞り込みはすべてのプロジェクトに適用されます。`--project`とは組み合わせません。

## プロジェクト

```sh
agboard project create "My project"
agboard project ls --json
agboard --project "My project" project rename "Website launch"
agboard project bind "My project" --folder ./docs
```

名前を変えても、プロジェクトのID・フォルダの登録・タスクは保たれます。フォルダの登録とプロジェクトの削除は、[データとバックアップ](../operations/data#プロジェクトとフォルダ)に説明があります。

## 変更またはタスクを待つ

`wait`には二つのモードがあります。`--after <cursor>`は[エージェントとの連携](./agents#変更を待つ)のとおりプロジェクトの変更を待ちます。`--until task`は、リッスン開始前からTodoにあったタスクや、IdleのままDoingにあるタスクも含め、対象となるAI担当タスクを一件返します。

```sh
agboard --project "My project" wait --until task --idle-timeout 300 --json
```

`--until task`には`--idle-timeout`が必須です。1〜86,400秒を指定し、既定値はありません。一回の呼び出しで返すのは進行表と同じ順序の一件で、タスクを占有したり変更したりしません。取得したタスクを解決したら、再び`wait`を呼び出します。セッション全体の流れとPendingの扱いは[エージェントとの連携](./agents#次のタスクを待つ)を参照してください。

取得成功時は、一つのJSONオブジェクトを出力して終了コード0を返します。

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","documentPath":null}
```

指定した時間に対象タスクがなかった場合は、`{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}`を出力して終了コード0を返します。これは対象なしでの正常終了であり、それまでの作業成功を示しません。`board_unavailable`・`project_not_found`・不正なボードデータ・引数誤りは、引き続き終了コード0以外のエラーです。`--timeout`は`--after`モードだけに指定でき、変更待ちが成立しなければエラー`wait_timeout`になります。Pendingの質問への回答にはなりません。

## 共有フォルダをセットアップする

`agboard setup`は、データフォルダとその`shared/`フォルダを作り、エージェントがそこへ書けるよう、CodexとClaude Codeのユーザー設定にデータフォルダを加えます。プロジェクトは要らず、あなた自身が実行します。Hookやエージェントのスキルはインストールしません。

```sh
agboard setup --dry-run
agboard setup --agent claude --json
```

`--agent codex|claude|all`で更新する設定を選びます（既定は`all`）。`--dry-run`は何も変更せず、`--json`は機械可読の出力を表示します。Codexの設定が`sandbox_mode = "workspace-write"`でないときは、拒否して何も変更しません。変更内容と設定ファイルのバックアップは[データとバックアップ](../operations/data#共有フォルダをセットアップする)を参照してください。

## 出力と確認

JSON形式の出力が必要なときは`--json`を付けます。helpのテキスト・エラー・JSONの値は、ブラウザの言語に関わらず、常に英語です。

タスク・エピック・プロジェクトの削除と、`init`によるプロジェクトの初期化には、端末での人の確認が必要です。エージェントは、人に頼まなければなりません。

## 次に読む

- [エージェントとの連携](./agents): 各コマンドを使う場面と、作業全体の流れ。
- [トラブルシューティング](../operations/troubleshooting): エラーコードの意味。
