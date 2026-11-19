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
| ボードをブラウザーで開く | `open` |
| スマホ用のアドレスと合言葉を確認する | `remote` |
| サーバーとHookを動かす | `serve`、`stop`、`hook` |
| Agent Boardプラグインを導入・更新する | `setup`、`update` |
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

列の移動や状態の変更では、`--reason`で理由を指定できます。指定は任意で、上限は10,000 Unicode文字です。理由を省略するか空白にすると、現在の状態から生成します。これらの操作は履歴を自動で追加するので、同じ操作の履歴を重複して追加しないでください。質問は5,000文字まで、回答のメモは2,000文字までです。

列や状態を変えない、意味のある進捗を記録します。

```sh
agboard --project "My project" history add 1 --reason "Checked the installation links and recorded the result in the task body"
agboard --project "My project" history add 1 --reason-file progress.txt
```

コマンドが時刻を付け、AIの書き込み権限を適用します。actor・イベントID・種別・時刻の指定は要りません。意味のある進捗、判断、検証、中断、再開のときに、実際の作業と検証に基づく簡潔な理由を書きます。理由を省略するか空白にすると、状態に合った既定の文を生成します。AIは、下書き・アーカイブ済み・完了のタスクに履歴を追加できません。

### タスクを終える

終えるには、`TASK.md`に検証を記録し、検証した完了条件の`done`を`true`にします。サーバーが対象のAI担当タスクを自動で完了に移すので（サーバーはHookや待つコマンドが必要なときに起動します）、`mv ... done --actor ai`は実行しません。規則は[Markdownファイルの形式](./file-format)を参照してください。完了したタスクはエージェントから読み取り専用で、作業が必要になったら、ユーザーが再開できます。

### 質問する

ユーザーに質問するには`message ask`を使います。1回で最大20件の質問を出せます。質問は1件ずつ`Q-12`のようなIDを持つメッセージで、プロジェクトに属し、`--task <id>`を付けるとそのタスクが質問を参照して、回答されるまで待機中になります。コマンドは1行に1つのイベントを出力し（`--json`ならJSON Lines）、未回答の質問がなくなるまで待ちます。既定の待機時間は600秒です。

```sh
agboard --project "My project" message ask --actor ai --task 1 --questions-json - --json < questions.json
```

`answered`（終了コード0）、`timeout`（終了コード5。質問は未回答のまま残る）、`withdrawn`（終了コード6）のいずれかで終わります。待ち直すには`message wait Q-12 Q-13`を使います。待機にはサーバーが必要です。動いていなければ、質問を保存する前にコマンドが裏で起動します。`--no-wait`を付けると、質問を登録してすぐに戻り、サーバーも要りません。回答の記録、メッセージの確認、質問の取り下げ、タスクからの参照の変更には、それぞれ`message answer`、`message ls`と`message show`、`message withdraw`、`message link`と`message unlink`を使います。人からエージェントへの依頼には`message send`と`message accept`を使います。質問の形式と各コマンドは[判断依頼](../delegate/decisions)を参照してください。`progress`は、おすすめのタスクを最大3件`nextTasks`として返します（[エピックと進行表](../watch/epics#進行表を読む)を参照）。エピックと進行表は[エピックと進行表](../watch/epics)を参照してください。

## ファイルを使って本文を編集する

長いMarkdown本文は、ファイルに書いてから読み込ませると編集しやすくなります。

```sh
agboard --project "My project" edit 1 --desc-file task.md
```

説明は50,000文字まで、エピックの詳細（`EPIC.md`）は100,000文字まで使えます。ファイルは[Markdownファイルの形式](./file-format)に従う必要があります。標準入力から説明を読むには、`--desc -`を使います。

`edit --desc-file`は、本文と完了条件を置き換え、`TASK.md`の最新の履歴と質問への参照（`questions`）を保ちます。入力ファイルの`history`と`questions`は無視されるため、未回答の質問を参照しているタスクは保留のままです。参照を変えるには`message link`・`message unlink`を使います。CLIや画面からの移動・状態の変更などの操作は、`TASK.md`に履歴を追加し、`show`・`snapshot`・ブラウザは同じ履歴を読みます。

## エピックの詳細を編集する

エピックの詳細は、frontmatterを含む`EPIC.md`の全文です。文字列で直接渡すか、ファイルや標準入力から読み込みます。

```sh
agboard --project "My project" epic edit LAUNCH --document-file epic.md
agboard --project "My project" epic edit LAUNCH --document -
agboard --project "My project" epic edit LAUNCH --priority "3,1,2"
```

`--document`と`--document-file`は同時に指定できません。どちらも100,000文字まで受け付けます。

エージェントが作るもの（`add`・`epic add`）は、AIの下書きから始まります。エージェントは編集できますが、開始されるまで`mv`と`state`は`task_is_draft`で失敗します。

```sh
agboard --project "My project" start 12 --actor ai
agboard --project "My project" epic start LAUNCH --actor ai
```

`start`は1件のタスクのAIの下書きを外します。`epic start`は、エピックとそのAIの下書きのタスクすべてを一度に外し、人がまだ下書きにしているタスクはそのままにします。計画を書いたエージェントが、質問への回答がそろい計画を清書してから開始し、人も同じコマンドを`--actor human`で実行できます。タスク、またはエピックのAIの下書きのタスクに紐づく未回答の質問があるときは、`start_blocked_by_questions`（終了コード1）で拒否されます。開始したタスクには、誰が開始したかが履歴に残ります。「AI が計画を清書し、タスクを開始しました。」または「人がタスクを開始しました。」です。

人がブラウザでエピックを下書きにしている間は、`--priority`を含む`epic edit`が`epic_is_draft`（終了コード1）で失敗し、何も変わりません。保存か破棄が済むまで待つか、残った下書きなら確定を頼んでください。`epic attachment`とタスクの所属の変更は、引き続き使えます。

## 一覧を絞り込む

```sh
agboard --project "My project" ls --column doing --json
agboard --project "My project" ls --state pending --json
agboard ls --all-projects --json
```

`ls --all-projects`は、全プロジェクトを名前順に読み、タスクの説明と履歴を完全な形で返します。`--column`と`--state`の絞り込みはすべてのプロジェクトに適用されます。`--project`とは組み合わせません。

## プロジェクト {#projects}

```sh
agboard project create "My project"
agboard project ls --json
agboard --project "My project" project rename "Website launch"
agboard project bind "My project" --folder ./docs
```

名前を変えても、プロジェクトのID・フォルダの登録・タスクは保たれます。フォルダの登録とプロジェクトの削除は、[データとバックアップ](../operations/data#projects-and-folders)に説明があります。

## 変更またはタスクを待つ

`wait`には二つのモードがあります。`--after <cursor>`は[エージェントとの連携](../delegate/agents#変更を待つ)のとおりプロジェクトの変更を待ちます。`--until task`は、対象となるAI担当タスクを一件返します。リッスンを始める前から未着手にあったタスクや、未稼働のまま進行中にあるタスクも対象です。

```sh
agboard --project "My project" wait --until task --idle-timeout 300 --json
```

`--until task`には`--idle-timeout`が必須です。1〜86,400秒を指定し、既定値はありません。一回の呼び出しで返すのは進行表と同じ順序の一件で、タスクを占有したり変更したりしません。取得したタスクを解決したら、再び`wait`を呼び出します。セッション全体の流れと、待機中のタスクの扱いは[エージェントとの連携](../delegate/agents#listen-for-the-next-task)を参照してください。

取得成功時は、一つのJSONオブジェクトを出力して終了コード0を返します。

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","documentPath":null}
```

タスクより先に、`{"kind":"answers",…}`（エージェントがまだ受け取っていない回答）や`{"kind":"requests",…}`（未処理の依頼）を返すことがあり、回答が先です。それぞれ`message accept`で受け取ってから、あらためて待ちます。

指定した時間に対象タスクがなかった場合は、`{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}`を出力して終了コード0を返します。これは対象なしでの正常終了であり、それまでの作業成功を示しません。`board_unavailable`・`project_not_found`・不正なボードデータ・引数誤りは、引き続き終了コード0以外のエラーです。`--timeout`は`--after`モードだけに指定でき、変更待ちが成立しなければエラー`wait_timeout`になります。質問への回答にはなりません。

## サーバーを起動する

サーバーを自分で起動することは、ほとんどありません。`wait`、回答を待つ質問、エージェントのHookが、動いていなければ裏で起動します。起動したコマンドは、標準エラーに1行出します。

```text
Started the Agent Board server at http://127.0.0.1:7420/ in the background. It stops by itself after 30 minutes without use.
```

こうして起動したサーバーは、ブラウザーでボードを開いている間、エージェントが待っている間、スマホが接続している間は動き続けます。どれもない状態が30分続くと止まります。`AGBOARD_IDLE_TIMEOUT`（60〜86,400秒）で変えられます。ポート7420が使われていれば、空いているポートを使い、そのことを表示します。`AGBOARD_AUTOSTART=0`で自動の起動を止められます。このとき、サーバーが要るコマンドは、サーバーがないときと同じく`board_unavailable`で失敗します。`add`・`mv`・`ls`などのほかのコマンドは、サーバーを起動しません。

### ボードをブラウザーで開く {#open-the-board-in-the-browser}

裏で起動したサーバーは、起動のきっかけになったプロジェクトのボードを、既定のブラウザーで一度だけ開きます。開く前に3秒ほど待ち、前から開いていたボードのタブがつながり直したとき（スリープから戻ったときなど）は何も開きません。サーバーが動いている間に質問が届いても、ブラウザーは開きません。`agboard serve`と`agboard serve -d`も開きません。

次のときは、ブラウザーを開きません。

- `AGBOARD_OPEN_BROWSER=0`を設定しているとき
- SSH越しにコマンドを実行しているとき（`SSH_CONNECTION`か`SSH_TTY`が設定されている）
- Linuxで画面がないとき（`DISPLAY`も`WAYLAND_DISPLAY`も設定されていない）

開いたかどうかと、開かなかった理由は、データフォルダの`serve.log`に残ります。

自分でボードを開くには、`agboard open`を実行します。今のフォルダに登録されたプロジェクトか、`--project`で指定したプロジェクトのボードを開きます。サーバーが動いていなければ、先に裏で起動します。

```sh
agboard open
agboard --project "My project" open
agboard open --print
```

開いたときも、`http://127.0.0.1:7420/?project=<id>`のようなボードのアドレスを表示します。`--print`はアドレスを表示するだけです。`--json`では`{"url":"…","projectId":"…","opened":true}`を出します。ブラウザーを開かなかったときは`opened`が`false`になり、`notice`に理由が入ります。`AGBOARD_AUTOSTART=0`でサーバーが動いていなければ`board_unavailable`で失敗します。開くためのプログラムを起動できなければ`browser_open_failed`で失敗し、自分で開くアドレスをメッセージに示します。

macOSでは`open`、Linuxでは`xdg-open`を使います。ほかのプログラムを使うには、`AGBOARD_BROWSER_OPENER`にそのプログラムを設定します。アドレスだけを引数にして実行し、SSH越しや画面がないときも使います。

### 自分でサーバーを起動する

動かし続けたいとき、ポートを選びたいとき、起動と同時にスマホを接続したいときは、自分で起動します。

`agboard serve`は、`127.0.0.1`でボードを起動します。`--port`でポートを選べます（既定は7420）。サーバーの起動と同時にngrokでスマホを接続するには、`--monitor ngrok`を付けます。

| オプション | 意味 |
| --- | --- |
| `--monitor ngrok` | リモートアクセスの接続を始めます。指定できるのは`ngrok`だけです。環境変数`NGROK_AUTHTOKEN`が必要で、トークンを引数で渡すことはできません。ngrokアカウントが持つドメインを環境変数`AGBOARD_NGROK_DOMAIN`に設定すると、開始のたびに同じアドレスになります。[同じアドレスを使い続ける](../watch/remote-access#同じアドレスを使い続ける)を参照してください。 |

スマホは、起動ごとに作る4桁の合言葉で守られます。サインイン用のオプションはありません。`--monitor`の不正な値、`NGROK_AUTHTOKEN`がないこと、未知のオプションは、終了コード2で終了します。接続を開始できなければ、`serve`は起動せず終了コード1で終了します。

接続の準備ができると、起動行にスマホ用のアドレスと合言葉が表示されます: `Serving at http://127.0.0.1:7420/; remote access at https://… with passcode 4821`。`--json`では、起動時の行にボードの`url`と`monitor`が入ります（`mode: "ngrok"`と、`ngrok`のスマホ用`url`・`passcode`）。合言葉を出力するのはここと、ボードの接続ダイアログだけです。トークンとポリシーは出力しません。ボードの**設定**からも接続を設定できます。詳しくは[リモートアクセスのガイド](../watch/remote-access)を参照してください。

### バックグラウンドで実行する

`agboard serve -d`（または`--daemon`）は、サーバーをバックグラウンドで起動し、準備ができた時点で戻ります。ターミナルは空き、閉じてもサーバーは止まりません。表示されるのは通常の起動時と同じアドレス（`--monitor ngrok`ではスマホのアドレスと合言葉も）に加えて、プロセスIDとログファイルです。`--port`と`--monitor`は通常どおり使えます。`--json`では、起動時のオブジェクトに`pid`と`log`も入ります。

```sh
agboard serve -d
agboard stop
```

`agboard stop`は、実行中のサーバーを終了し、終了したところで戻ります。`serve`・`serve -d`・コマンドのどれで起動したサーバーも止められます。`stop`の後は、待つコマンド、`serve`、`serve -d`が起動するまで、Hookはサーバーを起動しません。サーバーが動いていなければ、その旨を表示して終了コード0で終わります。`stop`に`--project`は指定できません。

### スマホ用のアドレスと合言葉を渡す

ngrok接続が動いている間、`agboard remote`は接続の状態、公開アドレス、4桁の合言葉を表示します。接続ダイアログを開かなくても、エージェントからリンクを渡してもらえます。

```sh
agboard --project "My project" remote
agboard --project "My project" remote --json
```

```text
ngrok: ready
URL: https://….ngrok-free.app/?project=<id>
Passcode: 4821
Project: My project
```

`--project`は必須で、アドレスはそのプロジェクトを開きます。指定しないときは何も表示せず、`invalid_argument`として終了コード2で終わります。`--json`では`{"status":"ready","url":"…","entrance":"…","passcode":"…","project":{"id":"…","name":"…"}}`を出します。`entrance`はプロジェクトを含まないアドレスです。

プラグインには、このためのスキル`remote`（Claude Codeでは`/agent-board:remote`）が含まれます。エージェントに「リモートアクセスのURL」や「スマホで開きたい」と頼むと、フォルダのプロジェクトに対して`agboard remote --json`を実行し、アドレスと合言葉を返します。サーバーやngrokは起動しません。

`remote`は何も起動しません。サーバーが動いていないか、接続の準備ができていないときは、アドレスも合言葉も表示せず、理由を伝えて、`remote_unavailable`として終了コード1で終わります。存在しないプロジェクトは終了コード4です。

サーバーは合言葉をこのPCのローカルアドレスにだけ返すので、合言葉はコマンドを実行した人にだけ表示され、ngrokを通ることはありません。エージェントがチャットに貼り付けると、そのチャットを読める人は、接続が続く間ボードを開けます。使い終わったら接続を止めてください。[リモートアクセスのガイド](../watch/remote-access)を参照してください。

バックグラウンドのサーバーは、出力をデータフォルダの`serve.log`に書きます。スマホの合言葉が入るため、このファイルは自分だけが読めます。`serve -d`のたびに作り直されます。バックグラウンドのサーバーを起動できない場合（ポートが使用中など）は、理由を表示して終了コード1で終わります。再起動後に自動で立ち上がることはありません。

動いているサーバーをコマンドが起動していた場合、`serve -d`は新しく起動せず、そのサーバーを動かし続けるようにします。自分で止まることはなくなり、つながっているものも切れません。動いているサーバーと食い違う`--port`や`--monitor`を指定しないことが条件です。前面の`agboard serve`は`already_serving`で終わり、`serve -d`を案内します。

自分で起動したサーバーがすでに動いている場合や、指定が食い違う場合、`serve -d`はそのサーバーを止めて起動し直すかどうかをターミナルで確認します。`y`と答えると置き換えます。新しいサーバーは、前のサーバーの設定ではなく、このコマンドの`--port`と`--monitor`で起動します。`--monitor ngrok`なら合言葉も新しくなります。それ以外の答えでは、動いているサーバーはそのままで、終了コード0で終わります。`--json`を付けたときや、ターミナルの外で実行したときは確認せず、終了コード1（`already_serving`）で終わります。

## setupとupdate {#setup-and-update}

`setup`は、データフォルダを作成し、Codex、Claude Code、または両方にAgent Boardプラグイン（SkillとHook）を導入します。`update`は、導入済みのプラグインをコマンドと同じ版にそろえます。尋ねる内容と変更するものは、[エージェントとの連携](../delegate/agents#set-up-your-agents)にあります。

```sh
agboard setup
agboard setup --agent codex --dry-run
agboard setup --agent all --yes --json
agboard update
agboard update --yes
```

| コマンド | 動作 | 終了コード |
| --- | --- | --- |
| `agboard setup` | データフォルダを作成し、設定するエージェントを尋ね、計画を表示します。`y`と答えると、プラグインを導入し、エージェントが共有フォルダを使えるようにし、CodexでAgent BoardのHookを信頼済みにします。プロジェクトは不要です。 | `0`は成功、変更なし、取り消し。`1`はエージェントの設定に失敗した、または設定できるエージェントがなかった。`2`はコマンドラインが不正、またはターミナルがないのに必要なオプションがない。 |
| `agboard update` | プラグインが導入されたすべてのエージェントで、プラグインをこの版にそろえ、新しいCodexのHookを信頼済みにします。先に計画を表示して確認します。更新後に必要なのは、自動更新ではできないとき（Codexのhookの信頼）か、プラグインを直したいときだけです。[プラグインを更新する](../delegate/agents#update-the-plugin)を参照してください。 | `0`は成功、更新なし、取り消し。`1`はエージェントの更新に失敗した。`2`はコマンドラインが不正、またはターミナルがないのに必要なオプションがない。 |

`setup`がプラグインを入れ直すのは、プラグインがない、またはファイルが`agboard`の同梱のものと違うときだけです。`update`は常に入れ直します。

どちらのコマンドも、次のオプションを受け付けます。

- `--agent codex|claude|all`で対象のエージェントを選びます。指定しないと、`setup`はターミナルで尋ね、`update`はプラグインがあるすべてのエージェントを対象にします。
- `--yes`は、CodexのHookの信頼も含めて、あらかじめ同意します。
- `--dry-run`は計画を表示するだけで、何も導入、作成、変更しません。
- `--json`は機械可読の出力を表示します。

どちらもパイプを待ちません。ターミナルがないときや`--json`を付けたときは、`setup`には`--agent`が、両方に`--yes`か`--dry-run`が必要です。足りないと終了コード`2`で終わります。コマンドが`PATH`上にないエージェントは、理由を示して飛ばします。失敗の理由はエラー出力に出ます。変更する設定ファイルとそのバックアップは[データとバックアップ](../operations/data#共有フォルダをセットアップする)を参照してください。

## Skillの本文 {#skill-text}

`agboard skills`は、`agent-board`スキルの指示を出力します。`agboard skills <topic>`は、参照や雛形を1つ出力します。トピックは`file-format`、`listening`、`resident`、`planning`、`fixed-epic-bodies`、`drafts`、`phone`、`task-template`、`epic-template`、`bug-epic-template`、`enhancement-epic-template`です。プラグインの`SKILL.md`が`agboard skills`を実行するので、エージェントは、インストールした`agboard`の指示をいつも受け取ります。このコマンドはMarkdownを出力し、何も書き込まず、サーバーも起動せず、常に終了コード`0`で終わります。トピックにない名前は、トピックの一覧を出力します。

## 出力と確認

JSON形式の出力が必要なときは`--json`を付けます。helpのテキスト・エラー・JSONの値は、ブラウザの言語に関わらず、常に英語です。

タスク・エピック・プロジェクトの削除と、`init`によるプロジェクトの初期化には、端末での人の確認が必要です。エージェントは、人に頼まなければなりません。

## 次に読む

- [エージェントとの連携](../delegate/agents): 各コマンドを使う場面と、作業全体の流れ。
- [トラブルシューティング](../operations/troubleshooting): エラーコードの意味。
