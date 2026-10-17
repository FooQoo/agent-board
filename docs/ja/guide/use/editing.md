---
title: 編集と証跡
---

# 編集と証跡

タスクとエピックは、Markdownのエディターで書きます。タスクの完了条件は本文の下のパネルにあり、タスクには画像とテキストの証跡を添付できます。エージェントも、共有フォルダに保存された同じファイルを編集します。このページはエディター・画像・証跡を扱い、ファイルの形式は[Markdownファイルの形式](../automation/file-format)にあります。

## エディターでタスクと計画を書く

![目次、Mermaid図、タスクリストを含み、受入条件パネルを開いたタスク編集画面](../../../images/guide/editor.ja.png){.screenshot}

エディターは、左に目次、中央にMarkdown本文、右にエピックと画像の添付を表示します。

- **書式:** 見出し、タスクリスト、表、コードブロック、Mermaid図、画像に対応しています。画像や図をクリックすると拡大します。
- **目次:** 目次から、本文の見出しへ移動したり、条件のパネルを開いたりできます。
- **保存:** ダイアログの変更は、まとめて保存するか、取り消します。完了条件にチェックを入れる前に、検証を記録してください。
- **受入条件:** タスクを作成・編集するとき、受入条件は本文の下のパネルにあり、最初は折りたたまれています。開いて編集します。長い一覧はパネルの中でスクロールします。条件には固定のIDがあり、並べ替えられません。既存のタスクの条件を読むには、**受入条件**タブを使います。エピックには専用の条件パネルがありません。参考となる完了条件は、計画の本文にMarkdownで記述します。

エピックのダイアログ（名前・色・計画・タスクの順序）は[エピックと進行表](./epics)、下書きは[ボード](./board#下書き)を参照してください。

## 画像を追加する

ブラウザのエディターで、画像を選ぶ、ドロップする、貼り付けるのいずれかを行い、本文に挿入します。画像はPNG・JPEG・WebP・GIFで、1件10 MiBまで、タスクごとに20件・合計50 MiBまでです。

コマンドラインでは次のようにします。

```sh
agboard --project "My project" attachment add 1 --file diagram.png --actor ai
agboard --project "My project" attachment ls 1 --json
agboard --project "My project" attachment get 1 "<attachment-id>" --output diagram-copy.png
```

画像は、Markdownでは`attachment:<attachment-id>`として参照し、画像データはローカルのファイルに保存されます。スナップショットには画像のメタデータが含まれ、進行表とHookには含まれません。`attachment get`は、既存の出力ファイルを上書きしません。

## 証跡を追加する

証跡は、テストの出力など、結果を裏づけるUTF-8のログやテキストです。追加時に返される証跡IDを使って、内容を確認できます。

```sh
agboard --project "My project" evidence add 1 test-output.log
agboard --project "My project" evidence show 1 "<evidence-id>"
```

読む人が見つけられるよう、証跡IDをタスクの本文に書いておきます。

## ファイルを直接編集する

ユーザーもエージェントも、タスクの`TASK.md`とエピックの`PLAN.md`を直接編集できます。保存すると、ボードが変更を検知して表示に反映します。場所を推測せず、プロジェクトのフォルダを調べます。

```sh
agboard --project "My project" workspace --json
```

結果には、`folder`（プロジェクトの絶対パス）、`projectId`、`readme`、`tasks`、`epics`が含まれます。まずプロジェクトの`README.md`を読みます。ボードが書きかけのファイルを読まないよう、同じフォルダに一時ファイルを書いて、元のファイルへ名前を変更して置き換えます（rename）。メタデータや状態の変更にはCLIを使い、`task.json`・`epic.json`・`project.json`・ロックのファイルは編集せず、タスクやエピックのフォルダを手で削除しません。共有ファイルに個人の絶対パスを書かないでください。

これらのファイルに必要な構造は、[Markdownファイルの形式](../automation/file-format)にあります。

## 次に読む

- [Markdownファイルの形式](../automation/file-format): frontmatter、履歴、自動完了。
- [CLIリファレンス](../automation/cli): すべてのコマンド。
