# Web API

`agboard serve`のHTTP APIです。書き込みの保護を含むリクエストの処理は、[サーバーと画面](../concepts/server-and-ui.md)で説明しています。

タスクの書き込みでは、自動生成する履歴の言語を`X-Agboard-Language: en`または`ja`で指定できます。ボードは現在の画面言語を送ります。未指定・重複・未対応の値では、本文の言語に従います。そのリクエストで自動生成する文章だけが対象で、明示した理由と保存済みの履歴は変わりません。[履歴](../concepts/history-and-decisions.md#履歴)を参照してください。

## ngrokの入口から使う

ngrokの入口は、ボードのページと以下のルートを同じパスで配信します。ローカルのHost・Origin・トークンの検査の代わりに、合言葉のsessionの背後に置きます。そこのページはトークンを持ちません。変更にはsessionのCSRFトークンを`X-Agboard-Csrf`で送り、sessionは`/api/remote/session`と`/api/remote/unlock`で開きます。この2つの経路と、入口が配信しないもの（接続設定、`POST /api/notify`、`docs/open`）は、[入口のルート](./remote-routes.md#入口から使うボードのアプリ)を参照してください。

## エンドポイント

| API | 入出力と動作 |
| --- | --- |
| `GET /` | 書き込み用トークンを`meta[name=agboard-token]`に埋め込んだHTML。 |
| `GET /api/projects` | `projects`（id・name・createdAt）と`catalogVersion`。タスクは含まない。0件でも200。 |
| `POST /api/projects/{projectId}/tasks` | title・body・acceptance・assigneeと任意の`draft: "human"`からTodo・Idleのタスクを作る（AIの下書きはエージェントだけが作るので、`"ai"`は422 `invalid_value`）。サーバーがfrontmatterを組み立てて検証する。201。 |
| `POST /api/projects/{projectId}/tasks/multipart` | 画像付きの通常タスク、または依頼本文・任意のエピック・画像をまとめた簡易依頼タスクを作る。下記を参照。 |
| `PATCH /api/projects/{projectId}/tasks/{id}` | **下書き**のタスクのtitle・body・acceptanceと任意の`finalize: true`を更新する。`draft: "ai"`を付けると、保存後もAIの下書きのままにする（人がAIの提案を直したあと、確定せず提案に戻す）。AIの下書きへの`finalize`は409 `ai_draft_needs_start`。bodyだけならfrontmatterを、acceptanceだけなら本文を保つ。`description`と`body`の同時指定は422 `invalid_value`。後から保存した内容が優先される。下書きでなければ409 `task_not_draft`。 |
| `PUT /api/projects/{projectId}/tasks/{id}/draft` | `draft`（必須）を設定する。`"human"`で人の下書きにし、`null`で確定し、`"ai"`で元のAIの下書きに戻す。AIの下書きを外せるのは開始（`agboard start`）だけで、AIの下書きへの`null`は409 `ai_draft_needs_start`、通常のタスクへの`"ai"`は422。`discard: true`（`null`と一緒の場合だけ）を付けると、確定せずに下書きを取り消し、履歴に`Discarded draft changes.`を残す。Runningのタスクは409 `invalid_state_for_draft`。 |
| `PUT /api/projects/{projectId}/tasks/{id}/acceptance/{condition}` | `{"done": true\|false}`で、条件を1件、人として設定する。版は送らず、ロックの中で最新の`TASK.md`を変え、その選択を優先する。`{task, changed}`を返す。アーカイブ済みのタスクは409 `task_archived`、存在しない条件は422 `invalid_argument`。 |
| `PUT /api/projects/{projectId}/tasks/{id}/epic` | `{epicId: string \| null}`。未知のEPIC-IDは404 `epic_not_found`。 |
| `POST /api/projects/{projectId}/tasks/{id}/move` | `taskStatus`、任意の`reason`、任意の`fromStatus`（利用者が移動を選んだときに画面が表示していた状態）。`fromStatus`があるとき、タスクがもうその状態にいなければ409 `task_status_changed`で、何も書かない。本文には今の状態の`currentStatus`を加えるので、画面はそれを表示し、利用者はそこからもう一度移動できる。ボードとスマホの画面は`reason`を送らず（サーバーが理由を生成します）、いつも`fromStatus`を送る。移動が拒否されたときは、カードはその列のままで、画面に短い通知を出す。 |
| `POST /api/projects/{projectId}/tasks/{id}/agent-status` | 状態の規則の範囲で稼働状態を変える。画面から操作する機能はない。 |
| `GET /api/projects/{projectId}/messages` | 質問と依頼をまとめて`{messages}`で、新しい順に返す。`status`は`open`（既定）・`closed`・`withdrawn`・`all`、`type`は`question`か`request`、`limit`は1〜500（既定50）。 |
| `GET /api/projects/{projectId}/messages/{messageId}` | メッセージ1件を`{question}`または`{request}`で返す。質問は`id`・`type`・`from`・`to`・`body`・`tasks`・`choices`・`recommendedChoiceId`・`reply`（`choiceId`・`choiceLabel`・`text`・`via`・`at`・`acceptedAt`、なければ`null`。`acceptedAt`はAIが回答を受け取るまで`null`）・`status`（`open`・`answered`・`withdrawn`）・`referencedBy`・`createdAt`・`withdrawnAt`を持つ。依頼は`id`・`type`・`from`・`to`・`body`・`status`（`open`・`accepted`・`withdrawn`）・`acceptedAt`・`withdrawnAt`・`createdAt`を持つ。未知のIDは404 `message_not_found`。 |
| `POST /api/projects/{projectId}/messages/answers` | `{answers: [{questionId, choiceId?, text?}]}`。未知のフィールドは拒否する。選択肢のある質問には`choiceId`か`text`（または両方）が必要で、`text`だけでも有効な回答になる（選択は`null`）。ない質問には`text`が必要。未知の選択肢は422 `choice_unknown`、依頼のIDは422 `message_type_mismatch`。回答はまとめて保存し、一部だけ保存することはない。すでに回答済み、または取り下げ済みの質問があれば何も保存せず、409で`error`、`questionAnswered`と`questionWithdrawn`（ID）、`questions`（記録済みの質問）を返す。未知の質問は404 `message_not_found`。成功すると`{questions}`を返す。 |
| `POST /api/projects/{projectId}/messages/requests` | AIへの依頼を送る。本文はmultipartで、`text`のパートと、任意の数の`images`のファイルパート。201で`{request}`を返す。 |
| `GET /api/projects/{projectId}/messages/{messageId}/attachments/{name}` | 依頼に添えた画像を返します。依頼の本文は画像を `![alt](attachments/<name>)` と参照し、`<name>` はファイル名です。種類はファイルの内容から判定し（PNG、JPEG、WebP、GIF）、`Cache-Control: no-store` と `X-Content-Type-Options: nosniff` を付けます。ファイル名として単純でない名前（パス、`..`、先頭のドット）、存在しないファイル、画像でないファイル、シンボリックリンクは 404 `attachment_not_found`、存在しないメッセージは 404 `message_not_found` です。読み取り専用で、入口経由でも使えます。 |
| `POST /api/projects/{projectId}/messages/{messageId}/withdraw` | 人が依頼を取り下げ、`{request}`を返す。質問は403 `ai_only`、受け付け済みの依頼は409 `message_closed`、すでに取り下げた依頼は409 `request_withdrawn`。依頼や回答の受け付けにエンドポイントはなく、CLIだけが行う。 |
| `DELETE /api/projects/{projectId}/tasks/{id}` | アーカイブ済みのタスクだけを削除する。それ以外は409 `task_not_archived`。204、すでにないときは404。 |
| `GET …/tasks/{id}/results` | タスクの成果を古いものから返します。`{taskId, results}`で、各成果のフィールドは[成果](./files.md#results)のとおりです。読み取り専用で、存在しないタスクは404 `task_not_found`です。成果は、APIが返すすべてのタスクオブジェクトの`results`配列にも入ります。SummaryとDetailのストリームには載せません。 |
| `…/tasks/{id}/attachments`、`…/attachments/{attachmentId}` | タスクの画像（GET・POST・DELETE）。ProjectId・タスクID・添付IDで照合する。 |
| `GET`・`POST /api/projects/{projectId}/epics` | エピックの一覧と作成（id・name・color・draft・documentまたはbody）。`acceptance`の入力は受け付けない。201。 |
| `GET`・`PATCH`・`DELETE /api/projects/{projectId}/epics/{epicId}` | 取得、またはname・color・draft・documentまたはbody・priorityの更新。本文と未知のメタデータを保つ。下書きのエピックを拒否するのはCLIだけで、この更新は拒否しない。`draft: null`で人の下書きを解除する（AIの下書きのエピックは409 `ai_draft_needs_start`）。エピックには履歴がないので、何も記録しない。`EPIC.md`→`epic.json`の順に保存する。`DELETE`は204を返す。そのエピックを名指ししているタスク（アーカイブ済みを含む）が一つでもあれば、409 `start_blocked_by_questions`・`epic_in_use`で拒否する。 |
| `…/epics/{epicId}/attachments`、`…/{attachmentId}` | エピックの画像。 |
| `POST …/tasks/{id}/archive`、`POST …/tasks/{id}/restore` | 本文なし。すでにその状態のタスクに繰り返すと、変更せず同じタスクを返す。 |
| `POST …/tasks/archive-done` | `{ids: number[]}`。空・重複・不正なIDは422。`{tasks, archivedCount}`を返す。 |
| `GET /api/projects/{projectId}/archive` | 本文・全履歴・添付のメタデータを持つアーカイブ済みのタスクと、同じスナップショットの`epics`。各タスクの`epicId`は同じ応答の`epics`で解決する。エピックがないタスク、または存在しないエピックのタスクにはラベルを付けない。 |
| `GET /api/projects/{projectId}/summary` | ボードの一覧に使うデータ。プロジェクト、`version`、タスク、エピック、problemsを返し、本文は含めない。[SummaryとDetail](#summaryとdetail)を参照。 |
| `GET /api/projects/{projectId}/sessions` | プロジェクトに張り付いているエージェントセッションとその数、およびボードが起動したセッション。[張り付いたセッション](#張り付いたセッション)を参照。キャッシュしません。 |
| `GET …/sessions/models`、`POST …/sessions/launch`、`POST …/sessions/stop` | 画面を持たないClaude CodeとCodexのセッションを起動・停止する。ローカルのリスナーのみ。[セッションの起動](#セッションの起動)を参照。 |
| `GET /api/projects/{projectId}/tasks/{id}/detail` | 1件のタスクの本文・完了条件・履歴をNDJSONのストリームで返す。アーカイブ済みのタスクも同じ方法で読む。 |
| `GET /api/projects/{projectId}/epics/{epicId}/detail` | 1件のエピックのドキュメントをNDJSONのストリームで返す。 |
| `GET /api/projects/{projectId}/docs/tree`<br>`GET /api/projects/{projectId}/docs/file`<br>`GET /api/projects/{projectId}/docs/assets`<br>`POST /api/projects/{projectId}/docs/open` | プロジェクトの`docs/`にある文書を読むだけのルート。フォルダのツリー、MarkdownかMDXのファイル1つ、画像、フォルダやファイルをコンピュータのアプリで開く操作。[プロジェクトのドキュメント](#プロジェクトのドキュメント)を参照。 |
| `GET /assets/{name}` | `build.rs`が生成した表にある、内容から名前を付けたスクリプトとスタイルシートだけ。ほかは404。immutableでキャッシュする。`Accept-Encoding`が許せばgzipで送り、`Vary: Accept-Encoding`を付ける。 |
| `GET /docs-sandbox`<br>`GET /docs-sandbox/{name}` | 文書のMDXを実行するページと、内容から名前を付けたそのスクリプト（ほかの名前は404）。トークンもボードのデータも持たない固定のページ。専用の`Content-Security-Policy`（`default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`）と`X-Content-Type-Options: nosniff`を付ける。ボードは`sandbox="allow-scripts"`のiframeで埋め込む。[ドキュメントのMDX](../concepts/security.md#ドキュメントのmdx)を参照。 |
| `GET /api/events` | SSE。購読後にボードのビルドIDを含む`ready`（`{"build":"<16桁の16進数>"}`）、変更されたリソースを運ぶ`changed`（[変更イベント](#変更イベント)を参照）、保存した言語やテーマが変わったときに`preferences`（`GET /api/preferences`と同じJSON）、15秒ごとに接続維持のコメント。 |
| `GET /api/preferences` | 保存済みの言語とカラーテーマ。`locale`・`theme`（`mode`・`accent`）・`revision`。ファイルがない、または読めない場合は既定値。キャッシュしない。[表示設定](#表示設定)を参照。 |
| `PUT /api/preferences` | JSONの本文で`locale`・`theme`・両方のいずれかを保存し、`GET`と同じ形を、`revision`を1増やして返す。未知の項目と不正な値は422 `invalid_preferences`、書き込みの失敗は500 `preferences_unavailable`。拒否・失敗のときは保存済みの値を変えない。 |
| `GET /api/notification-settings` | スマホに届ける通知の種類。`kinds`・`revision`。ファイルがない、または読めない場合は既定値。キャッシュしない。[スマホの通知設定](#スマホの通知設定)を参照。 |
| `PUT /api/notification-settings` | JSONの本文で`kinds`グループを保存し、`GET`と同じ形を、`revision`を1増やして返す。不正な本文は422 `invalid_notification_settings`、書き込みの失敗は500 `notification_settings_unavailable`。 |
| `POST /api/notify` | 全クライアントに再取得を促す。データを変えず、トークンも不要。204。 |
| `GET /api/health` | `ok`と`pid`。 |
| `GET /api/monitor-connections`とその配下の経路 | ngrokのリモート接続。[リモート接続](#リモート接続)を参照。 |

### SummaryとDetail

ボードは、プロジェクトを2段階で読みます。Summaryは、カードや一覧の行に表示する内容をまとめて返します。Detailは、カードやエピックを開いたときにだけ必要な内容をストリームで返します。同じ経路はngrokの入口からも合言葉のsessionの背後で提供します。[入口のルート](./remote-routes.md)を参照してください。パスのプロジェクトIDは読む対象の指定であり、アクセス権ではありません。

以下の形は、`src/server/contracts/`のRustの型と、`tests/fixtures/data-layer/`のゴールデン例で固定します。RustとTypeScriptのテストは、同じゴールデン例を読みます。

**Summary。** `GET …/summary`は、`project`（`id`・`name`）、`version`、`tasks`、`epics`、`questions`、`messages`、`problems`を返します。本文、完了条件の文章、履歴、エピックのドキュメント、画像のバイト列は含みません。応答はインデックスの投影から作るため、ファイルは読みません。アーカイブ済みのタスクは一覧に含めません（エピックの件数には数えます）。`version`は解析済みデータのハッシュで、`ETag`（`"<version>"`）にもなります。`If-None-Match`がこの値を指す要求（複数の値、弱い形式、`*`も一致）には、本文なしの`304`を返します。存在しないプロジェクトは404 `project_not_found`、形式の誤ったIDは422 `invalid_value`、`project.json`を読めないプロジェクトはそのファイルのエラーです。

| 項目 | フィールド |
| --- | --- |
| タスク | `id`（整数）、`title`、`taskStatus`、`agentStatus`、`assignee`、`draft`、`position`、`epicId`（なければ`null`）、`acceptance`（`done`・`total`）、`acceptanceError`、`createdAt`、`updatedAt`、`taskStatusChangedAt`、`agentStatusChangedAt`、`questionIds`、`openQuestionIds`、`pendingRequestId`、`pendingReason`、`pendingChoices`、`onboardingSample`（以前のリリースの案内が作ったカードのみ）、`detailVersions`（`document`・`history`）。名前はボードの`Task`と同じ。 |
| エピック | `id`（文字列）、`name`、`color`、`draft`、`priority`（エピックが定める順序のタスクID。定めなければ空）、`priorityError`（保存された順序を読めないため、`priority`は無視する）、`progress`（`todo`・`doing`・`done`・`archived`・`total`）、`detailVersions`（`document`）。 |
| 質問 | 未回答の質問をID順に並べる。`id`・`title`（1行目、200文字まで）・`recommendedChoiceId`・`referencedBy`（参照しているアーカイブ前のタスク）・`createdAt`。全文は`GET …/messages/{messageId}`で読む。 |
| メッセージ | 未完了の質問と依頼を一つの形で、古い順（同時刻はID順）に並べる。`id`（`Q-<n>`）・`type`（`question`・`request`）・`from`・`to`（`ai`か`human`）・`turn`（次に動く側。`ai`・`human`、終わったものは`null`）・`title`・`createdAt`・`tasks`（関わるタスクの番号。依頼は持たない）・`epicId`（または`null`）。質問の`turn`は、未回答のあいだは`human`、回答済みでAIがまだ回答を受け取っていないあいだは`ai`で、その間も一覧に残る。依頼の`turn`は`ai`。回答をAIが受け取った質問、受け付け済みの依頼、取り下げたメッセージは含めないため、載っているメッセージには必ず`turn`がある。`questions`は、まだ読んでいる画面のために残す。 |
| Problem | `file`・`field`・`reason`。ボードと同じ。 |

versionはすべて不透明な文字列で、解析済みデータの内容ハッシュです。サーバーの起動回に依存しないため、再起動後も保存済みの値と比べられます。versionは等しいかどうかだけを比べてください。

**Detail。** `GET …/tasks/{id}/detail`と`GET …/epics/{epicId}/detail`は、`Content-Type: application/x-ndjson`と`Cache-Control: no-store`つきの`200`を返します。各行は1つのJSONオブジェクトで、`type`がイベントを表します。

| `type` | フィールド | 意味 |
| --- | --- | --- |
| `start` | `resource`（`task`または`epic`）、`id`、`projectId`、`sections`、`versions` | 最初の行。`versions`は要求したセクションだけを持つ。 |
| `section-start` | `section`（`document`または`history`） | セクションを開く。 |
| `attachments` | `items` | 要求したリソースの添付画像。`document`セクションで1回だけ送り、`section-start`の直後、最初のブロックの前に置く。`section-end`の`count`には数えない。 |
| `block` | `kind`（`markdown`または`mermaid`）、`text`、任意の`images` | ドキュメントの最上位のMarkdownブロック。ブロックを連結すると本文になる。各画像は`src`（`text`中のURL）を持ち、ファイルのヘッダーを読めたときは`width`と`height`も持つ。 |
| `acceptance` | `id`、`text`、`done` | 完了条件1件の全文。タスクのみ。ブロックの後に続く。 |
| `history-item` | `at`、`reason` | 履歴1件。古い順。タスクのみ。 |
| `section-end` | `section`、`count` | セクションを閉じる。`count`はそのセクションの項目行の数。 |
| `complete` | `versions` | 最後の行。`start`と同じ`versions`を繰り返す。どちらも1つのスナップショットから計算する。 |

順序は、`start`、要求した各セクションの`section-start`・項目・`section-end`、最後に`complete`です。`document`は`history`より前に置きます。タスクの`document`セクションは、ブロックの後に完了条件が続きます。エピックには`document`セクションしかありません。`complete`なしで終わったストリームは不完全であり、クライアントは受け取った内容を破棄します。

`?sections=document`、`?sections=history`、`?sections=document,history`でセクションを選びます。指定しなければ両方を送ります。エピックに`history`はありません。ほかの値は400 `invalid_sections`です。プロジェクト、タスク、エピックがなければ、ストリームの開始前に404を返します。最初の行の後で失敗したときは`complete`を送らず、接続を閉じます。

#### 変更イベント

`changed`は、変更されたリソースを運びます。

```json
{"instanceId": "inst-5f3a", "seq": 42, "projectId": "…", "changes": [
  {"resource": "task", "id": 302, "facets": ["summary", "request", "history"]},
  {"resource": "epic", "id": "EPIC-1", "facets": ["document"]},
  {"resource": "project", "id": "…", "facets": ["deleted"]}
]}
```

| フィールド | 意味 |
| --- | --- |
| `instanceId` | サーバーの起動ごとに1つの値。新しい値は、`seq`が最初からになったことをクライアントに伝える。 |
| `seq` | 1つのインスタンス内で、`changed`ごとに1ずつ増える整数。欠番はイベントを取り逃したことを表す。 |
| `projectId` | 変更が属するプロジェクト。ストリームは全プロジェクトを送り、画面は現在のプロジェクト以外を無視する。 |
| `changes[].resource` | `task`、`epic`、`project`（プロジェクト一覧の変化: 作成・名前の変更・削除）。 |
| `changes[].id` | タスクは整数、エピックとプロジェクトは文字列。 |
| `changes[].facets` | 重複のない、空でない一覧。`summary`はタイトル・状態・位置・エピック・判断待ちの質問・完了条件の件数。`request`はタスクが待っている質問が変わったこと（質問・回答・取り下げ・参照の追加や削除）。タスクだけで、必ず`summary`と一緒。`document`は本文と完了条件の文章。`history`は履歴。`deleted`はリソースが消えたこと。プロジェクトは`summary`か`deleted`だけ。タスクをアーカイブへ移す、または戻すことは`summary`の変更。 |

`seq`の欠番、新しい`instanceId`、未知のイベントを見たクライアントは、Summaryと関係するキャッシュ済みのDetailを破棄します。`ready`と`preferences`は変わりません。

サーバーは再読込のたびに解析済みデータを前後で比べるため、SummaryにもDetailにも見える内容が変わらない保存ではイベントを送りません。解析できないファイルは、そのリソースのすべてのfacetを変更とします。遅れすぎたストリームには、取りこぼしたイベントの代わりに`resync`（`{"instanceId", "seq"}`。`seq`は最新の番号）を送り、クライアントは全体を取得し直します。

### 張り付いたセッション

`GET /api/projects/{projectId}/sessions`は、プロジェクトを待っているエージェントセッションを返します。設定画面とフッターが使います。セッションの`wait --until task`コマンドが`/api/events`のストリームを開いている間、そのセッションは張り付いているとみなします。ほかの読み取りと同じく、ngrokの入口でもパスコードのセッションの内側で同じルートを使えます。パス、プロセスID、環境変数の値は含みません。

```json
{
  "sessions": [
    {
      "id": "claude:0a1b2c3d4e5f6071",
      "tool": "claude-code",
      "origin": "external",
      "connectedAt": "2026-11-19T01:00:00Z",
      "lastSeenAt": "2026-11-19T01:12:30Z",
      "state": "connected"
    }
  ],
  "counts": {
    "total": 1,
    "connected": 1,
    "byTool": { "claude-code": 1, "codex": 0, "unknown": 0 },
    "byOrigin": { "board": 0, "external": 1 }
  }
}
```

- `tool`は`claude-code`、`codex`、`unknown`のいずれかです。`origin`は、ボードが起動したセッションなら`board`、それ以外は`external`です。
- `state`は、ストリームが開いている間は`connected`、最後のストリームが閉じてから30秒間は`grace`です。待機から次の待機までの間に数がちらつかないようにするためです。`grace`のセッションも`total`などの数に含まれ、`connected`は開いているものだけを数えます。猶予が過ぎるとセッションは消えます。`lastSeenAt`は、接続中は現在時刻、`grace`では最後のストリームが閉じた時刻です。猶予の間に再接続したセッションは同じセッションとして扱い、最初の`connectedAt`を保ちます。
- セッションは`connectedAt`順に並びます。形式の誤ったプロジェクトIDは422 `invalid_value`です。セッションがないプロジェクト（存在しないプロジェクトも）は空のリストを返します。
- 登録はサーバーのメモリにだけ置きます。再起動すると空になり、待機が再接続するたびに戻ります。一覧はリクエストのたびに読みます。UIはポーリングし、変更を知らせるイベントはありません。

ストリームがセッションを名乗る方法は次のとおりです。タスクを待つコマンドは、`GET /api/events`のリクエストに4つのヘッダーを付けます。正しい組がないストリームは、数えられないだけで、通常どおり使えます。

| ヘッダー | 値 |
| --- | --- |
| `X-Agboard-Session` | セッションのキー。`A-Z a-z 0-9 . _ : -`の1〜64文字。 |
| `X-Agboard-Session-Project` | プロジェクトのID。 |
| `X-Agboard-Session-Tool` | `claude-code`、`codex`、`unknown`のいずれか。 |
| `X-Agboard-Session-Origin` | `board`または`external`。 |

起動の上限は起動処理が持ちます。生きている子プロセスや待っている再起動があるときは起動を拒否し、起動処理が知らないボード起動元の待機を`SessionRegistry::check_board_launch()`が見つけたときも拒否します。ボードが起動したセッションは、2つのツールと全プロジェクトを通して全体で1つまでです。拒否の理由には、枠を持っているツールが入ります。外部のセッションには上限がなく、この上限の数にも入りません。`AGBOARD_SESSION_GRACE_MS`は、30秒の猶予を指定したミリ秒に置き換えます。テストで使います。

### セッションの起動

このルートは、ボードが起動する、画面を持たないセッションを起動・停止します（[張り付くセッションの起動](../concepts/agents.md#張り付くセッションの起動)を参照）。**起動したセッションは、無人で自動承認のまま動きます。** [ボードが起動するセッション](../concepts/security.md#ボードが起動するセッション)を参照してください。このルートは、[リモート接続](#リモート接続)のルートと同じく、ローカルのリスナーだけにあります。ngrokの入口は提供しません（404）。読み取りはローカルのページから行う必要があり、2つの書き込みはブラウザーの書き込みガードを通ります。形式が誤ったプロジェクトIDは422 `invalid_value`です。

| API | 内容 |
| --- | --- |
| `GET /api/projects/{projectId}/sessions/models?tool=` | `tool`は`claude-code`か`codex`です（ほかの値は422 `invalid_value`）。`{"models": [{"id", "label"}], "reason": null}`を返します。一覧を読めないときは`{"models": [], "reason": "<理由>"}`で、モデルを指定しない起動ではツールの既定のモデルを使います。コマンドがないときは409 `agent_cli_missing`です。 |
| `POST /api/projects/{projectId}/sessions/launch` | `{"tool": "claude-code" \| "codex", "model"?: string}`。`model`がない、空、または`"default"`のときは、ツールに任せます。プロジェクトの結び付いたフォルダでセッションを起動し、`{"launched": {"tool", "projectId", "model", "startedAt"}}`を返します。示していないモデルやモデル名でない値は422 `invalid_value`、存在しないプロジェクトは404 `project_not_found`、存在する結び付いたフォルダがないプロジェクトは409 `project_has_no_folder`、CLIがない・ログインしていないときは409 `agent_cli_missing`・`agent_cli_logged_out`、そのツールのセッションがすでに起動済みか、ボード起動として張り付いているときは理由付きの409 `session_launch_refused`、プロセスを起動できなかったときは500 `session_launch_failed`です。 |
| `PUT /api/projects/{projectId}/sessions/autostart` | `{"enabled": boolean, "tool"?: "claude-code" \| "codex", "model"?: string}`。サーバーと一緒にセッションを起動するかどうかと、どれを起動するか（このツール、このプロジェクト、このモデル）を保存します（`model`がない、空、または`"default"`のときは、ツールに任せます）。選択は全体で1つで、保存すると置き換わります。`enabled`が`true`のときは`tool`が必須です（ないとき、未知のツール、フラグに読めるモデルは422 `invalid_value`）。起動はせず、動いているセッションも止めません。`{"autoStart": {"tool", "projectId", "model"}}`を返し、`enabled`が`false`のときは`{"autoStart": null}`です。存在しないプロジェクトは404 `project_not_found`、存在する結び付いたフォルダがないときは409 `project_has_no_folder`です。保存するファイルは[共有ファイル](./files.md#セッションの自動起動)にあります。 |
| `POST /api/projects/{projectId}/sessions/stop` | `{}`。起動済みのセッションを止めます。全体で1つなので、リクエストにツールは要りません（本文の`tool`は受け付けて無視します）。呼び出しが返った時点で`{"stopped": true}`を返し、動いていなかったときは`{"stopped": false}`です。待っている再起動や表示中の失敗も消します。セッションは数えられなくなるので、すぐに新しく起動できます。 |

`GET /api/projects/{projectId}/sessions`は、そのプロジェクトで起動処理がプロセスを持っているセッションを、`launched`として`[{"tool", "projectId", "model", "startedAt"}]`の形でも返します。プロセスIDは含みません。起動したセッションは、ドライバーが最初のイベントを報告すると`sessions`に（`origin: "board"`、`id`は`resident:`に起動IDを続けたもので）現れます。ボードを待たないので、サーバーがレジストリの一覧と数に加えます。`state`は、ターンの合間は`connected`、作業中は`grace`です。外部のセッションはこれまでどおり、待機で一覧に載り、数えられます。

#### セッションの健全性

`GET /api/projects/{projectId}/sessions`は、`health`も返します。ボードのセッションの枠は1つなので、オブジェクト1つです。プロジェクトではなくボードに属するので、`projectId`でどのプロジェクトのセッションかを示します。パスやプロセスIDは含みません。

```json
"health": {
  "tool": "claude-code",
  "state": "restarting",
  "projectId": "0123456789abcdef0123456789abcdef",
  "model": "sonnet",
  "reason": "The claude-code session exited (signal: 9 (SIGKILL)).",
  "waiting": false,
  "pushStalled": [],
  "restartCount": 2,
  "lastExitAt": "2026-11-19T03:00:00Z",
  "nextRestartAt": "2026-11-19T03:00:04Z",
  "autoStart": { "tool": "claude-code", "projectId": "0123456789abcdef0123456789abcdef", "model": "sonnet" }
}
```

何も起動していないときは`{"tool": null, "state": "stopped", "projectId": null, "model": null, "reason": null, "waiting": false, "pushStalled": [], "restartCount": 0, "lastExitAt": null, "nextRestartAt": null, "autoStart": null}`です（選択が保存されていれば`autoStart`が入ります）。

| 項目 | 意味 |
| --- | --- |
| `tool` | ボードが動かし続けているセッションのツールです。`stopped`のときは`null`です。 |
| `state` | `running`はボードがセッションを動かし続けていて、子プロセスがある状態です。`restarting`は子プロセスが終了し、`nextRestartAt`に再起動が待っている状態です。`failed`はボードが諦めた、またはセッションを起動できなかった状態で、`reason`に理由があります。`stopped`は何も動かし続けていない状態です。 |
| `projectId`、`model` | ボードが起動し直す対象です。`stopped`のときは`null`です。 |
| `reason` | `restarting`または`failed`の理由です。それ以外は`null`です。クラッシュの繰り返しは、再起動をやめたと伝える理由付きの`failed`で終わります。 |
| `waiting` | セッションが張り付いていて、2つのターンの合間にいて、ボードが仕事を渡せる間は`true`です。`running`で`waiting: false`のセッションは作業中で、そのことを理由に終了されることはありません。 |
| `pushStalled` | ボードがセッションへ何度も押し込んだのに処理されず、あきらめた項目を、1件ずつ`{"kind", "id", "attempts", "lastError"}`の形で並べます。`kind`は`request`、`answer`、`task`のいずれかで、`id`は依頼や質問のID（`Q-3`など）、またはテキストにしたタスク番号です。`attempts`は押し込んだ回数、`lastError`は直前に失敗したターンのメッセージで、なければ`null`です。なければ空です。項目がボードから消えると一覧からも消えます。[pushモード](../concepts/agents.md#push-mode)を参照。 |
| `restartCount` | 人が最後に起動または停止してからの再起動の回数です。 |
| `lastExitAt` | 人が止めたのではなく、子プロセスが最後に終了した時刻です。一度もなければ`null`です。 |
| `nextRestartAt` | 待っている再起動が始まる時刻です。`restarting`以外は`null`です。 |
| `autoStart` | 保存済みの自動起動の選択`{"tool", "projectId", "model"}`、または`null`です。 |

既定の値は[張り付くセッションの起動](../concepts/agents.md#張り付くセッションの起動)にあります。`failed`や`restarting`のときに人が起動すると、受け付けて最初からやり直し、停止するとそのツールは`stopped`に戻ります。

### リモート接続

これらの経路はローカルのリスナー（`127.0.0.1`）にだけあり、ngrokの入口は配信しません。読み取りはローカルのページからでなければならず、別のHost、クロスサイトの`Sec-Fetch-Site`、別のOriginは403です。書き込みは、ほかの書き込みと同じブラウザの書き込みガードを通ります。

| API | 入出力と動作 |
| --- | --- |
| `GET /api/monitor-connections` | 現在の状態（下記）。秘密の値は含まない。 |
| `PUT /api/monitor-connections/settings/ngrok` | `{enabled, revision, domain?}`を保存し、状態を返す。`revision`は最後に読んだ値でなければならない。`domain`は省略でき、省略すると保存済みのドメインを保つ。空文字列で消去する。それ以外はホスト名だけ（スキーム、パス、ポート、ワイルドカードは不可）で、小文字にして保存する。違反は422 `invalid_domain`。未知のフィールドは422 `invalid_value`、古いrevisionは409 `revision_conflict`、保存の失敗は500 `save_failed`で何も変えない。トンネルが動いている間に保存しても作り直さない。作り直すのは開始だけ。 |
| `POST /api/monitor-connections/transports/ngrok/start` | 接続を開始し、202で状態（通常は`starting`）を返す。任意の本文は`{token, save}`。`token`はメモリーだけに保持する。`save: true`はこのPCの安全な保管場所（OSの資格情報ストア）にも保存し、`token`が必要。無効な設定は、先に有効として保存する。トンネルが動いている間の開始は、トンネルを作り直す（合言葉も新しくなる）。 |
| `POST /api/monitor-connections/transports/ngrok/stop` | 接続を停止して無効として保存し、200で状態を返す。 |
| `GET /api/monitor-connections/devices` | 登録済みの端末を、最後に使われたものが先頭の順で返す。`{"devices":[{"id","label","createdAt","lastSeenAt"}]}`。トークンもそのダイジェストも含まない。接続が一時停止中でも使える。 |
| `DELETE /api/monitor-connections/devices/{id}` | 端末の登録を解除し、残りの端末を200で返す。その端末の有効なsessionと開いているイベントストリームはすぐに終わる。未知のidは404 `device_not_found`。一覧を保存できなければ何も変えず、500 `save_failed`を返す。 |
| `DELETE /api/monitor-connections/token` | 安全な保管場所に保存したトークンを削除し、200で状態を返す。何も保存していなくてもエラーにしない。 |

状態のオブジェクトは次のフィールドを持ちます。

| フィールド | 意味 |
| --- | --- |
| `status` | `disabled`・`needs_config`・`starting`・`ready`・`reconnecting`・`failed`・`stopping`のいずれか。 |
| `url` | `ready`のときの公開HTTPSアドレス。それ以外は`null`。 |
| `revision` | `PUT`に使う設定のrevision。 |
| `settings` | `enabled`と`domain`（保存したngrokのドメイン。なければ`null`）。 |
| `domainEnv` | 環境変数`AGBOARD_NGROK_DOMAIN`のドメイン。なければ`null`。設定されているとき、開始は`settings.domain`の代わりにこれを使う。 |
| `tokenConfigured` | 開始したときにトークンが見つかるか。 |
| `tokenSource` | `env`（`NGROK_AUTHTOKEN`）、`keychain`（安全な保管場所）、`session`（今回の起動だけ入力）、`null`のいずれか。値は返さない。 |
| `keychainAvailable` | このPCに、トークンを保存できる安全な保管場所（OSの資格情報ストア）があるか。 |
| `keychainTokenSaved` | 別の取得元が使われていても、安全な保管場所にトークンが保存されているか。 |
| `failure` | `null`、または`connect_failed`・`endpoint_failed`・`public_url_invalid`・`internal`・`config_unreadable`・`config_invalid`のいずれか。 |
| `passcode` | 動いている接続の4桁の合言葉。PCが表示するために返す。`status`が`ready`の間だけ含まれ、開始中・停止中・失敗のときは含まれない。このAPIが返す唯一の秘密。 |

開始の進み具合はこの状態で報告されます。`status`が`starting`でなくなるまで`GET`で確認してください。トークン、間違いの回数、sessionが、応答や設定ファイルに現れることはなく、合言葉が現れるのはここと`serve`の起動行だけです。設定の保存先は[共有ファイル](./files.md#モニター接続の設定)、エラーのコードは[エラーコード](./errors.md#リモート接続)にあります。

### 表示設定

`GET`と`PUT /api/preferences`はローカルのリスナーにあります。ngrokの入口は、同じ組をsessionの背後で提供します（[入口のルート](./remote-routes.md)を参照）。保存先のファイルは[共有ファイル](./files.md#表示設定)で説明しています。

`PUT`は、`locale`（`en`か`ja`）・`theme`（`{"mode": "light" | "dark", "accent": <12色のいずれか>}`）・両方のいずれかをJSONで受け取ります。送らなかった項目は、保存済みの値を保ちます。

```json
{"locale": "ja", "theme": {"mode": "dark", "accent": "teal"}}
```

保存に成功すると保存した内容を返し、開いているイベントストリームすべてに`preferences`イベントを送ります。対象は`/api/events`です。イベントのデータは`GET`と同じJSONです。PCの`PUT`は、ほかのPCの書き込みと同じ書き込みの保護（Host・Origin・`Sec-Fetch-Site: same-origin`・`X-Agboard-Token`）を通ります。ngrokの入口を通す`PUT`は、回答と同じくsessionとCSRFトークンが必要です。

JSONとして読めない本文は、ほかの書き込みと同じく400です。`locale`と`theme`のどちらもない本文、それ以外の項目を含む本文、許可されない値は422 `invalid_preferences`です。revisionの確認はなく、後から保存した内容が優先されます。

### スマホの通知設定

`GET`と`PUT /api/notification-settings`はローカルのリスナーにあります。ngrokの入口は、表示設定と同じく、この組をsessionの背後で提供します（[入口のルート](./remote-routes.md)を参照）。保存先のファイルは[共有ファイル](./files.md#スマホの通知設定)で説明しています。

`GET`は保存済みの設定を返します。何も保存していなければ、`revision`が`0`の既定値です。

```json
{
  "kinds": { "results": true, "questions": true, "history": false },
  "revision": 0
}
```

`PUT`は、`kinds`を持つJSONの本文を取ります。`kinds`はすべての項目（`results`・`questions`・`history`）を持つ必要があります。`GET`と同じ形を、`revision`を1増やして返します。書き込みの保護は`PUT /api/preferences`と同じです。

定期的な状況通知とカードの状態変化の通知は廃止しました。古いバージョンのまま開いているページがそれらの項目を送ることがあるため、`stateChanges`と`periodic`、および`kinds.stateChanges`は、受け取っても無視します。廃止した項目だけを持つ本文は、保存するものがないので422です。`GET`はそれらを返しません。

JSONとして読めない本文は400です。空の本文、未知の項目、足りない項目は422 `invalid_notification_settings`、書き込みの失敗は500 `notification_settings_unavailable`です。拒否した場合は何も保存しません。revisionの確認はなく、後から保存した内容が優先されます。

### プロジェクトのドキュメント

次のルートは、プロジェクトの`docs/`（`shared/projects/<projectId>/docs/`）にあるファイルを読みます。書き込むルートはなく、ファイルのルートへの`PUT`は405です。ボードのルーターにあり、ngrokの入口はsessionの背後で配信します。ただし`POST .../docs/open`はローカルのリスナーだけが配信します。ディスク上のドキュメントの変化は、`changed`ではなくSSEの`docs`イベントで知らせます（[変更の通知](../concepts/notifications.md#ドキュメント)を参照）。パスは`docs/`からの相対パスで、区切りは`/`です。検証の内容は[セキュリティモデル](../concepts/security.md#プロジェクトのドキュメント)にあります。プロジェクトIDが32文字の小文字16進数でないときは422 `invalid_value`です。

| API | 入出力と動作 |
| --- | --- |
| `GET …/docs/tree` | `docs/`の下のフォルダとファイルの名前だけを、`{nodes, truncated}`で返す。ファイルには`viewer`があり、`.md`と`.mdx`は`markdown`、`.png`・`.jpg`・`.jpeg`・`.webp`・`.gif`・`.avif`・`.svg`は`image`、それ以外は`other`（一覧には出すが表示しない）。フォルダには`viewer`がない。フォルダが先、ファイルが後で、それぞれ大文字・小文字を区別せずに名前順。ドットで始まる名前、シンボリックリンク、パスの規則で拒否される名前は含めない。フォルダがないときはエラーではなく空のツリー。一覧は最大5,000項目・16階層までで、上限で打ち切ったときは`truncated: true`。 |
| `GET …/docs/file?path=` | `{path, content, revision}`。`content`はファイルの原文そのもの（BOMも含む）。`revision`は`sha256:`とファイルのバイト列のSHA-256（16進数）で、画面はこれを比べてファイルが変わったかを判断する。対象は、`.md`と`.mdx`（大文字・小文字は問わない）で、2 MiB以下で、正しいUTF-8のファイルだけ。 |
| `GET …/docs/assets?path=` | 10 MiB以下のPNG・JPEG・WebP・GIF・AVIF・SVGの画像のバイト列。`Content-Type`は拡張子から決め（`image/png`・`image/jpeg`・`image/webp`・`image/gif`・`image/avif`・`image/svg+xml`）、`X-Content-Type-Options: nosniff`を付ける。SVGの応答には`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`も付けるので、URLを直接開いてもスクリプトは動かない。画面では`<img>`で表示するので、そこでもスクリプトは動かない。ほかの形式は415 `docs_asset_type`。 |
| `POST …/docs/open[?path=]` | 本文なし。サーバーを動かしているコンピュータで、プロジェクトの`docs/`をファイルマネージャで開く。`?path=`があるときは、そのファイルを、コンピュータがその種類に使うアプリで開く。macOSは`open`、Windowsは`explorer`、それ以外は`xdg-open`を使う。パスは読み込みと同じ方法で確かめ、存在するファイル（種類は問わない）であることを求める（400 `docs_path_invalid`、404 `docs_not_found`）。プログラムはシェルを通さず、フォルダかファイルだけを引数にして起動し、終了は待たない。成功すると204。プロジェクトがないときは404 `project_not_found`。`docs/`がない、またはプログラムを起動できない（たとえば`xdg-open`が入っていない）ときは500 `docs_open_failed`。プログラムを起動するので、ほかの書き込みと同じく書き込みガードを通る。 |

ツリーの例:

```json
{"nodes":[{"name":"design","path":"design","kind":"dir","children":[{"name":"images","path":"design/images","kind":"dir","children":[]},{"name":"spec.md","path":"design/spec.md","kind":"file","viewer":"markdown"}]},{"name":"flow.png","path":"flow.png","kind":"file","viewer":"image"},{"name":"app.pen","path":"app.pen","kind":"file","viewer":"other"},{"name":"README.md","path":"README.md","kind":"file","viewer":"markdown"}],"truncated":false}
```

ファイルの例:

```json
{"path":"design/spec.md","content":"---\ntitle: Design\n---\n# Design\n","revision":"sha256:b9dc9fdb…"}
```

失敗は通常のエラーの形式です。コードとステータスは[エラーコード](./errors.md#プロジェクトのドキュメント)にあります。

### multipartでタスクを作成する

`POST /api/projects/{projectId}/tasks/multipart`は、JSONの`metadata`パートを一つ、`file`パートを0件以上受け付けます。各ファイルには、`metadata.attachments`に対応する`{id, name}`が必要です。通常の添付枚数・サイズ・メディア形式の制限も適用されます。通常のタスクでは、`requestId`・`title`・`description`・`assignee`と任意の`draft`（新しいタスクでは`"human"`、編集では`"ai"`で、保存後もAIの下書きのままにする）を指定します。簡易依頼フォームの場合は次のように送ります。

```json
{
  "requestKind": "simple",
  "description": "1行目をタイトルに使います\n\n依頼の詳細",
  "epicId": "DESIGN",
  "attachments": [{"id": "<画像ID>", "name": "sketch.png"}]
}
```

`epicId`と`attachments`は任意です。エピックがない場合は省略するか`null`、画像がない場合は空配列にします。簡易依頼では`title`・`assignee`・`draft`・`finalize`を指定できません。サーバーはAI担当・Todoのタスクを作り、入力本文を`## 元の依頼`で囲み、最初の空でない行（Unicode文字数で最大100文字）からタイトルを作ります。プロジェクトロック内でタスクと画像を検証・ステージングし、完成したタスクフォルダを一度にrenameして公開します。受け付けた送信は毎回新しいタスクになり、`201 {"task": …}`を返します。本文などの一致による重複判定はしません。メタデータを指定して作るタスクは従来どおり`POST /tasks`か通常のmultipart形式を使い、簡易依頼用の契約へ切り替わりません。

**一括アーカイブ。** 対象のIDは確認を開いた時点で固定し、送信時にDoneのタスクを集め直すことはありません。ロックの中で、未アーカイブの対象がすべてまだDoneであることを確かめます。移動または削除された対象が一つでもあれば、要求全体を409 `archive_targets_changed`にして何も変えません。アーカイブ済みの対象は完了済みとして扱うので、応答を失った後の再送で履歴は重複しません。対象は一件ずつ保存し、最後に一回だけ再読み込みと通知を行います。途中で保存に失敗すると、保存済みの対象はアーカイブされたまま残り、再送で残りを処理します。

**エラー**は`code`・`message`・`reason`を持ちます。

| ステータス | 意味 |
| --- | --- |
| 400 | 壊れたJSON、不正な`sections`クエリ（`invalid_sections`）、または不正なドキュメントのパス（`docs_path_invalid`）。 |
| 403 | 保護に失敗した。または`ai_only`（人が質問を取り下げようとした）。 |
| 404 | プロジェクト・タスク・エピック・メッセージがない。またはドキュメントのファイルがない。 |
| 409 | `question_answered`・`question_withdrawn`・`message_closed`・`request_accepted`・`answer_accepted`・`question_open`・`request_withdrawn`・`task_status_changed`・`task_not_draft`・`ai_draft_needs_start`・`invalid_state_for_draft`・`epic_in_use`・`epic_id_taken`・`task_not_archived`・`archive_targets_changed`。 |
| 413 | 1 MiBを超える本文。または、上限を超えるドキュメントのファイル（`docs_too_large`）。 |
| 415 | Markdownでないドキュメントのファイル、または提供しない形式の画像（`docs_not_markdown`・`docs_asset_type`）。 |
| 422 | ID構文・入力・状態の規則の違反。UTF-8でないドキュメントのファイル（`docs_not_utf8`）。または、パス・項目・理由つきの正本ファイルの不備（`file_invalid`）。 |
| 503 | ロック待ちが時間切れになった。 |
| 500 | それ以外（`format_unsupported`・`file_unreadable`・`file_error`を含む）。 |

## 初回の案内

| メソッドとパス | 役割 |
| --- | --- |
| `GET /api/onboarding` | このデータ領域が案内を見たかどうか。`{ "formatVersion": 2, "status": "unseen" \| "completed" \| "skipped" }`。読み取りだけ。 |
| `POST /api/onboarding/seen` | 案内の終わり方を記録する。`{ "outcome": "completed" \| "skipped" }`。`GET`と同じ形を返す。あとからもう一度呼ぶと前の結果を置き換える。 |

書き込みは書き込みの保護を通ります。未知のフィールドがある、`outcome`がない、ほかの値が入っている本文は、`invalid_value`（422）で拒否します。どちらの経路もボードのルーターにあるため、ngrokの入口でも、ほかのボードの経路と同じようにセッションの内側で使えます。案内そのものはWeb UIの中で進み、サーバーはこの状態だけを保存します。[保存と復旧](../concepts/saving-and-recovery.md#初回案内の状態)を参照してください。
