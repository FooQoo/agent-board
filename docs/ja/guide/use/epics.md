---
title: エピックと進行表
---

# エピックと進行表

エピックは、一つの計画に関連するタスクをまとめるものです。作業順序を決めておくと、エージェントが次に進めるタスクを選びやすくなります。このページでは、エピックの作成と順序づけ、ブラウザでの編集、エージェントが使う進行表の読み方を示します。

## タスクをエピックにまとめる

```sh
agboard --project "My project" epic add launch --name "Website launch" --actor ai
agboard --project "My project" epic ls --json
agboard --project "My project" epic show LAUNCH --json
agboard --project "My project" epic edit LAUNCH --plan-file plan.md
agboard --project "My project" edit 1 --epic LAUNCH
agboard --project "My project" add "Prepare the preview" --assignee ai --actor ai --epic LAUNCH
agboard --project "My project" edit 1 --clear-epic
```

- エピックIDには、英字・数字・ハイフンを使います。小文字で入力すると、大文字になります。
- 計画は自由なMarkdownで、frontmatterの`priority`は任意です。参考となる完了条件は、計画の本文に直接書きます。見出しは不要です。
- 名前や色を変えるには、`epic edit`に`--name`や`--color '#7C3AED'`を使います。
- タスクは、最大で一つのエピックに所属します。

## 作業の順序を決める

エピックのタスクの順序を、コマンドラインから保存します。

```sh
agboard --project "My project" epic edit LAUNCH --priority "3,1,2"
```

エピックの`PLAN.md`に`priority: [3, 1, 2]`が書かれます。エントリは重複しない正のタスクIDで、現在エピックに属するものだけが残ります。記載のない所属タスクは、IDの昇順で後に続きます。明示した順序を消すには、`--priority ""`を渡します。順序は、ボード上のタスクの位置とは独立です。

## ブラウザでエピックを編集する

エピックのラベルから開くと、名前・色・計画・タスクの順序を編集できます。

![タスクの進行表とMarkdown本文を持つエピック編集画面](../../../images/epic.ja.png){.screenshot}

エピック編集画面は、左に目次、中央に名前と計画、右にラベル・タスクの進行表・添付を表示します。参考となる完了条件は計画の本文に直接書き、専用の条件パネルはありません。

- 右側のパネルでは、初めは進行表が開き、添付欄は折りたたまれています。どちらかを開くと、もう一方が折りたたまれます。
- 進行表は単独でスクロールするので、長い一覧もダイアログの中に収まり、完了したタスクも確認できます。
- タスクをハンドルでドラッグするか、ハンドルのキーボード操作で動かし、**保存**で順序を反映します。
- タスクを選ぶと詳細が開きます。所属の変更は、エピックのダイアログではなく、タスクのエディターかコマンドラインで行います。エピックのダイアログには下書きのチェックボックスがなく、エピックの下書きの状態は変わりません。

## 進行表を読む

```sh
agboard progress
agboard progress --json
agboard --project "My project" progress --json
```

進行表は、エージェントが次のタスクを選ぶために読む表です。未着手と進行中のタスクを、エピックごとにまとめ、エピックに所属しないタスクは別のグループにまとめます。完了・アーカイブ済み・待機中のタスクは含みません。待機中の質問は回答されるまでボードに残り、`show`や`snapshot`で見られます。ユーザー担当のタスクと下書きは、状況を知るために表に残りますが、エージェントはそれらを作業対象に選びません。

各項目には、タスクID、タイトル、担当、列、エージェントの状態、受入条件の件数、`TASK.md`のパスが並びます。エピックの項目には`PLAN.md`のパスも含みます。本文・履歴・画像は含まれず、エージェントは選んだ作業に必要なファイルだけを読みます。Hookは、エージェントにこの同じ表を渡します。

エピックはIDの昇順に並びます。エピック内のタスクの順序は`priority`で決まり、記載のないタスクはIDの昇順で後に続きます。エピックのない作業もIDで並べます。表に載るタスクのないエピックは含まれません。

## 次に読む

- [エージェントとの連携](../automation/agents): エージェントが表をどう使うか。
- [Markdownファイルの形式](../automation/file-format): `PLAN.md`の構造と`priority`の書き方。
