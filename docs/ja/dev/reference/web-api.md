# Web API

`agboard serve`のHTTP APIです。書き込みの保護を含むリクエストの処理は、[サーバーと画面](../concepts/server-and-ui.md)で説明しています。

タスクの書き込みでは、自動生成する履歴の言語を`X-Agboard-Language: en`または`ja`で指定できます。ボードとモニターは現在の画面言語を送ります。未指定・重複・未対応の値では、本文の言語に従います。そのリクエストで自動生成する文章だけが対象で、明示した理由と保存済みの履歴は変わりません。[履歴](../concepts/history-and-decisions.md#履歴)を参照してください。

## エンドポイント

| API | 入出力と動作 |
| --- | --- |
| `GET /` | 書き込み用トークンを`meta[name=agboard-token]`に埋め込んだHTML。 |
| `GET /api/projects` | `projects`（id・name・createdAt）と`catalogVersion`。タスクは含まない。0件でも200。 |
| `POST /api/projects/{projectId}/tasks` | title・body・acceptance・assignee・isDraftからTodo・Idleのタスクを作る。サーバーがfrontmatterを組み立てて検証する。201。 |
| `POST /api/projects/{projectId}/tasks/multipart` | 画像付きの通常タスク、または依頼本文・任意のエピック・画像をまとめた簡易依頼タスクを作る。下記を参照。 |
| `PATCH /api/projects/{projectId}/tasks/{id}` | **下書き**のタスクのtitle・body・acceptanceと任意の`finalize: true`を更新する。bodyだけならfrontmatterを、acceptanceだけなら本文を保つ。`description`と`body`の同時指定は422 `invalid_value`。後から保存した内容が優先される。下書きでなければ409 `task_not_draft`。 |
| `PUT /api/projects/{projectId}/tasks/{id}/draft` | `isDraft`を設定する。Runningのタスクは409 `invalid_state_for_draft`。 |
| `PUT /api/projects/{projectId}/tasks/{id}/epic` | `{epicId: string \| null}`。未知のEPIC-IDは404 `epic_not_found`。 |
| `POST /api/projects/{projectId}/tasks/{id}/move` | `taskStatus`と任意の`reason`。 |
| `POST /api/projects/{projectId}/tasks/{id}/answer` | `requestId`と任意の`choiceId`・`text`をロックの中で照合する。両方空は422、未知の選択肢は422 `request_choice_unknown`、依頼が変わっていれば409 `request_changed`。 |
| `POST /api/projects/{projectId}/tasks/{id}/agent-status` | 状態の規則の範囲で稼働状態を変える。画面から操作する機能はない。 |
| `DELETE /api/projects/{projectId}/tasks/{id}` | アーカイブ済みのタスクだけを削除する。それ以外は409 `task_not_archived`。204、すでにないときは404。 |
| `…/tasks/{id}/attachments`、`…/attachments/{attachmentId}` | タスクの画像（GET・POST・DELETE）。ProjectId・タスクID・添付IDで照合する。 |
| `GET`・`POST /api/projects/{projectId}/epics` | エピックの一覧と作成（id・name・color・isDraft・documentまたはbody）。`acceptance`の入力は受け付けない。201。 |
| `GET`・`PATCH`・`DELETE /api/projects/{projectId}/epics/{epicId}` | 取得、またはname・color・isDraft・documentまたはbody・priorityの更新。本文と未知のメタデータを保つ。`EPIC.md`→`epic.json`の順に保存する。`DELETE`は204を返す。そのエピックを名指ししているタスク（アーカイブ済みを含む）が一つでもあれば、409 `epic_in_use`で拒否する。 |
| `…/epics/{epicId}/attachments`、`…/{attachmentId}` | エピックの画像。 |
| `POST …/tasks/{id}/archive`、`POST …/tasks/{id}/restore` | 本文なし。すでにその状態のタスクに繰り返すと、変更せず同じタスクを返す。 |
| `POST …/tasks/archive-done` | `{ids: number[]}`。空・重複・不正なIDは422。`{tasks, archivedCount}`を返す。 |
| `GET /api/projects/{projectId}/archive` | 本文・全履歴・添付のメタデータを持つアーカイブ済みのタスクと、同じスナップショットの`epics`。各タスクの`epicId`は同じ応答の`epics`で解決する。エピックがないタスク、または存在しないエピックのタスクにはラベルを付けない。 |
| `GET /api/projects/{projectId}/summary` | ボードの一覧に使うデータ。プロジェクト、`version`、タスク、エピック、problemsを返し、本文は含めない。[SummaryとDetail](#summaryとdetail)を参照。 |
| `GET /api/projects/{projectId}/tasks/{id}/detail` | 1件のタスクの本文・受入条件・履歴をNDJSONのストリームで返す。アーカイブ済みのタスクも同じ方法で読む。 |
| `GET /api/projects/{projectId}/epics/{epicId}/detail` | 1件のエピックのドキュメントをNDJSONのストリームで返す。 |
| `GET /api/projects/{projectId}/docs/tree`<br>`GET`/`PUT /api/projects/{projectId}/docs/file`<br>`GET /api/projects/{projectId}/docs/assets`<br>`POST /api/projects/{projectId}/docs/open` | プロジェクトの`docs/`にあるMarkdown文書。フォルダのツリー、1つのファイル、保存、画像、フォルダを開く操作。[プロジェクトのドキュメント](#プロジェクトのドキュメント)を参照。 |
| `GET /assets/{name}` | `build.rs`が生成した表にある、内容から名前を付けたスクリプトとスタイルシートだけ。ほかは404。immutableでキャッシュする。`Accept-Encoding`が許せばgzipで送り、`Vary: Accept-Encoding`を付ける。 |
| `GET /docs-sandbox`<br>`GET /docs-sandbox/{name}` | 文書のMDXを実行するページと、内容から名前を付けたそのスクリプト（ほかの名前は404）。トークンもボードのデータも持たない固定のページ。専用の`Content-Security-Policy`（`default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`）と`X-Content-Type-Options: nosniff`を付ける。ボードは`sandbox="allow-scripts"`のiframeで埋め込む。ボードのルーターだけにあり、モニターにはない。[ドキュメントのMDX](../concepts/security.md#ドキュメントのmdx)を参照。 |
| `GET /api/events` | SSE。購読後にボードのビルドIDを含む`ready`（`{"build":"<16桁の16進数>"}`）、変更されたリソースを運ぶ`changed`（[変更イベント](#変更イベント)を参照）、保存した言語やテーマが変わったときに`preferences`（`GET /api/preferences`と同じJSON）、15秒ごとに接続維持のコメント。 |
| `GET /api/preferences` | 保存済みの言語とカラーテーマ。`locale`・`theme`（`mode`・`accent`）・`revision`。ファイルがない、または読めない場合は既定値。キャッシュしない。[表示設定](#表示設定)を参照。 |
| `PUT /api/preferences` | JSONの本文で`locale`・`theme`・両方のいずれかを保存し、`GET`と同じ形を、`revision`を1増やして返す。未知の項目と不正な値は422 `invalid_preferences`、書き込みの失敗は500 `preferences_unavailable`。拒否・失敗のときは保存済みの値を変えない。 |
| `POST /api/notify` | 全クライアントに再取得を促す。データを変えず、トークンも不要。204。 |
| `GET /api/health` | `ok`と`pid`。 |
| `GET /api/monitor-connections`とその配下の経路 | ngrokのモバイル接続。[モバイル接続](#モバイル接続)を参照。 |

### SummaryとDetail

ボードとモニターは、プロジェクトを2段階で読みます。Summaryは、カードや一覧の行に表示する内容をまとめて返します。Detailは、カードやエピックを開いたときにだけ必要な内容をストリームで返します。モバイルモニターには同じ契約を`/monitor/api/projects/{projectId}/…`で提供し、モニターのセッションを必要とします。[モニターの経路](./remote-routes.md)を参照してください。パスのプロジェクトIDは読む対象の指定であり、アクセス権ではありません。

以下の形は、`src/server/contracts/`のRustの型と、`tests/fixtures/data-layer/`のゴールデン例で固定します。RustとTypeScriptのテストは、同じゴールデン例を読みます。

**Summary。** `GET …/summary`は、`project`（`id`・`name`）、`version`、`tasks`、`epics`、`problems`を返します。本文、受入条件の文章、履歴、エピックのドキュメント、画像のバイト列は含みません。応答はインデックスの投影から作るため、ファイルは読みません。アーカイブ済みのタスクは一覧に含めません（エピックの件数には数えます）。`version`は解析済みデータのハッシュで、`ETag`（`"<version>"`）にもなります。`If-None-Match`がこの値を指す要求（複数の値、弱い形式、`*`も一致）には、本文なしの`304`を返します。存在しないプロジェクトは404 `project_not_found`、形式の誤ったIDは422 `invalid_value`、`project.json`を読めないプロジェクトはそのファイルのエラーです。

| 項目 | フィールド |
| --- | --- |
| タスク | `id`（整数）、`title`、`taskStatus`、`agentStatus`、`assignee`、`isDraft`、`position`、`epicId`（なければ`null`）、`acceptance`（`done`・`total`）、`acceptanceError`、`createdAt`、`updatedAt`、`taskStatusChangedAt`、`agentStatusChangedAt`、`pendingRequestId`、`pendingReason`、`pendingChoices`、`onboardingSample`（案内のサンプルのみ）、`detailVersions`（`document`・`history`）。名前はボードの`Task`と同じ。 |
| エピック | `id`（文字列）、`name`、`color`、`isDraft`、`priority`（エピックが定める順序のタスクID。定めなければ空）、`priorityError`（保存された順序を読めないため、`priority`は無視する）、`progress`（`todo`・`doing`・`done`・`archived`・`total`）、`detailVersions`（`document`）。 |
| Problem | `file`・`field`・`reason`。ボードと同じ。 |

versionはすべて不透明な文字列で、解析済みデータの内容ハッシュです。サーバーの起動回に依存しないため、再起動後も保存済みの値と比べられます。versionは等しいかどうかだけを比べてください。

**Detail。** `GET …/tasks/{id}/detail`と`GET …/epics/{epicId}/detail`は、`Content-Type: application/x-ndjson`と`Cache-Control: no-store`つきの`200`を返します。各行は1つのJSONオブジェクトで、`type`がイベントを表します。

| `type` | フィールド | 意味 |
| --- | --- | --- |
| `start` | `resource`（`task`または`epic`）、`id`、`projectId`、`sections`、`versions` | 最初の行。`versions`は要求したセクションだけを持つ。 |
| `section-start` | `section`（`document`または`history`） | セクションを開く。 |
| `attachments` | `items` | 要求したリソースの添付画像。`document`セクションで1回だけ送り、`section-start`の直後、最初のブロックの前に置く。`section-end`の`count`には数えない。 |
| `block` | `kind`（`markdown`または`mermaid`）、`text`、任意の`images` | ドキュメントの最上位のMarkdownブロック。ブロックを連結すると本文になる。各画像は`src`（`text`中のURL）を持ち、ファイルのヘッダーを読めたときは`width`と`height`も持つ。 |
| `acceptance` | `id`、`text`、`done` | 受入条件1件の全文。タスクのみ。ブロックの後に続く。 |
| `history-item` | `at`、`reason` | 履歴1件。古い順。タスクのみ。 |
| `section-end` | `section`、`count` | セクションを閉じる。`count`はそのセクションの項目行の数。 |
| `complete` | `versions` | 最後の行。`start`と同じ`versions`を繰り返す。どちらも1つのスナップショットから計算する。 |

順序は、`start`、要求した各セクションの`section-start`・項目・`section-end`、最後に`complete`です。`document`は`history`より前に置きます。タスクの`document`セクションは、ブロックの後に受入条件が続きます。エピックには`document`セクションしかありません。`complete`なしで終わったストリームは不完全であり、クライアントは受け取った内容を破棄します。

`?sections=document`、`?sections=history`、`?sections=document,history`でセクションを選びます。指定しなければ両方を送ります。エピックに`history`はありません。ほかの値は400 `invalid_sections`です。プロジェクト、タスク、エピックがなければ、ストリームの開始前に404を返します。最初の行の後で失敗したときは`complete`を送らず、接続を閉じます。

#### 変更イベント

`changed`は、変更されたリソースを運びます。

```json
{"instanceId": "inst-5f3a", "seq": 42, "projectId": "…", "changes": [
  {"resource": "task", "id": 302, "facets": ["summary", "history"]},
  {"resource": "epic", "id": "EPIC-1", "facets": ["document"]},
  {"resource": "project", "id": "…", "facets": ["deleted"]}
]}
```

| フィールド | 意味 |
| --- | --- |
| `instanceId` | サーバーの起動ごとに1つの値。新しい値は、`seq`が最初からになったことをクライアントに伝える。 |
| `seq` | 1つのインスタンス内で、`changed`ごとに1ずつ増える整数。欠番はイベントを取り逃したことを表す。 |
| `projectId` | 変更が属するプロジェクト。モニターのストリームは、要求したプロジェクトの変更だけを送る。PCのストリームは全プロジェクトを送り、画面は現在のプロジェクト以外を無視する。 |
| `changes[].resource` | `task`、`epic`、`project`（プロジェクト一覧の変化: 作成・名前の変更・削除）。 |
| `changes[].id` | タスクは整数、エピックとプロジェクトは文字列。 |
| `changes[].facets` | 重複のない、空でない一覧。`summary`はタイトル・状態・位置・エピック・Pendingの質問・受入条件の件数。`document`は本文と受入条件の文章。`history`は履歴。`deleted`はリソースが消えたこと。プロジェクトは`summary`か`deleted`だけ。タスクをアーカイブへ移す、または戻すことは`summary`の変更。 |

`seq`の欠番、新しい`instanceId`、未知のイベントを見たクライアントは、Summaryと関係するキャッシュ済みのDetailを破棄します。`ready`と`preferences`は変わりません。

サーバーは再読込のたびに解析済みデータを前後で比べるため、SummaryにもDetailにも見える内容が変わらない保存ではイベントを送りません。解析できないファイルは、そのリソースのすべてのfacetを変更とします。遅れすぎたストリームには、取りこぼしたイベントの代わりに`resync`（`{"instanceId", "seq"}`。`seq`は最新の番号）を送り、クライアントは全体を取得し直します。モニターのストリームは送るイベントに自分で番号を振るため、ほかのプロジェクトの変更で`seq`に欠番は生じず、`project`の変更も送りません。

### モバイル接続

これらの経路はローカルのリスナー（`127.0.0.1`）にだけあり、ngrokの入口は配信しません。読み取りはローカルのページからでなければならず、別のHost、クロスサイトの`Sec-Fetch-Site`、別のOriginは403です。書き込みは、ほかの書き込みと同じブラウザの書き込みガードを通ります。

| API | 契約 |
| --- | --- |
| `GET /api/monitor-connections` | 現在の状態（下記）。秘密の値は含まない。 |
| `PUT /api/monitor-connections/settings/ngrok` | `{enabled, revision}`を保存し、状態を返す。`revision`は最後に読んだ値でなければならない。未知のフィールドは422 `invalid_value`、古いrevisionは409 `revision_conflict`、保存の失敗は500 `save_failed`で何も変えない。トンネルが動いている間に保存しても作り直さない。作り直すのは開始だけ。 |
| `POST /api/monitor-connections/transports/ngrok/start` | 接続を開始し、202で状態（通常は`starting`）を返す。任意の本文は`{token, save}`。`token`はメモリーだけに保持する。`save: true`はこのPCの安全な保管場所（OSの資格情報ストア）にも保存し、`token`が必要。無効な設定は、先に有効として保存する。トンネルが動いている間の開始は、トンネルを作り直す（合言葉も新しくなる）。 |
| `POST /api/monitor-connections/transports/ngrok/stop` | 接続を停止して無効として保存し、200で状態を返す。 |
| `DELETE /api/monitor-connections/token` | 安全な保管場所に保存したトークンを削除し、200で状態を返す。何も保存していなくてもエラーにしない。 |

状態のオブジェクトは次のフィールドを持ちます。

| フィールド | 意味 |
| --- | --- |
| `status` | `disabled`・`needs_config`・`starting`・`ready`・`reconnecting`・`failed`・`stopping`のいずれか。 |
| `url` | `ready`のときの公開HTTPSアドレス。それ以外は`null`。 |
| `revision` | `PUT`に使う設定のrevision。 |
| `settings` | `enabled`。 |
| `tokenConfigured` | 開始したときにトークンが見つかるか。 |
| `tokenSource` | `env`（`NGROK_AUTHTOKEN`）、`keychain`（安全な保管場所）、`session`（今回の起動だけ入力）、`null`のいずれか。値は返さない。 |
| `keychainAvailable` | このPCに、トークンを保存できる安全な保管場所（OSの資格情報ストア）があるか。 |
| `keychainTokenSaved` | 別の取得元が使われていても、安全な保管場所にトークンが保存されているか。 |
| `failure` | `null`、または`connect_failed`・`endpoint_failed`・`public_url_invalid`・`internal`・`config_unreadable`・`config_invalid`のいずれか。 |
| `passcode` | 動いている接続の4桁の合言葉。PCが表示するために返す。`status`が`ready`の間だけ含まれ、開始中・停止中・失敗のときは含まれない。このAPIが返す唯一の秘密。 |

開始の進み具合はこの状態で報告されます。`status`が`starting`でなくなるまで`GET`で確認してください。トークン、間違いの回数、sessionが、応答や設定ファイルに現れることはなく、合言葉が現れるのはここと`serve`の起動行だけです。設定の保存先は[共有ファイル](./files.md#モニター接続の設定)、エラーのコードは[エラーコード](./errors.md#モバイル接続)にあります。

### 表示設定

`GET`と`PUT /api/preferences`はローカルのリスナーにあります。ngrokのモニターには、同じ組が`/monitor/api/preferences`にあります（[モニターのルート](./remote-routes.md)を参照）。保存先のファイルは[共有ファイル](./files.md#表示設定)で説明しています。

`PUT`は、`locale`（`en`か`ja`）・`theme`（`{"mode": "light" | "dark", "accent": <12色のいずれか>}`）・両方のいずれかをJSONで受け取ります。送らなかった項目は、保存済みの値を保ちます。

```json
{"locale": "ja", "theme": {"mode": "dark", "accent": "teal"}}
```

保存に成功すると保存した内容を返し、開いているイベントストリームすべてに`preferences`イベントを送ります。対象は、ボードの`/api/events`と、モニターの`/monitor/api/events`です。イベントのデータは`GET`と同じJSONです。PCの`PUT`は、ほかのPCの書き込みと同じ書き込みの保護（Host・Origin・`Sec-Fetch-Site: same-origin`・`X-Agboard-Token`）を通ります。モニターの`PUT`は、回答と同じくモニターのsessionとCSRFトークンが必要です。

JSONとして読めない本文は、ほかの書き込みと同じく400です。`locale`と`theme`のどちらもない本文、それ以外の項目を含む本文、許可されない値は422 `invalid_preferences`です。revisionの確認はなく、後から保存した内容が優先されます。

### プロジェクトのドキュメント

次のルートは、プロジェクトの`docs/`（`shared/projects/<projectId>/docs/`）にあるファイルを読み書きします。ボードのルーターにだけあり、モニターの入口では提供しません。ボードは変わりません。保存しても、プロジェクトの`version`は変わらず、SSEの`changed`も送りません。パスは`docs/`からの相対パスで、区切りは`/`です。検証の内容は[セキュリティモデル](../concepts/security.md#プロジェクトのドキュメント)にあります。プロジェクトIDが32文字の小文字16進数でないときは422 `invalid_value`です。

| API | 契約 |
| --- | --- |
| `GET …/docs/tree` | `docs/`の下のフォルダとファイルの名前だけを、`{nodes, truncated}`で返す。ファイルには`viewer`があり、`.md`と`.mdx`は`markdown`、`.png`・`.jpg`・`.jpeg`・`.webp`・`.gif`・`.avif`・`.svg`は`image`、それ以外は`other`（一覧には出すが表示しない）。フォルダには`viewer`がない。フォルダが先、ファイルが後で、それぞれ大文字・小文字を区別せずに名前順。ドットで始まる名前、シンボリックリンク、パスの規則で拒否される名前は含めない。フォルダがないときはエラーではなく空のツリー。一覧は最大5,000項目・16階層までで、上限で打ち切ったときは`truncated: true`。 |
| `GET …/docs/file?path=` | `{path, content, revision, readOnly}`。`content`はファイルの原文そのもの（BOMも含む）。`revision`は`sha256:`とファイルのバイト列のSHA-256（16進数）。`readOnly`はファイルの読み取り専用の属性。対象は、`.md`と`.mdx`（大文字・小文字は問わない）で、2 MiB以下で、正しいUTF-8のファイルだけ。 |
| `PUT …/docs/file` | 本文は`{path, content, expectedRevision}`。知らない項目は400 `invalid_json`。ファイルがまだ`expectedRevision`のときだけ、`content`をそのままのバイト列で書き、新しい`revision`を含む`{path, revision}`を返す。ほかの書き込みと同じ書き込みのガードを通る。ファイルを新しく作ることはない。 |
| `GET …/docs/assets?path=` | 10 MiB以下のPNG・JPEG・WebP・GIF・AVIF・SVGの画像のバイト列。`Content-Type`は拡張子から決め（`image/png`・`image/jpeg`・`image/webp`・`image/gif`・`image/avif`・`image/svg+xml`）、`X-Content-Type-Options: nosniff`を付ける。SVGの応答には`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`も付けるので、URLを直接開いてもスクリプトは動かない。画面では`<img>`で表示するので、そこでもスクリプトは動かない。ほかの形式は415 `docs_asset_type`。 |
| `POST …/docs/open` | 本文なし。サーバーを動かしているコンピュータのファイルマネージャで、プロジェクトの`docs/`を開く。macOSは`open`、Windowsは`explorer`、それ以外は`xdg-open`を使う。プログラムはシェルを通さず、フォルダだけを引数にして起動し、終了は待たない。成功すると204。プロジェクトがないときは404 `project_not_found`。`docs/`がない、またはプログラムを起動できない（たとえば`xdg-open`が入っていない）ときは500 `docs_open_failed`。ほかの書き込みと同じく書き込みガードを通る。 |

ツリーの例:

```json
{"nodes":[{"name":"design","path":"design","kind":"dir","children":[{"name":"images","path":"design/images","kind":"dir","children":[]},{"name":"spec.md","path":"design/spec.md","kind":"file","viewer":"markdown"}]},{"name":"flow.png","path":"flow.png","kind":"file","viewer":"image"},{"name":"app.pen","path":"app.pen","kind":"file","viewer":"other"},{"name":"README.md","path":"README.md","kind":"file","viewer":"markdown"}],"truncated":false}
```

ファイルの例:

```json
{"path":"design/spec.md","content":"---\ntitle: Design\n---\n# Design\n","revision":"sha256:b9dc9fdb…","readOnly":false}
```

保存では、読んだときの`revision`を指定します。

```json
{"path":"design/spec.md","content":"---\ntitle: Design\n---\n# Design\n\nEdited.\n","expectedRevision":"sha256:b9dc9fdb…"}
```

その後にファイルが変わっていたときは、何も書かずに409を返します。本文にはファイルの今の`revision`が入るので、画面はファイルを読み直さずに上書きの保存ができます。

```json
{"error":{"code":"docs_revision_conflict","currentRevision":"sha256:52bed404…","message":"the document changed since it was read.","reason":"Another change saved the file first (revision sha256:52bed404…). Reload it, or save again with the latest revision."}}
```

ほかの失敗は通常のエラーの形式です。コードとステータスは[エラーコード](./errors.md#プロジェクトのドキュメント)にあります。保存の仕組みと、防げないことは[保存と復旧](../concepts/saving-and-recovery.md#プロジェクトのドキュメント)にあります。

### multipartでタスクを作成する

`POST /api/projects/{projectId}/tasks/multipart`は、JSONの`metadata`パートを一つ、`file`パートを0件以上受け付けます。各ファイルには、`metadata.attachments`に対応する`{id, name}`が必要です。通常の添付枚数・サイズ・メディア形式の制限も適用されます。通常のタスクでは、`requestId`・`title`・`description`・`assignee`と任意の`isDraft`を指定します。簡易依頼フォームの場合は次のように送ります。

```json
{
  "requestKind": "simple",
  "description": "1行目をタイトルに使います\n\n依頼の詳細",
  "epicId": "DESIGN",
  "attachments": [{"id": "<画像ID>", "name": "sketch.png"}]
}
```

`epicId`と`attachments`は任意です。エピックがない場合は省略するか`null`、画像がない場合は空配列にします。簡易依頼では`title`・`assignee`・`isDraft`・`finalize`を指定できません。サーバーはAI担当・Todoのタスクを作り、入力本文を`## 元の依頼`で囲み、最初の空でない行（Unicode文字数で最大100文字）からタイトルを作ります。プロジェクトロック内でタスクと画像を検証・ステージングし、完成したタスクフォルダを一度にrenameして公開します。受け付けた送信は毎回新しいタスクになり、`201 {"task": …}`を返します。本文などの一致による重複判定はしません。手動で作る通常タスクは従来どおり`POST /tasks`か通常のmultipart形式を使い、簡易依頼用の契約へ切り替わりません。

**一括アーカイブ。** 対象のIDは確認を開いた時点で固定し、送信時にDoneのタスクを集め直すことはありません。ロックの中で、未アーカイブの対象がすべてまだDoneであることを確かめます。移動または削除された対象が一つでもあれば、要求全体を409 `archive_targets_changed`にして何も変えません。アーカイブ済みの対象は完了済みとして扱うので、応答を失った後の再送で履歴は重複しません。対象は一件ずつ保存し、最後に一回だけ再読み込みと通知を行います。途中で保存に失敗すると、保存済みの対象はアーカイブされたまま残り、再送で残りを処理します。

**エラー**は`code`・`message`・`reason`を持ちます。

| ステータス | 意味 |
| --- | --- |
| 400 | 壊れたJSON、不正な`sections`クエリ（`invalid_sections`）、または不正なドキュメントのパス（`docs_path_invalid`）。 |
| 403 | 保護に失敗した。または、ドキュメントのファイルが読み取り専用（`docs_read_only`）。 |
| 404 | プロジェクト・タスク・エピックがない。またはドキュメントのファイルがない。 |
| 409 | `docs_revision_conflict`・`request_changed`・`task_not_draft`・`invalid_state_for_draft`・`epic_in_use`・`epic_id_taken`・`task_not_archived`・`archive_targets_changed`。 |
| 413 | 1 MiBを超える本文（ドキュメントの保存は13 MiB。2 MiBの本文をJSONでエスケープしても収まる値）。または、上限を超えるドキュメントのファイル（`docs_too_large`）。 |
| 415 | Markdownでないドキュメントのファイル、または提供しない形式の画像（`docs_not_markdown`・`docs_asset_type`）。 |
| 422 | ID構文・入力・状態の規則の違反。UTF-8でないドキュメントのファイル（`docs_not_utf8`）。または、パス・項目・理由つきの正本ファイルの不備（`file_invalid`）。 |
| 503 | ロック待ちが時間切れになった。 |
| 500 | それ以外（`format_unsupported`・`file_unreadable`・`file_error`を含む）。 |

## 初回の案内

| メソッドとパス | 役割 |
| --- | --- |
| `GET /api/onboarding` | 案内の状態。読み取りだけ。 |
| `POST /api/onboarding/claim` | タブに案内を渡す。`clientId`、`expectedRevision`。 |
| `POST /api/onboarding/replay` | 完了またはスキップ済みの案内をもう一度提示する。`clientId`、`expectedRevision`。 |
| `POST /api/onboarding/heartbeat` | リースを延長する。`clientId`。 |
| `POST /api/onboarding/skip` | カードを作る前にスキップする。`clientId`、`expectedRevision`、`commandId`。 |
| `POST /api/onboarding/recover` | リースが切れた run を終了する。 |
| `POST /api/projects/{projectId}/onboarding/start` | run を始める。`clientId`、`attemptId`、`expectedRevision`、`locale`。同じ attempt の再送は同じ run を返す。 |
| `POST /api/projects/{projectId}/onboarding/{runId}/advance` | 手順を 1 つ進める。`clientId`、`expectedRevision`、`commandId`、`transition`。 |
| `POST /api/projects/{projectId}/onboarding/{runId}/finish` | run のカードをアーカイブし、案内を完了する。 |
| `POST /api/projects/{projectId}/onboarding/{runId}/abort` | run を途中で終え、カードをアーカイブする。 |

書き込みは write guard を通り、未知のフィールドは拒否されます。サンプルの質問への回答は、既存の `/api/projects/{projectId}/tasks/{id}/answer` を使います。
