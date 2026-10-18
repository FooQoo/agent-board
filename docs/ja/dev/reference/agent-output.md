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
      "planPath": "…/epics/SPEC-MIGRATION/PLAN.md",
      "priorityError": false,
      "tasks": [
        {
          "id": 98,
          "title": "Clean up after the merge",
          "assignee": "ai",
          "taskStatus": "todo",
          "agentStatus": "idle",
          "isDraft": false,
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

- Pending以外のTodoとDoingのタスクだけが載ります。タスクはエピックごとに`priority`の順で並び、エピックのないタスクは`unassigned`に入ります。
- 本文も履歴もありません。エージェントは、必要な`planPath`と`taskPath`のファイルを読みます。
- `cursor`は`wait --after`に渡す値です。
- パスはローカルのCLIとHookの出力にだけ現れ、リモート向けのJSONには出ません。

## Hookの出力

`agboard hook --agent claude|codex`は、エージェント向けにJSONを出力します。

```json
{ "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "AGBOARD_PROGRESS\n{…}" } }
```

- `additionalContext`には、成功時は`AGBOARD_PROGRESS`と進行表のJSONが入ります。失敗時は`AGBOARD_ERROR`に続き、`code`と理由、ボードに依存する変更を止めるよう促す注意文が入ります。
- `AGBOARD_ERROR`のコード: `folder_unbound`・`bound_project_missing`・`project_not_found`・`board_unavailable`・`context_too_large`。
- 上限: 入力は64 KiB、表は256 KiB、一回の実行は10秒。超えると`context_too_large`を報告し、切り詰めて成功とすることはありません。

## スナップショットとwait

`agboard snapshot --json`と`agboard wait --after <cursor> --json`は、プロジェクトのスナップショットを返します。`fetchedAt`・`project`・`version`・`cursor`・`epics`・`tasks`（それぞれ全履歴を持つ）・`nextTaskId`・`problems`です。次の`wait`には、新しい`cursor`を使います。

`wait`は、プロジェクトのversionがcursorと違うまで待ちます。`wait_timeout`・`board_unavailable`・`cursor_invalid`・`project_not_found`のときは、スナップショットではなくエラーで終わります。どれも「回答された」という意味ではありません。[エラーコード](./errors.md)を参照してください。

`wait --until task --idle-timeout <seconds> --json`は、待機を始める前から存在するタスクも含め、AI担当・Todo・Idleの対象タスクを一件選びます。順序は進行表と同じです。結果にはタスクと、その`TASK.md`およびエピックがあれば`PLAN.md`のローカルパスが含まれます。取得はタスクを占有したり編集したりしません。

taskの項目を省略した例です。

```json
{"kind":"task","projectId":"<id>","cursor":"<cursor>","task":{"id":1},"taskPath":"…/tasks/1/TASK.md","planPath":"…/epics/DESIGN/PLAN.md"}
```

指定時間に対象タスクが現れない場合は、成功結果（終了コード0）を返します。

```json
{"kind":"idle_timeout","projectId":"<id>","idleTimeoutSeconds":300}
```

待機秒数は必須で、1〜86,400秒です。接続・プロジェクト・データ・引数のエラーは、`idle_timeout`にはなりません。[エラーコード](./errors.md#サーバーと待機)を参照してください。

## 判断依頼

`agboard state <id> pending --request-json <json>`は、次の形を受け取ります。

```json
{
  "question": "Should existing records be deleted or kept?",
  "choices": [
    { "id": "delete", "label": "Delete them and start clean" },
    { "id": "keep", "label": "Keep them and migrate" }
  ],
  "wait": {}
}
```

- `question`: 1〜2,000文字。`choices`: 0〜10件（エージェントのスキルは2〜10件を求めます）。各`id`は`[A-Za-z0-9_-]`の1〜64文字で依頼内で一意、各`label`は1〜200文字。
- `wait: {}`を付けると、コマンドが回答まで待ちます。任意の`timeoutSeconds`（1〜86400）で待機時間を制限できますが、質問はPendingのままです。
- 待機したコマンドは、更新されたタスクと回答を別々に返します。

```json
{ "task": { "…": "…" }, "answer": { "actor": "human", "choiceId": "keep", "choiceLabel": "Keep them and migrate", "text": null } }
```
