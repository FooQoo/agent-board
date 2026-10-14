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

`--assignee`は担当を、`--actor`は変更した人を記録します。ユーザーは`human`、エージェントは`ai`を使います。`snapshot`は、エピックやファイルの問題を含む、ボード全体と履歴を返します。

## 作業を報告する

作業の開始を報告します。

```sh
agboard --project "My project" mv 1 doing --actor ai --reason "Start implementation"
agboard --project "My project" state 1 running --actor ai --reason "Writing and checking the guide"
```

完了させるには、`TASK.md`に検証結果を記録し、検証した受け入れ条件の`done`を`true`にします。サーバーが動いていれば、対象のAIカードは自動で完了へ移るので、`mv ... done --actor ai`は実行しません。形式と対象の条件は[共有Markdownファイル](./editing#共有markdownファイルを編集する)を参照してください。完了のカードはエージェントから読み取り専用です。タスクの編集、レーンや状態の変更、添付ファイルや証跡の追加はできません。作業が増えたときは、ユーザーがカードを再開できます。

判断の依頼(`state ... pending`)は[判断依頼](./decisions)、エピックと進行表は[エピックと進行表](./epics)を参照してください。

## 長い文章をファイルから編集する

長いMarkdownは、コマンドラインの文字列ではなくファイルで渡します。

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

説明とエピックの計画は50,000文字まで使えます。ファイルは必須の[Markdown形式](./editing#共有markdownファイルを編集する)に従う必要があります。説明を標準入力から読むには`--desc -`を使います。

カードの`edit --desc-file`は本文と受け入れ条件を更新し、`TASK.md`の最新の操作履歴を保持します。入力ファイルから履歴を変更することはできません。CLIや画面でカードを操作すると履歴が`TASK.md`へ追記され、`show`・`snapshot`と画面は同じ履歴を読みます。

## 絞り込んで一覧する

カードを絞り込んだり、全プロジェクトを確認したりします。

```sh
agboard --project "My project" ls --column doing --json
agboard --project "My project" ls --state pending --json
agboard ls --all-projects --json
```

`ls --all-projects`は、全プロジェクトをプロジェクト名順に一貫して読み取り、カードの説明全文と履歴を含めます。`--column`と`--state`の絞り込みは全プロジェクトに適用されます。`--project`とは併用しないでください。

## 出力と確認

機械で読む出力には`--json`を付けます。コマンドのオプションの全体は`agboard --help`または`agboard <command> --help`で確認できます。helpの文章、エラー、JSONの値は、ブラウザの表示言語にかかわらず常に英語です。

カード、エピック、証跡、プロジェクトの削除には人間の確認が必要です。エージェントはユーザーに実行を依頼してください。
