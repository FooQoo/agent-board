---
title: クイックスタート
---

# クイックスタート

約10分で、タスクの作成・着手・質問・回答・自動完了までを試します。エージェントが行う操作も、自分で`agboard`コマンドを実行して確かめるため、AIエージェントとの連携設定はまだ必要ありません。

インストール済みであることが前提です。`agboard`をインストールしていなければ、[インストールと起動](./getting-started)から始めてください。

自分のボードに触れずに試すには、以下で使うすべてのターミナルで、先に`export AGBOARD_HOME="$(mktemp -d)"`を実行します。普段のボードで試す場合、この設定は不要です。

## 始める前に: 初回の案内

このデータ領域でボードを初めて開くと、Agent Board は短い案内を表示します。**ガイドを始める** を選ぶと、AI エージェントがカードをどう進め、どこであなたに判断を求めるかを確かめられます。案内は 2 枚のサンプルカードを作り、その上で AI の進みを模擬します。AI エージェントや API キーは要りません。2 枚目の質問には、カード上で回答します。最後まで進めると、サンプル 2 枚はアーカイブされます。

- **スキップ** は、何も作らずに案内を閉じます。このデータ領域では、案内は再び表示されません。
- **ガイドを終了** を選ぶか Escape を押すと、途中で案内を終えます。ただし、回答欄に入力している間の Escape は何もしません。そのときのサンプル 2 枚はアーカイブされます。次にボードを開くと、新しい 2 枚で案内が表示されます。

最後まで進めた案内やスキップした案内は、このデータ領域では自動で再表示されません。もう一度見るには、設定を開き、**チュートリアルを試す** を選びます。いま開いているプロジェクトで案内が始まり、サンプルカードを 2 枚作ります。最後まで進めるか途中で終えると、サンプルはアーカイブされます。

## 1. ボードを起動する

```sh
agboard project create "Quickstart"
agboard serve --port 7420
```

サーバーを起動したまま、[http://127.0.0.1:7420/](http://127.0.0.1:7420/)を開きます。ヘッダーで**Quickstart**を選びます。作成直後のボードにはタスクがありません。ここからのコマンドは、別のターミナルで実行します。

## 2. 自分でタスクを追加する

ブラウザで**タスク追加**を選び、依頼フォームで**手動で作成**を選びます。タイトルに`Write the setup guide`と入力し、担当は**ユーザー**のままにして、追加します。未着手の列にタスク#1が追加されます。

## 3. エージェントにタスクを渡す

受入条件を一つ持つファイル`task.md`を作ります。

```markdown
---
acceptance:
  - id: AC-1
    text: The install steps work on a clean machine.
    done: false
history: []
---

Walk through the install steps and note anything that is unclear.
```

AI担当のタスクとして追加します。

```sh
agboard --project "Quickstart" add "Check the install steps" --assignee ai --actor ai --desc-file task.md
```

コマンドが新しいタスクのIDを表示します。ここではタスクIDを`#2`として説明します。未着手の列に、AIのアイコンと受入条件の達成数`0/1`が付いたタスクが追加されます。

## 4. エージェント役: 作業を始める

エージェントは、タスクを進行中に移し、稼働中だと報告して作業を始めます。

```sh
agboard --project "Quickstart" mv 2 doing --actor ai --reason "Start checking the install steps"
agboard --project "Quickstart" state 2 running --actor ai --reason "Following the install page"
agboard --project "Quickstart" history add 2 --reason "Built the web UI and installed agboard without errors"
```

ブラウザでは、タスク#2が進行中に移り、**稼働中**と表示されます。選んで**履歴**タブを開くと、各操作が日時と理由とともに並んでいます。

## 5. 質問して回答する

エージェントは、判断が必要になると、選択肢つきで質問します。

```sh
agboard --project "Quickstart" state 2 pending --actor ai --request-json '{"question":"Should the guide also cover Windows?","choices":[{"id":"yes","label":"Yes, include Windows"},{"id":"no","label":"No, macOS only"}]}'
```

このコマンドは既定で回答まで待つため、`agboard serve`を起動しておきます。タスク#2が**待機中**になり、質問と2つの選択肢が表示されます。ブラウザで選択肢を選び、必要ならメモを書いて、回答を送ります。コマンドは回答を受け取って戻り、タスクは**未稼働**に戻ります。

エージェントは、タスクの履歴で回答を読んで、作業を再開します。

```sh
agboard --project "Quickstart" show 2
agboard --project "Quickstart" state 2 running --actor ai --reason "Windows is not needed; continuing with macOS"
```

## 6. 受入条件を満たして完了する

エージェントは受入条件を検証し、結果を記録してから達成済みにします。ここでは、元のファイルをコピーして`done: true`に書き換え、タスクへ反映します。

```sh
agboard --project "Quickstart" history add 2 --reason "Verified the install steps on a clean machine"
sed 's/done: false/done: true/' task.md > task-done.md
agboard --project "Quickstart" edit 2 --desc-file task-done.md
```

サーバーが動いていれば、タスク#2は自動で完了に移ります。完了の列へ手動で移す必要はありません。自動完了は、下書きではないAI担当のタスクが対象です。ユーザー担当のタスク#1は、未着手の列に残ります。

## 7. 片付ける

サーバーのターミナルでCtrl+Cを押します。一時的な`AGBOARD_HOME`を使ったなら、ほかにすることはありません。そうでなければ、練習用のプロジェクトを削除します（あなたの確認を求め、エージェントは実行できません）。

```sh
agboard --project "Quickstart" project rm
```

## ここで確認したこと

- タスクは**未着手 → 進行中 → 完了**と進み、エージェントは**未稼働**・**稼働中**・**待機中**を報告します。
- すべての変更が、理由つきでタスクの履歴に記録されます。
- エージェントは**待機中**で質問し、あなたがタスク上で回答します。
- すべての受入条件が達成されると、AI担当のタスクは自動で完了します。

## 次に読む

- [基本の考え方](./concepts): 今回の操作に関係する概念を確認します。
- [エージェントとの連携](./automation/agents): AIエージェントと連携し、ここで試した操作を任せます。
- [ボード](./use/board): ブラウザでの操作を詳しく説明します。
