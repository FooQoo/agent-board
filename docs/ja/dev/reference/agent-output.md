# Hook・進行表・waitの出力

エージェントに返されるJSONの形式をまとめます。各機能の仕組みは[エージェント連携](../concepts/agents.md)で説明しています。タスクとエピックの項目は[共有ファイル](./files.md#タスクのjsonとスナップショット)にあります。

## 進行表

`agboard progress --json`とHookは、同じ表を返します。

```json
{
  "fetchedAt": "2026-10-17T00:48:47Z",
  "project": { "id": "ef18518d…", "name": "agent-board", "createdAt": "2026-10-10T22:59:43Z" },
  "version": "781ad752…",
  "cursor": "f1:ef18518d…:781ad752…",
  "epics": [
    {
      "id": "SPEC-MIGRATION",
      "name": "Move the specifications into the repository",
      "documentPath": "…/epics/SPEC-MIGRATION/EPIC.md",
      "priorityError": false,
      "tasks": [
        {
          "id": 98,
          "title": "Clean up after the merge",
          "assignee": "ai",
          "taskStatus": "todo",
          "agentStatus": "idle",
          "draft": null,
          "acceptance": { "done": 0, "total": 3 },
          "acceptanceError": false,
          "taskPath": "…/tasks/98/TASK.md"
        }
      ]
    }
  ],
  "unassigned": []
}
```

- 既定では、人の判断待ちでないTodoとDoingのタスクだけが載ります。タスクはエピックごとに`priority`の順で並び、エピックのないタスクは`unassigned`に入ります。
- `progress`と`hook`に`--include-pending`と`--include-done COUNT`を付けると、表に`pending`配列と`done`配列が加わります。`pending`は判断待ちのTodo・DoingのタスクをID順に並べ、それぞれに、IDが最も小さい未回答の質問を200文字までにした`question`が付きます。`done`は直近に完了したタスクを新しい順に`COUNT`件並べ、対象はTodoまたはDoingのタスクがまだあるエピックに限ります。オプションがなければどちらのフィールドもありません。
- 人からの依頼が未処理（受理も取り下げもされていない）のとき、表に`requests`配列がID順で加わります。各要素は`{"id":"Q-3","createdAt":"…","title":"…"}`で、`title`は依頼の最初の空でない行から見出しの記号を除いた80文字までです（超える分は`…`で終わります）。未処理の依頼がなければフィールドはありません。エージェントは`message show`で全文を読み、`message accept`で依頼を引き受けます。
- 本文も履歴もありません。エージェントは、必要な`documentPath`と`taskPath`のファイルを読みます。
- `cursor`は`wait --after`に渡す値です。
- パスはローカルのCLIとHookの出力にだけ現れ、リモート向けのJSONには出ません。
- 以前の`planPath`は出力されなくなりました。[データとバックアップ](../../guide/operations/data.md)のEPIC.mdへの移行の節を参照してください。

## Hookの出力

`agboard hook --agent claude|codex`は、エージェント向けにJSONを出力します。

```json
{ "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "AGBOARD_PROGRESS\n{…}" } }
```

- `additionalContext`には、成功時は`AGBOARD_PROGRESS`と進行表のJSONが入ります。失敗時は`AGBOARD_ERROR`に続き、`code`と理由、ボードに依存する変更を止めるよう促す注意文が入ります。
- `AGBOARD_ERROR`のコード: `bound_project_missing`・`project_not_found`・`board_unavailable`・`context_too_large`・`invalid_hook_input`（JSONが不正、または`cwd`が文字列でない、絶対パスでない）・`hook_cwd_unavailable`（`cwd`が存在しない、または読めない）。`folder_unbound`は、Hookの出力ではなくなりました。
- **静かなスキップ。** フォルダの登録情報が正常で、`cwd`が読め、一致する登録がないとき、Hookはstdoutにもstderrにも出力せず、終了コード0で終わります。そのため、GlobalのHookが、プロジェクトのないフォルダでの作業を妨げることはありません。[Hookのスキップとエラー](../concepts/agents.md#hookのスキップとエラー)を参照してください。
- 表を加えるとき、サーバーが動いていなければ、Hookは裏で起動もします。出力は変わらず、失敗は`serve.log`に残ります。
- 上限: 表は256 KiB、一回の実行は10秒。入力は大きさにかかわらず読み、使うのは`hook_event_name`と`cwd`だけです。表が上限を超えると`context_too_large`を報告し、切り詰めて成功とすることはありません。

## スナップショットとwait

`agboard snapshot --json`と`agboard wait --after <cursor> --json`は、プロジェクトのスナップショットを返します。`fetchedAt`・`project`・`version`・`cursor`・`epics`・`tasks`（それぞれ全履歴を持つ）・`nextTaskId`・`problems`です。次の`wait`には、新しい`cursor`を使います。

`wait`は、プロジェクトのversionがcursorと違うまで待ちます。`wait_timeout`・`board_unavailable`・`cursor_invalid`・`project_not_found`のときは、スナップショットではなくエラーで終わります。どれも「回答された」という意味ではありません。[エラーコード](./errors.md)を参照してください。

`wait --until task --idle-timeout <seconds> --json`は、待機を始める前から存在するタスクも含め、AI担当でTodoまたはDoing、かつIdleの対象タスクを一件選びます。順序は進行表と同じです。結果にはタスクと、その`TASK.md`、およびエピックがあれば`documentPath`（`EPIC.md`のパス）が含まれます。取得はタスクを占有したり編集したりしません。

taskの項目を省略した例です。

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","documentPath":"…/epics/DESIGN/EPIC.md"}
```

未処理の依頼があるとき、waitは人が頼んだものなので、どのタスクよりも先にその依頼を返します。結果には、未処理の依頼すべてが進行表と同じ形で入ります。エージェントは`message show`で読み、`message accept`で引き受けてから、あらためて待ち受けます。引き受けるまでは、次のwaitも同じ依頼を返します。

```json
{"kind":"requests","projectId":"<id>","cursor":"<cursor>","requests":[{"id":"Q-3","createdAt":"2026-11-17T09:00:00Z","title":"Add a reset link"}]}
```

指定時間に対象タスクも未処理の依頼も現れない場合は、成功結果（終了コード0）を返します。

```json
{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}
```

待機秒数は必須で、1〜86,400秒です。接続・プロジェクト・データ・引数のエラーは、`idle_timeout`にはなりません。[エラーコード](./errors.md#サーバーと待機)を参照してください。

## open

`agboard open --json`は、サーバーが動いていなければ起動し（`AGBOARD_AUTOSTART=0`のときを除く）、登録されたプロジェクトか指定したプロジェクトのボードを開いて、オブジェクトを一つ出します。

```json
{"url":"http://127.0.0.1:7420/?project=<id>","projectId":"<id>","opened":true}
```

`--print`のときと、ブラウザーを開いてはいけないときは`opened`が`false`になり、`notice`に理由が入ります。例：`"AGBOARD_OPEN_BROWSER=0 turns opening the browser off."`。サーバーに届かなければ`board_unavailable`、開くためのプログラムを起動できなければ`browser_open_failed`です。[エラーコード](./errors.md#サーバーと待機)を参照してください。

## remote

`agboard remote --json`は、動いているサーバーにngrok接続を問い合わせ、`ready`のときにオブジェクトを一つ出します。

```json
{"status":"ready","url":"https://<name>.ngrok-free.app/?project=<id>","entrance":"https://<name>.ngrok-free.app","passcode":"2418","project":{"id":"<id>","name":"<name>"}}
```

`--project`は必須で、指定しないと`invalid_argument`（終了コード2）です。`url`は指定したプロジェクトのボードを開くアドレスで、`entrance`はプロジェクトを含まないアドレスです。指定したプロジェクトがなければ`project_not_found`です。

それ以外のときは、標準出力には何も出さず、終了コード1と`remote_unavailable`で終わります。サーバーが動いていないか、接続が`ready`ではない場合です。エラーにはアドレスも合言葉も含まれません。サーバーはこの情報をローカルのアドレスにだけ返すので、合言葉はこのコンピューターの前にいる人にだけ届き、トンネルは通りません。[エラーコード](./errors.md#サーバーと待機)を参照してください。

## messageのイベント

`agboard message ask --actor ai --questions-json <json|-> [--task <id>]…`は、次の形を受け取ります。

```json
{
  "questions": [
    {
      "body": "Should existing records be deleted or kept?",
      "choices": [
        { "id": "delete", "label": "Delete them and start clean" },
        { "id": "keep", "label": "Keep them and migrate" }
      ],
      "recommendedChoiceId": "keep",
      "tasks": [12]
    }
  ]
}
```

- `questions`: 1〜20件で、1件ごとに別の質問ファイル（`Q-<n>`）になります。各項目は`body`（Markdown、1〜5,000文字）を持ちます。
- 質問ごとに任意で、`choices`（2〜10件。選択肢の`id`は`[A-Za-z0-9_-]`の1〜64文字で質問内で一意、`label`は1〜200文字）、`recommendedChoiceId`（選択肢のどれか1つ）、その質問を参照させるタスクのID`tasks`を指定できます。`--task`のタスクはすべての質問を参照します。`choices`のない質問は、テキストで答えます。未知のフィールドは拒否します。
- `--timeout`は1〜86,400秒か`none`（既定600）、`--heartbeat`は10〜600秒（既定60）です。`message wait Q-<n> [Q-<n>]…`も同じ2つのオプションを取ります。

`--json`を付けると、`message ask`と`message wait`は1行に1つのJSONオブジェクトを書きます。どれも`type`を持ちます。

| `type` | フィールド | 出るとき |
| --- | --- | --- |
| `registered` | `questions`（`id`）・`resumed` | 最初。`message wait`では`resumed`が`true`。`--no-wait`ではこの1行だけを書き、終了コード0で終わる。 |
| `waiting` | `ids`・`elapsed`・`remaining`（期限なしなら`null`）・`answered`・`total` | `--heartbeat`秒ごと。タイマーから出し、ボードは読まない。 |
| `answered` | `ids`・`answers`（`id`・`choiceId`・`choiceLabel`・`text`・`via`・`at`） | 最後。未回答の質問がなくなったとき。終了コード0。 |
| `timeout` | `ids`・`answered`・`total` | 最後。先に`--timeout`が過ぎたとき。質問は未回答のまま。終了コード5。 |
| `withdrawn` | `ids`（取り下げられた質問）・`answers` | 最後。未回答の質問がなくなり、その中に取り下げられたものがあったとき。終了コード6。 |
| `error` | `error`（`code`・`message`・`reason`） | 最後。`board_unavailable`などで待機に失敗したとき。 |

回答を待つ`message ask`は、何かを保存する前にサーバーを確認します。`--no-wait`はサーバーなしで保存します。

ほかの`message`コマンドは、`--json`を付けると1つのJSONオブジェクトを出力します。

| コマンド | 出力 |
| --- | --- |
| `message answer` | `{questions}`: 記録した質問。すでに回答済みの質問があれば、エラーの出力に記録済みの回答を含む`questions`を加えます。 |
| `message ls` | `{messages}`: 質問と依頼をまとめたもの。 |
| `message show` | `{question}`または`{request}`。 |
| `message send`、`message accept` | `{request}`。 |
| `message withdraw` | 取り下げたものに応じて`{question}`または`{request}`。 |

質問は`id`・`type`・`from`・`to`・`body`・`tasks`・`choices`・`recommendedChoiceId`・`reply`（`choiceId`・`choiceLabel`・`text`・`via`・`at`、なければ`null`）・`status`・`referencedBy`・`createdAt`・`withdrawnAt`を持ちます。依頼は`id`・`type`・`from`・`to`・`body`・`status`・`acceptedAt`・`acceptedBy`・`withdrawnAt`・`createdAt`を持ちます。状態の意味は[メッセージ](./files.md#メッセージ)を参照してください。

## 初回案内のサンプルカード

進行表、Hookの出力、`wait --until task`は、`onboardingSample`の識別があるカードを、レーンや状態に関係なく除外します。[エージェント連携](../concepts/agents.md#初回案内のサンプルカード)を参照してください。