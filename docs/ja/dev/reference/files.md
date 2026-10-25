# 共有ファイル

Agent Boardが保存するすべてのファイルを、項目と例とともに示します。ファイルの使われ方は[タスクと状態](../concepts/tasks-and-states.md)と[保存と復旧](../concepts/saving-and-recovery.md)にあります。

## タスク

タスクはボード上の作業の単位です。タスクの状態は`task.json`に、本文・受入条件・履歴は`TASK.md`にあります。

| 項目 | 規則 |
| --- | --- |
| `id` | 正の整数。ボード内で一意で、フォルダ名と一致する。 |
| `title` | 前後の空白を除いて1〜100文字、1行。 |
| `description` | frontmatterを含む`TASK.md`の全文。50,000文字の上限は本文だけを数える。CRLFはLFに正規化する。 |
| `body` | `description`からfrontmatterを除いた本文。見出し構成は自由。GitHub Flavored Markdownに対応。 |
| `acceptance`・`acceptanceError` | frontmatterの受入条件（不正なときは空）と、`acceptance`かYAML構文が不正かどうか。 |
| `assignee` | `ai`か`human`。作成時に決め、以後は変えない。 |
| `epicId` | 同じプロジェクトのEPIC-ID、または`null`。 |
| `taskStatus` | レーン。`todo`・`doing`・`done`。 |
| `position` | 正の整数。同じレーンの未アーカイブのタスク内で一意。 |
| `agentStatus` | AIの稼働状態。`idle`・`running`・`pending`。 |
| `isDraft` | 既定は`false`。人が準備中のタスク（下書き）。 |
| `pendingRequestId`・`pendingRequest` | Pendingの間の未回答の判断依頼。それ以外は`null`。 |
| `requestAnswers` | 再起動後も依頼IDで引けるよう保存する回答。 |
| `archivedAt` | `null`、またはアーカイブ日時。 |
| `attachments` | 画像のID・名前・サイズ・MIME型・作成日時。 |
| `simpleRequest` | 過去の簡易依頼フォームが保存した任意のメタデータ`{requestId, payloadHash}`。新規タスクでは保存・利用しない。 |
| `createdAt`・`updatedAt` | 作成日時と、取得時に`task.json`と`TASK.md`の更新日時の新しい方。 |
| `agentStatusChangedAt`・`taskStatusChangedAt` | 稼働状態の最後の変更と、レーンの最後の実際の変更。本文の編集・進捗の記録・同じレーンへの操作では`taskStatusChangedAt`は変わらない。 |
| `history` | `TASK.md`から読む。保存と応答は古い順。 |

文字数はUnicodeスカラー値で数えます。`assignee`（タスクの担当）は`actor`（操作した主体）とは別です。actorは権限を決め、履歴には保存しません。

## ディスク上のファイル

データ領域は、どのOSでもホームディレクトリの`.agent-board/`、または空でない`AGBOARD_HOME`です。ホームディレクトリを解決できなければ、作業フォルダで代用せずにコマンドが失敗します。

```text
<data-root>/
  shared/
    workspace.json
    projects/
      <project-id>/
        project.json
        README.md
        docs/<任意のフォルダ>/<名前>.md
        epics/<EPIC-ID>/{epic.json, EPIC.md, assets/<attachment-id>.<ext>}
        tasks/<task-id>/{task.json, TASK.md, assets/<attachment-id>.<ext>}
        .internal/write.lock
        .internal/transactions/<transaction-id>.json
  bindings.json
  serve.json
  serve.log
  lifecycle.lock
  .internal/monitor-connection.json
  .internal/preferences.json
```

- JSONはUTF-8・camelCase・2スペースのインデントで、末尾に改行を一つ付けます。未知の項目は拒否します。
- `workspace.json`は`{"format":"agboard-files","formatVersion":1}`です。`project.json`と`epic.json`は`formatVersion: 1`、`task.json`も`formatVersion: 1`を持ちます。対応するバージョンは1だけです。それ以外は`format_unsupported`を報告し、変更せずに残します。移行もフォールバックもしません。
- `.`で始まる名前は正本ではありません。`README.md`はフォルダと編集の規則の案内で、製品が作成時に書きます。
- 画像は所有者の`assets/`に置きます。本文からは`assets/<attachment-id>.<ext>`（または旧形式の`attachment:<id>`）で画像を参照します。画像はPNG・JPEG・WebP・GIFで、1件10 MiBまで、所有者ごとに20件・合計50 MiBまでです。
- `bindings.json`と`serve.json`はそのマシンだけで使うファイルです。`serve.json`（`{"pid":41235,"port":7420,"started_at":"..."}`）は、CLIに通知先を、`wait`に接続先を教えます。トークンは含みません。`serve.log`は`serve -d`で起動したサーバーの出力です（所有者のみ読み取り可、起動のたびに作り直し）。`agboard stop`は`serve.json`からサーバーを見つけます。

`docs/`には、プロジェクトのMarkdown文書を置きます。ドキュメントのダイアログが読み書きします（[プロジェクトのドキュメント](#プロジェクトのドキュメント)を参照）。

`project.json`は`formatVersion`・`id`・`name`・`createdAt`・`nextTaskId`・`defaultEpicsSeeded`を持ちます。`defaultEpicsSeeded`は、プロジェクトに既定のエピック`BUG`と`ENHANCEMENT`を用意済みのとき`true`になります。一度だけ書くので、削除された既定のエピックが作り直されることはありません。この項目がないファイルは`false`として読みます。`epic.json`は`formatVersion`・`id`・`name`・`color`・`isDraft`・`attachments`・`createdAt`・`updatedAt`を持ちます。

`EPIC.md`には、エピックの詳細をMarkdownで保存します。frontmatterを含み、frontmatterには作業順の`priority`（タスクIDのリスト）を置けます。APIと`epic show --json`は、全文を`document`、frontmatterを除いた本文を`body`、解析した作業順を`priority`として返します。以前のバージョンでは、このファイルを`PLAN.md`と呼んでいました。プロジェクトを初めて読み込むと、`EPIC.md`へ名前が変わります（[データとバックアップ](../../guide/operations/data.md)を参照）。

`task.json`は次のような形です。

```json
{
  "formatVersion": 1,
  "id": 1,
  "title": "Implement the answer UI",
  "assignee": "ai",
  "epicId": null,
  "taskStatus": "todo",
  "agentStatus": "idle",
  "position": 1,
  "isDraft": false,
  "archivedAt": null,
  "pendingRequestId": null,
  "pendingRequest": null,
  "requestAnswers": [],
  "createdAt": "2026-10-10T00:00:00Z",
  "updatedAt": "2026-10-10T00:00:00Z",
  "agentStatusChangedAt": "2026-10-10T00:00:00Z",
  "taskStatusChangedAt": "2026-10-10T00:00:00Z",
  "attachments": []
}
```

- `pendingRequest`は`{question, choices}`で、choicesは`[{"id":"proceed","label":"Proceed"}]`のような形です。
- `requestAnswers`の各項目は`{requestId, actor, choiceId, choiceLabel, text, at}`です。`choiceId`と`choiceLabel`は両方`null`か両方設定、`text`は`null`か有効な回答で、選択と文の少なくとも一方があります。`requestId`は一意で、現在の`pendingRequestId`とは異なります。
- 過去の簡易依頼タスクには`simpleRequest`メタデータが残っている場合があります。互換性のため読み込みますが、新規タスクでは保存せず、再送の判定にも使いません。

`TASK.md`では`history`が必須です（`history: []`も有効）。新規タスクの入力では省略するか空のリストにでき、作成の入力に空でない履歴があれば拒否します。本文と受入条件の編集は最新の履歴を保ち、`edit --desc-file`は履歴を追加しません。直接編集で履歴を追記する場合は、既存の内容を保ち、`at`/`reason`の項目だけを追加します。ただし、日時の付与と原子的な追記を行うCLIの利用を推奨します。

```yaml
---
acceptance: []
history:
  - at: "2026-10-15T01:30:00Z"
    reason: "Verified the setup guide links and recorded the result in the task body."
---
```

プロジェクトは`shared/projects/<project-id>/`を複製してバックアップし、`serve`を止めてフォルダを戻して復元します。エクスポートやインポートのコマンドはありません。[データのガイド](../../guide/operations/data.md)を参照してください。

## モニター接続の設定

ngrokのモバイル接続は、秘密ではない設定を`<データ領域>/.internal/monitor-connection.json`に保存します。このファイルはアプリのもので、PCの設定画面と`serve`だけが書き、手で編集するものではありません。共有領域には含まれないため、プロジェクトのバックアップには入りません。所有者だけが読み書きできる権限（OSにある場合は`0600`）でatomicに置き換えます。

```json
{
  "formatVersion": 1,
  "revision": 3,
  "enabled": true
}
```

| フィールド | 規則 |
| --- | --- |
| `formatVersion` | 常に`1`。ほかの値、未知のフィールド、壊れたファイルは、設定を読めない（`config_unreadable`）扱いになる。PCの入口は動き続け、新しい設定を保存するとファイルが置き換わる。 |
| `revision` | 保存のたびに増える。設定APIが、別の画面での変更を検出するために使う。 |
| `enabled` | 次の`serve`で接続を再び始めるか。停止すると`false`で保存する。 |

ファイルには、ngrokのトークン、スマホの合言葉、session、CSRFトークンを入れません。利用者が保存を選んだトークンは、代わりにこのPCの安全な保管場所（OSの資格情報ストア。service `agent-board`、account `ngrok-authtoken`）に置きます。`monitor/config.json`はありません。

## 表示設定

保存した言語とカラーテーマは、`<データ領域>/.internal/preferences.json`にあります。このファイルはアプリのもので、PCの`PUT /api/preferences`とモニターの保存の経路だけが書き、手で書くことはありません。`shared/`にはないため、プロジェクトのバックアップには含まれません。所有者だけが読み書きできる権限（OSにある場合は`0600`）で、原子的に置き換えます。書き込みに失敗した場合は、以前のファイルをそのまま残します。

```json
{
  "formatVersion": 1,
  "revision": 4,
  "locale": "ja",
  "theme": {
    "mode": "dark",
    "accent": "teal"
  }
}
```

| 項目 | 規則 |
| --- | --- |
| `formatVersion` | 常に`1`。ほかの値、未知の項目、壊れたファイルは既定値として読み、次の保存でファイルを置き換える。 |
| `revision` | 何も保存していなければ`0`。保存するたびに1増える。 |
| `locale` | `en`か`ja`。既定は`en`。 |
| `theme.mode` | `light`か`dark`。既定は`light`。 |
| `theme.accent` | 12色のいずれか: `blue`・`sky`・`cyan`・`teal`・`green`・`lime`・`yellow`・`orange`・`red`・`pink`・`purple`・`gray`。既定は`blue`。 |

保存では、送った項目だけを変えます。ほかの項目は保存済みの値を保ちます。後から保存した内容が優先され、競合の確認はありません。このファイルには秘密の値を含みません。トークン、合言葉、sessionは入りません。

## タスクのJSONとスナップショット

CLI・Web API・Hookは、camelCaseの同じタスクの表現を使います。`task.json`のメタデータに、`history`・`description`・`body`・`acceptance`・`acceptanceError`、解決した`pendingReason`と`pendingChoices`、表示用の`updatedAt`、`epic`（`{id, name, color}`または`null`）を加えたものです。`pendingRequest`と`requestAnswers`が履歴に現れることはありません。待機する`state ... --request-json`は、解決した回答を別の`answer`で返します。

- スナップショットは、`project`・`version`・`cursor`・`epics`・`tasks`（それぞれ全履歴を持つ）・`problems`を一度の読み込みから返します。CLIのスナップショットは`nextTaskId`も含み、CLIのスナップショット・Hook・`wait`は`fetchedAt`を含みます。
- プロジェクト一覧は`projects`（id・name・createdAt）と`catalogVersion`を返し、タスクは含みません。
- `ls --all-projects --json`は、`catalogVersion`と、プロジェクトごとのスナップショットを名前順に返します。cursorはそれぞれのプロジェクトのものです。

`problems`は形式の不備を報告します。`[{ "file": "projects/<id>/tasks/12/TASK.md", "field": "acceptance[1].text", "reason": "The text must not be empty." }]`の形で、`field`は`frontmatter`・`acceptance[<index>].<key>`・`history`・`history[<index>].<key>`のいずれか、`file`は`shared/`からの相対パス、`reason`は英語です。不備が読み書きにどう影響するかは[保存と復旧](../concepts/saving-and-recovery.md#ファイルに不備があるとき)にあります。

## 初回の案内

- `shared/.internal/onboarding.json`: 案内の状態、リースの持ち主、実行中の run、直近のコマンド ID。[保存と回復](../concepts/saving-and-recovery.md)を参照してください。
- `tasks/<id>/task.json` の `onboardingSample`: `{ "runId": "<32 桁の小文字 hex>", "ordinal": 1 | 2 }`。案内のサンプルカードにだけ付きます。

## フォルダの紐付け

フォルダの紐付けは、実フォルダとProjectIdを対応づけ、Hookと`agboard progress`が作業フォルダが属するプロジェクトを識別できるようにします。端末ローカルのデータ領域にだけ保存し、共有領域や追跡ファイルには保存しません。ProjectIdを保存するので、名前変更に追従し、同じ名前で作り直したプロジェクトへは移りません。最も近い紐付け済みの祖先フォルダを使います。存在しないフォルダ・壊れた紐付け・削除済みのProjectIdは、説明つきのエラーにします。

## プロジェクトのドキュメント

`shared/projects/<project-id>/docs/`は、プロジェクトの文書のフォルダです。ボードではなく利用者のものです。ファイルには形式も`formatVersion`も項目もなく、Agent Boardは検証しません。

- **プロジェクトと一緒に作る。** `project create`と、プロジェクトを作るときの`init`は、新しいプロジェクトの一時フォルダの中に`docs/`と`README.md`を作り、それからフォルダを正式な名前に変えます。READMEは英語か日本語で、`.internal/preferences.json`のアプリの言語に合わせます（`ja`なら日本語、それ以外は英語）。文面は`src/docs/templates/`にあります。
- **起動時に補う。** `serve`は、`docs/`がないプロジェクトに`docs/`とREADMEを作ります。すでにあるフォルダには触れないので、利用者が消したREADMEは消えたままです。ここでの失敗は無視します。フォルダがなければ空のツリーとして読むためです。
- **プロジェクトと一緒に消える。** `project rm`はプロジェクトのフォルダを丸ごと削除し、`docs/`も消えます。退避はしません。既存のプロジェクトに対する`init`は`tasks/`と`epics/`だけを初期化するので、`docs/`は残ります。
- **ボードのデータではない。** 監視は`docs/`の下をすべて無視し、ファイルはプロジェクトの`version`に含まれません（[変更の通知](../concepts/notifications.md)を参照）。編集しても`changed`は送られません。
- **ドキュメントのルートからだけ読み書きする。** ツリーはフォルダとファイルを一覧にし、ファイルのルートは2 MiB以下のUTF-8の`.md`と`.mdx`ファイルを読み、保存します。画像のルートは10 MiB以下のPNG・JPEG・WebP・GIF・AVIF・SVGを返します。[Web API](./web-api.md#プロジェクトのドキュメント)を参照してください。
- **送られたとおりに保存する。** 保存は受け取ったバイト列をそのまま書きます。改行コード、BOM、末尾の改行、フロントマターは変えません。保存で指定する`revision`は、`sha256:`とそのバイト列のSHA-256（16進数）です。
