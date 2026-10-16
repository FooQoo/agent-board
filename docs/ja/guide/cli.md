---
title: CLIリファレンス
---

# CLIリファレンス

ブラウザは作業の確認と編集に、`agboard`はエージェントによる更新とプロジェクトの管理に使います。ほとんどのコマンドは`--project NAME`を明示します。例では`My project`を使っているので、実際のプロジェクト名とCLIが返すIDに置き換えてください。

## カードを追加して確認する

カードを追加し、ボードを確認します。

```sh
agboard --project "My project" add "Write the setup guide" --assignee ai --actor ai
agboard --project "My project" ls --json
agboard --project "My project" show 1 --json
agboard --project "My project" snapshot --json
```

`--assignee`は担当を、`--actor`は操作する人を指定し、権限を判定します。ユーザーは`human`、エージェントは`ai`を使います。`snapshot`は、エピックやファイルの問題を含む、ボード全体と履歴を返します。

## 作業を報告する

作業の開始を報告します。

```sh
agboard --project "My project" mv 1 doing --actor ai --reason "Start implementation"
agboard --project "My project" state 1 running --actor ai --reason "Writing and checking the guide"
```

列の移動と待機中以外への状態変更では`--reason`は任意で、Unicode文字数で10,000文字までです。質問と回答文の上限は別に2,000文字のままです。省略または空白の場合は現在の状態に応じて理由を生成します。これらの操作は履歴を自動追記するため、同じ変更を別途記録しないでください。

列や状態を変えずに意味のある進捗を記録するには、次を使います。

```sh
agboard --project "My project" history add 1 --reason "Checked the installation links and saved the build output as evidence"
agboard --project "My project" history add 1 --reason-file progress.txt
```

CLIが日時を付け、AIの書き込み権限を判定します。actor、イベントID、kind、日時の引数は不要です。AIは実際の作業と検証に基づく簡潔な内容を、意味のある進捗、判断、検証、中断、再開のタイミングで自動記録します。理由の省略や空白は状態に応じた既定文になります。AIは下書き・アーカイブ済み・完了カードへ履歴を追記できません。履歴は`TASK.md`のfrontmatterとAPI・CLI出力で`at`と`reason`だけを持ち、本文や`task.json`には保存しません。

完了させるには、`TASK.md`に検証結果を記録し、検証した受入条件の`done`を`true`にします。サーバーが動いていれば、対象のAIカードは自動で完了へ移るので、`mv ... done --actor ai`は実行しません。形式と対象の条件は[共有Markdownファイル](./editing#共有markdownファイルを編集する)を参照してください。完了のカードはエージェントから読み取り専用です。タスクの編集、レーンや状態の変更、添付ファイルや証跡の追加はできません。作業が増えたときは、ユーザーがカードを再開できます。

判断の依頼(`state ... pending`)は[判断依頼](./decisions)、エピックと進行表は[エピックと進行表](./epics)を参照してください。

## 長い文章をファイルから編集する

長いMarkdownは、コマンドラインの文字列ではなくファイルで渡します。

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

説明とエピックの計画は50,000文字まで使えます。ファイルは必須の[Markdown形式](./editing#共有markdownファイルを編集する)に従う必要があります。説明を標準入力から読むには`--desc -`を使います。

カードの`edit --desc-file`は本文と受入条件を更新し、`TASK.md`の最新の操作履歴を保持します。入力ファイルから履歴を変更することはできません。CLIや画面でカードを操作すると履歴が`TASK.md`へ追記され、`show`・`snapshot`と画面は同じ履歴を読みます。

## 絞り込んで一覧する

カードを絞り込んだり、全プロジェクトを確認したりします。

```sh
agboard --project "My project" ls --column doing --json
agboard --project "My project" ls --state pending --json
agboard ls --all-projects --json
```

`ls --all-projects`は、全プロジェクトをプロジェクト名順に一貫して読み取り、カードの説明全文と履歴を含めます。`--column`と`--state`の絞り込みは全プロジェクトに適用されます。`--project`とは併用しないでください。

## 共有フォルダをセットアップする

`agboard setup`は、データフォルダと`shared/`フォルダを作成し、CodexとClaude Codeのユーザー設定にデータフォルダを追加して、エージェントがそこへ書き込めるようにします。プロジェクトは不要で、実行するのはあなたです。フックやエージェントのスキルは登録しません。

```sh
agboard setup --dry-run
agboard setup --agent claude --json
```

`--agent codex|claude|all`で更新する設定を選びます(既定は`all`)。`--dry-run`は何も変更せず、`--json`は機械で読める出力を表示します。`sandbox_mode = "workspace-write"`でないCodexの設定は拒否され、拒否したときは何も変更しません。変更内容、バックアップ、既存のボードの移行については、[データとバックアップ](./data#共有フォルダをセットアップする)を参照してください。

## 出力と確認

機械で読む出力には`--json`を付けます。コマンドのオプションの全体は`agboard --help`または`agboard <command> --help`で確認できます。helpの文章、エラー、JSONの値は、ブラウザの表示言語にかかわらず常に英語です。

カード、エピック、証跡、プロジェクトの削除には人間の確認が必要です。エージェントはユーザーに実行を依頼してください。
