# Web API

`agboard serve`のHTTP APIです。書き込みの保護を含むリクエストの処理は、[サーバーと画面](../concepts/server-and-ui.md)で説明しています。

タスクの書き込みでは、自動生成する履歴の言語を`X-Agboard-Language: en`または`ja`で指定できます。ボードとモニターは現在の画面言語を送ります。未指定・重複・未対応の値では、本文の言語に従います。そのリクエストで自動生成する文章だけが対象で、明示した理由と保存済みの履歴は変わりません。[履歴](../concepts/history-and-decisions.md#履歴)を参照してください。

## エンドポイント

| API | 入出力と動作 |
| --- | --- |
| `GET /` | 書き込み用トークンを`meta[name=agboard-token]`に埋め込んだHTML。 |
| `GET /api/projects` | `projects`（id・name・createdAt）と`catalogVersion`。タスクは含まない。0件でも200。 |
| `GET /api/projects/{projectId}/board` | project・version・cursor・epics、本文と全履歴を持つ未アーカイブのtasks、problems。`nextTaskId`はない。 |
| `POST /api/projects/{projectId}/tasks` | title・body・acceptance・assignee・isDraftからTodo・Idleのタスクを作る。サーバーがfrontmatterを組み立てて検証する。201。 |
| `PATCH /api/projects/{projectId}/tasks/{id}` | **下書き**のタスクのtitle・body・acceptanceと任意の`finalize: true`を更新する。bodyだけならfrontmatterを、acceptanceだけなら本文を保つ。`description`と`body`の同時指定は422 `invalid_value`。後から保存した内容が優先される。下書きでなければ409 `task_not_draft`。 |
| `PUT /api/projects/{projectId}/tasks/{id}/draft` | `isDraft`を設定する。Runningのタスクは409 `invalid_state_for_draft`。 |
| `PUT /api/projects/{projectId}/tasks/{id}/epic` | `{epicId: string \| null}`。未知のEPIC-IDは404 `epic_not_found`。 |
| `POST /api/projects/{projectId}/tasks/{id}/move` | `taskStatus`と任意の`reason`。 |
| `POST /api/projects/{projectId}/tasks/{id}/answer` | `requestId`と任意の`choiceId`・`text`をロックの中で照合する。両方空は422、未知の選択肢は422 `request_choice_unknown`、依頼が変わっていれば409 `request_changed`。 |
| `POST /api/projects/{projectId}/tasks/{id}/agent-status` | 状態の規則の範囲で稼働状態を変える。画面から操作する機能はない。 |
| `DELETE /api/projects/{projectId}/tasks/{id}` | アーカイブ済みのタスクだけを削除する。それ以外は409 `task_not_archived`。204、すでにないときは404。 |
| `…/tasks/{id}/attachments`、`…/attachments/{attachmentId}` | タスクの画像（GET・POST・DELETE）。ProjectId・タスクID・添付IDで照合する。 |
| `GET …/tasks/{id}/evidence/{evidenceId}` | タスクの証跡を`text/plain; charset=utf-8`で返す。 |
| `GET`・`POST /api/projects/{projectId}/epics` | エピックの一覧と作成（id・name・color・isDraft・planまたはbody）。`acceptance`の入力は受け付けない。201。 |
| `GET`・`PATCH /api/projects/{projectId}/epics/{epicId}` | 取得、またはname・color・isDraft・planまたはbody・priorityの更新。本文と未知のメタデータを保つ。`PLAN.md`→`epic.json`の順に保存する。 |
| `…/epics/{epicId}/attachments`、`…/{attachmentId}` | エピックの画像。 |
| `POST …/tasks/{id}/archive`、`POST …/tasks/{id}/restore` | 本文なし。すでにその状態のタスクに繰り返すと、変更せず同じタスクを返す。 |
| `POST …/tasks/archive-done` | `{ids: number[]}`。空・重複・不正なIDは422。`{tasks, archivedCount}`を返す。 |
| `GET /api/projects/{projectId}/archive` | 本文・全履歴・添付のメタデータを持つアーカイブ済みのタスク。 |
| `GET /assets/{name}` | `build.rs`が生成した表にある分割資産だけ。ほかは404。immutableでキャッシュする。 |
| `GET /api/events` | SSE。購読後に`ready`、versionの変化で`changed`、15秒ごとに接続維持のコメント。 |
| `POST /api/notify` | 全クライアントに再取得を促す。データを変えず、トークンも不要。204。 |
| `GET /api/health` | `ok`と`pid`。 |

**一括アーカイブ。** 対象のIDは確認を開いた時点で固定し、送信時にDoneのタスクを集め直すことはありません。ロックの中で、未アーカイブの対象がすべてまだDoneであることを確かめます。移動または削除された対象が一つでもあれば、要求全体を409 `archive_targets_changed`にして何も変えません。アーカイブ済みの対象は完了済みとして扱うので、応答を失った後の再送で履歴は重複しません。対象は一件ずつ保存し、最後に一回だけ再読み込みと通知を行います。途中で保存に失敗すると、保存済みの対象はアーカイブされたまま残り、再送で残りを処理します。

**エラー**は`code`・`message`・`reason`を持ちます。

| ステータス | 意味 |
| --- | --- |
| 400 | 壊れたJSON。 |
| 403 | 保護に失敗した。 |
| 404 | プロジェクト・タスク・エピックがない。 |
| 409 | `request_changed`・`task_not_draft`・`invalid_state_for_draft`・`epic_in_use`・`epic_id_taken`・`task_not_archived`・`archive_targets_changed`。 |
| 413 | 1 MiBを超える本文。 |
| 422 | ID構文・入力・状態の規則の違反。または、パス・項目・理由つきの正本ファイルの不備（`file_invalid`）。 |
| 503 | ロック待ちが時間切れになった。 |
| 500 | それ以外（`format_unsupported`・`file_unreadable`・`file_error`を含む）。 |
