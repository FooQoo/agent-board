---
title: エピックと進行表
---

# エピックと進行表

## エピックで作業をまとめる

```sh
agboard --project "My project" epic add launch --name "Website launch" --actor ai
agboard --project "My project" epic ls --json
agboard --project "My project" epic show LAUNCH --json
agboard --project "My project" epic edit LAUNCH --plan-file plan.md
agboard --project "My project" edit 1 --epic LAUNCH
agboard --project "My project" add "Prepare the preview" --assignee ai --actor ai --epic LAUNCH
agboard --project "My project" edit 1 --clear-epic
```

エピックIDには英字・数字・ハイフンを使います。小文字で入力すると大文字に正規化されます。計画は自由なMarkdownで、受け入れ条件と優先順位のfrontmatterは任意です。見出しは必須ではありません。名前や色を変えるには、`epic edit`に`--name`または`--color '#7C3AED'`を付けます。カードが属せるエピックは1つまでです。

エピックのタスクの順序はCLIで保存できます。

```sh
agboard --project "My project" epic edit LAUNCH --priority "3,1,2"
```

これで`PLAN.md`に`priority: [3, 1, 2]`が書かれます。要素は重複しない正のカードIDで、現在そのエピックに属するものだけが残ります。列挙されなかったメンバーは、IDの昇順で後に続きます。明示した順序を消すには`--priority ""`を渡します。エピックのダイアログの進行表には確認用に完了したタスクも含まれますが、CLIの進行表には含まれません。

## ブラウザでエピックを編集する

ラベルからエピックを開くと、名前、色、計画、受け入れ条件、タスクの順序を編集できます。右の列は、進行表を開き、添付を畳んだ状態で始まります。どちらかのパネルを開くと、もう一方は畳まれます。進行表の一覧は独立してスクロールするため、長い一覧もダイアログの中に収まります。タスクはハンドルをドラッグするか、ハンドルのキーボード操作で動かし、保存で順序を反映します。タスクを選ぶと詳細が開きます。所属の変更は、エピックのダイアログのチェックボックスではなく、カードエディターかCLIで行います。カードが属せるエピックは1つまでです。エピックのダイアログには下書きのチェックボックスがなく、エピックの既存の下書きの状態は保たれます。

![タスクの進行表と、下部に畳まれた受け入れ条件を持つエピック編集画面](../../images/epic.ja.png){.screenshot}

エピックの編集画面は、左に目次、中央に名前と計画、右にラベル、タスクの進行表、添付を表示します。受け入れ条件は、開くまで下部に畳まれています。

## 進行表を読む

```sh
agboard progress
agboard progress --json
agboard --project "My project" progress --json
```

進行表は、未着手と進行中のカードをエピックごとにまとめ、エピックのない作業は別のグループにします。完了、アーカイブ済み、待機中のカードは含まれません。待機中の質問は回答されるまでボードに残ります。確認には`show`か`snapshot`を使います。ユーザー担当のカードと下書きは、文脈のために進行表に残りますが、エージェントは作業を選ぶときに飛ばします。

各項目には、カードID、タイトル、担当、列、エージェントの状態、受け入れ条件の件数、`taskPath`が含まれます。エピックの項目には`planPath`が含まれます。本文、履歴、画像のバイト列は含まれないため、選んだ作業に必要なファイルだけを読みます。Hookも同じ進行表を渡します。

エピックはIDの順に並びます。エピック内では、`PLAN.md`の`priority`リストがタスクの順序を決め、列挙されていないIDはカードIDの昇順で続きます。エピックのない作業もカードIDで並びます。この順序は、列内の位置とは無関係です。カードが1つも列挙されないエピックは含まれません。
