# 共有ファイル

Agent Boardが保存するすべてのファイルを、項目と例とともに示します。ファイルの使われ方は[タスクと状態](../concepts/tasks-and-states.md)と[保存と復旧](../concepts/saving-and-recovery.md)にあります。

## タスク

タスクはボード上の作業の単位です。タスクの状態は`task.json`に、本文・完了条件・履歴は`TASK.md`にあります。

| 項目 | 規則 |
| --- | --- |
| `id` | 正の整数。ボード内で一意で、フォルダ名と一致する。 |
| `title` | 前後の空白を除いて1〜100文字、1行。 |
| `description` | frontmatterを含む`TASK.md`の全文。50,000文字の上限は本文だけを数える。CRLFはLFに正規化する。 |
| `body` | `description`からfrontmatterを除いた本文。見出し構成は自由（雛形は「背景」「やること」「進め方」「検証結果」の見出しを推奨しますが、検証はしません）。GitHub Flavored Markdownに対応。 |
| `acceptance`・`acceptanceError` | frontmatterの完了条件（不正なときは空）と、`acceptance`かYAML構文が不正かどうか。 |
| `assignee` | `ai`か`human`。作成時に決め、以後は変えない。 |
| `epicId` | 同じプロジェクトのEPIC-ID、または`null`。 |
| `taskStatus` | レーン。`todo`・`doing`・`done`。 |
| `position` | 正の整数。同じレーンの未アーカイブのタスク内で一意。 |
| `agentStatus` | AIの稼働状態。`task.json`には`idle`か`running`を保存します。TodoかDoingのAIタスクが人の判断待ちのとき、読み出すと`pending`になります（[メッセージ](../concepts/history-and-decisions.md#メッセージ)）。保存された`pending`は`idle`として読みます。 |
| `draft` | `null`・`"human"`・`"ai"`のいずれか。`human`は人がブラウザで書いている下書き、`ai`はエージェントが作った提案で、エージェントが、質問への回答がそろってから開始する（人も開始できる）。以前のバージョンのファイルは`isDraft`を持ち、`true`は`human`、`false`は`null`として読む。書き込みは`draft`だけを使う。エピックの場合、CLIの`epic edit`は`human`の下書きを`epic_is_draft`で拒否する。 |
| `questions` | `TASK.md`のfrontmatterにあり、タスクが参照するプロジェクトの質問のIDを`[Q-12, Q-15]`のように並べます。省略・`null`・空はどれも0件で、重複は拒否します。 |
| `requestAnswers` | 以前のAgent Boardが記録した回答。記録として残し、新しくは追加しません。 |
| `archivedAt` | `null`、またはアーカイブ日時。 |
| `attachments` | 画像のID・名前・サイズ・MIME型・作成日時。 |
| `results` | 依頼者に届けた成果。古いものから順に並び、ない場合は`[]`。[成果](#results)を参照。 |
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
        qa/Q-<n>/{QA.md, attachments/<name>}
        .internal/write.lock
        .internal/transactions/<transaction-id>.json
        .internal/batches/<batch-id>.json
  bindings.json
  serve.json
  serve.log
  resident/<tool>.log
  lifecycle.lock
  autostart.lock
  autostart.paused
  .internal/monitor-connection.json
  .internal/preferences.json
  .internal/resident-autostart.json
```

- JSONはUTF-8・camelCase・2スペースのインデントで、末尾に改行を一つ付けます。未知の項目は拒否します。
- `workspace.json`は`{"format":"agboard-files","formatVersion":1}`です。`project.json`と`epic.json`は`formatVersion: 1`、`task.json`も`formatVersion: 1`を持ちます。対応するバージョンは1だけです。それ以外は`format_unsupported`を報告し、変更せずに残します。移行もフォールバックもしません。
- `.`で始まる名前は正本ではありません。`README.md`はフォルダと編集の規則の案内で、製品が作成時に書きます。
- 画像は所有者の`assets/`に置きます。本文からは`assets/<attachment-id>.<ext>`（または旧形式の`attachment:<id>`）で画像を参照します。画像はPNG・JPEG・WebP・GIFで、1件10 MiBまで、所有者ごとに20件・合計50 MiBまでです。
- `bindings.json`と`serve.json`はそのマシンだけで使うファイルです。`serve.json`は、CLIに通知先を、`wait`に接続先を教えます。トークンは含みません。`agboard stop`もこのファイルからサーバーを見つけます。

  ```json
  {"pid":41235,"port":7420,"started_at":"2026-11-14T03:00:00Z","mode":"auto","idleTimeoutSeconds":1800}
  ```

  `mode`は、コマンドが起動したサーバーなら`auto`、`serve`と`serve -d`なら`manual`です。この項目がないファイルは`manual`として読みます。`idleTimeoutSeconds`は自動のサーバーだけが持ちます。
- `serve.log`は、`serve -d`かコマンドが裏で起動したサーバーの出力です（所有者のみ読み取り可、起動のたびに作り直し）。自動のサーバーは、別のポートを使った理由と止まったことをここに書きます。
- `resident/<ツール>.log`（`claude-code.log`または`codex.log`）は、そのツールのためにボードが起動したセッションの標準出力と標準エラーです（所有者のみ読み取り可、起動のたびに作り直し）。エージェントが出力した内容を含みうるので、あなたのアカウントで動くエージェントのほかの出力と同じように扱ってください。[張り付くセッションの起動](../concepts/agents.md#張り付くセッションの起動)を参照してください。
- `autostart.lock`は、同時にサーバーを起動しようとしたコマンドの順番を決めます。`autostart.paused`は`agboard stop`が残すファイルで、Hookがまたサーバーを起動しないようにします。待つコマンド、`serve`、`serve -d`がこれを消します。[サーバーと画面](../concepts/server-and-ui.md#serveの起動と停止)を参照してください。

`docs/`には、プロジェクトのMarkdown文書を置きます。ドキュメントのダイアログがこれを読みます（[プロジェクトのドキュメント](#プロジェクトのドキュメント)を参照）。

`project.json`は`formatVersion`・`id`・`name`・`createdAt`・`nextTaskId`・`nextQuestionId`・`defaultEpicsSeeded`を持ちます。`nextQuestionId`は次の質問の番号で、この項目がないファイルは`1`として読みます。`defaultEpicsSeeded`は、プロジェクトに既定のエピック`BUG`と`ENHANCEMENT`を用意済みのとき`true`になります。一度だけ書くので、削除された既定のエピックが作り直されることはありません。この項目がないファイルは`false`として読みます。`epic.json`は`formatVersion`・`id`・`name`・`color`・`isDraft`・`attachments`・`createdAt`・`updatedAt`を持ちます。

`EPIC.md`には、エピックの詳細をMarkdownで保存します。frontmatterを含み、frontmatterには作業順の`priority`（タスクIDのリスト）を置けます。APIと`epic show --json`は、全文を`document`、frontmatterを除いた本文を`body`、解析した作業順を`priority`として返します。

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
  "draft": null,
  "archivedAt": null,
  "requestAnswers": [],
  "createdAt": "2026-10-10T00:00:00Z",
  "updatedAt": "2026-10-10T00:00:00Z",
  "agentStatusChangedAt": "2026-10-10T00:00:00Z",
  "taskStatusChangedAt": "2026-10-10T00:00:00Z",
  "attachments": []
}
```

- `results`は、成果が1件以上あるタスクにだけ書きます。成果の仕組みができる前のファイルはそのままで、`results: []`として読みます。形式バージョンは1のままです。
- `requestAnswers`の各項目は`{requestId, actor, choiceId, choiceLabel, text, at}`です。`choiceId`と`choiceLabel`は両方`null`か両方設定、`text`は`null`か有効な回答で、選択と文の少なくとも一方があります。
- 以前の版が書いた`pendingRequestId`と`pendingRequest`は、読むときに無視し、次の保存では書きません。
- 過去の簡易依頼タスクには`simpleRequest`メタデータが残っている場合があります。互換性のため読み込みますが、新規タスクでは保存せず、再送の判定にも使いません。

`TASK.md`では`history`が必須です（`history: []`も有効）。新規タスクの入力では省略するか空のリストにでき、作成の入力に空でない履歴があれば拒否します。本文と完了条件の編集は最新の履歴を保ち、`edit --desc-file`は履歴を追加しません。また、保存済みの`questions`の参照を保ち、入力の`history`と`questions`は無視します。直接編集で履歴を追記する場合は、既存の内容を保ち、`at`/`reason`の項目だけを追加します。ただし、日時の付与と原子的な追記を行うCLIの利用を推奨します。

```yaml
---
acceptance: []
questions: [Q-12]
history:
  - at: "2026-10-15T01:30:00Z"
    reason: "Verified the setup guide links and recorded the result in the task body."
---
```

### 成果 {#results}

成果は、依頼者が見られるものとしてエージェントが`agboard result add`で届けるものです（[成果を届ける](../../guide/reference/cli.md#deliver-a-result)を参照）。成果は`TASK.md`ではなく`task.json`に保存します。クライアントが版を指定して読む構造化データだからです。`TASK.md`で時系列のテキストを持つのは、これまでどおり履歴だけです。`results`の各項目は次のとおりです。

| フィールド | 意味 |
| --- | --- |
| `version` | タスクごとに1から始まり、1ずつ増える正の整数。変わることも繰り返されることもないので、タスク・成果・版の3つで1回の配信を指せます。 |
| `key` | 再送のときに同じ配信かを見分ける値。エージェントが指定した`--key`（英数字と`.`、`_`、`:`、`-`で1〜64文字）、省略時は種別・要約・リンク・画像のバイト列から作る16進32桁。タスク内で一意です。 |
| `kind` | 途中の成果は`progress`、完成したものは`final`。 |
| `summary` | 1〜2,000文字の文章。 |
| `attachmentId` | 任意。タスクの`attachments`にある画像のID。ファイルは添付画像のルートから読みます。成果が使っている画像は削除できません。 |
| `link` | 任意。主な成果物のURLまたは保存場所。1行で1〜2,000文字。指定したまま保存し、Agent Boardが開くことはありません。 |
| `at` | 成果を記録したUTC時刻。 |

成果を記録しても、`taskStatus`と`agentStatus`は変わりません。プロジェクトのロックの下で、画像があれば先に書き、そのあと`task.json`と`TASK.md`を、履歴1件と一緒に保存します。保存に失敗したときは画像ファイルを消し、項目も残らないため、失敗した保存が届ける対象になることはありません。同じキーが同じ内容ですでにあるときは、何も書かず、既存の項目を返します。1つのタスクに残せる成果は100件までです。

## メッセージ

AIから人への質問と、人からAIへの依頼は、どちらも`qa/Q-<n>/QA.md`という1つのファイルに保存します。YAMLのfrontmatterのあとに、本文としてMarkdownのテキストが続きます。依頼に添えた画像は`qa/Q-<n>/attachments/`に置きます。質問と依頼は`project.json`の`nextQuestionId`から採る1つの連番を共有するので、`Q-<n>`はどちらの種類でもプロジェクト内で一意です。フォルダ名がそのままIDです。

質問の例です。

```markdown
---
from: ai
to: human
tasks: [12]
choices:
  - { id: delete, label: 削除する }
  - { id: keep, label: 残す }
recommended: keep
askedBy: resident-3f9a1c0e5b7d2a46
reply:
  choice: keep
  via: ui
  at: 2026-11-14T02:41:10Z
  acceptedAt: 2026-11-14T02:50:00Z
createdAt: 2026-11-14T02:30:00Z
---
既存のレコードは削除しますか、残しますか。
```

依頼の例です。

```markdown
---
from: human
to: ai
acceptedAt: 2026-11-14T03:10:00Z
createdAt: 2026-11-14T03:00:00Z
---
設定画面にダークテーマを追加してください。
```

種類は`from`で決まります。`ai`なら質問（`to: human`）、`human`なら依頼（`to: ai`）です。frontmatterの未知のキーは拒否します。

| 項目 | 規則 |
| --- | --- |
| `from`、`to` | 質問は`ai`と`human`、依頼は`human`と`ai`。 |
| 本文 | テキスト。質問は1〜5,000文字、依頼は1〜20,000文字。 |
| `createdAt` | メッセージを作った時刻。 |
| `withdrawnAt` | `null`、または取り下げた時刻。回答や受け付けのあるメッセージは取り下げません。 |

質問の項目です。

| 項目 | 規則 |
| --- | --- |
| `tasks` | 省略できます。質問の対象としたタスク番号です。`message link`と`message unlink`で、そのタスクの`questions`と揃えて保ちます。 |
| `choices` | 省略できます。2〜10個。選択肢のIDは質問内で一意（1〜64文字の`[A-Za-z0-9_-]`）、ラベルは1〜200文字です。選択肢がなければ、テキストで答えます。 |
| `recommended` | 省略できます。選択肢のIDを1つ指定します。 |
| `askedBy` | 省略できます。質問を出した、ボードが起動したセッションの起動ID（`AGBOARD_RESIDENT_ID`）です。変数が設定されているとき、`message ask`が書きます。ボードはこれを使って、回答をそのセッションへ押し込みます。外部のセッションが出した質問にはありません。 |
| `reply` | 回答があるまでは`null`。`choice`は質問に選択肢がないときは入らず、選択肢があるときは`choice`と`text`の少なくとも一方が入ります。`text`は1〜2,000文字で、選択肢がなければ必須です。`via`は`ui`・`chat`・`cli`、`at`は記録した時刻です。`acceptedAt`は任意で、AIが回答を受け取るまでは省略または`null`、受け取るとその時刻です。 |

依頼の項目です。

| 項目 | 規則 |
| --- | --- |
| `acceptedAt` | AIが受け付けるまでは`null`で、受け付けるとその時刻です。 |

状態は保存しません。`withdrawnAt`があれば取り下げ済み、質問に`reply`がある、または依頼が受け付け済みなら完了、それ以外は未完了です。CLIとAPIでは、質問の状態を`open`・`answered`・`withdrawn`、依頼の状態を`open`・`accepted`・`withdrawn`で返します。両方に共通する絞り込みの語は`open`・`closed`・`withdrawn`です。

回答は人が1回だけ書き、受け付けはAIが1回だけ書きます。これは依頼の`acceptedAt`にも、回答の`acceptedAt`にも当てはまります。人がチャットで答え、エージェントが代わりに記録した回答（`via: chat`）は、受け付け済みの状態で書かれます。取り下げたあとは何も書きません。質問を参照しているタスク（`referencedBy`）は、このファイルではなくタスクの`questions`から求めます。

読めない`QA.md`、上の規則に反するもの、`Q-<n>`以外の名前のフォルダにあるものは、どの一覧からも外し、`problems`に`projects/<id>/qa/Q-<n>/QA.md`として載せます。そのファイルへの書き込みは`file_invalid`で失敗します。読めない質問を参照するタスクは、待ち（Pending）のままです。

プロジェクトは`shared/projects/<project-id>/`を複製してバックアップし、`serve`を止めてフォルダを戻して復元します。エクスポートやインポートのコマンドはありません。[データのガイド](../../guide/operations/data.md)を参照してください。

## モニター接続の設定

ngrokのリモート接続は、秘密ではない設定を`<データ領域>/.internal/monitor-connection.json`に保存します。このファイルはアプリのもので、PCの設定画面と`serve`だけが書き、手で編集するものではありません。共有領域には含まれないため、プロジェクトのバックアップには入りません。所有者だけが読み書きできる権限（OSにある場合は`0600`）でatomicに置き換えます。

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

保存した言語とカラーテーマは、`<データ領域>/.internal/preferences.json`にあります。このファイルはアプリのもので、`PUT /api/preferences`（PCから、またはngrokの入口を通して）だけが書き、手で書くことはありません。`shared/`にはないため、プロジェクトのバックアップには含まれません。所有者だけが読み書きできる権限（OSにある場合は`0600`）で、原子的に置き換えます。書き込みに失敗した場合は、以前のファイルをそのまま残します。

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

## セッションの自動起動

サーバーの起動時にボードが起動するセッションは、`<データ領域>/.internal/resident-autostart.json`に保存します。ボードが起動するセッションは全体で1つなので、選択は最大1つです。このファイルはアプリのもので、ローカルの入口の`PUT /api/projects/{projectId}/sessions/autostart`だけが書き込み、手で書くことはありません。`shared/`には置きません。置き換えは原子的で、所有者だけの権限（OSにあれば`0600`）です。

```json
{
  "formatVersion": 2,
  "autoStart": { "tool": "claude-code", "projectId": "0123456789abcdef0123456789abcdef", "model": "sonnet" }
}
```

| 項目 | 規則 |
| --- | --- |
| `formatVersion` | 常に`2`です。ほかの値（ツールごとだった以前の形式`1`を含む）、未知の項目、壊れたファイルは、起動するものがないものとして読みます。 |
| `autoStart` | 選択です。ないときは`null`です。 |
| `autoStart.tool` | `claude-code`か`codex`です。 |
| `autoStart.projectId` | セッションを、その結び付いたフォルダで起動するプロジェクトです。 |
| `autoStart.model` | モデル名、またはツールの既定のモデルを使う`null`です。 |

このファイルに秘密の値は含みません。プロジェクトがなくなった、または結び付いたフォルダがないときも、ファイルからは消しません。起動は理由付きの`failed`として表示され、選択は切るまで残ります。

## タスクのJSONとスナップショット

CLI・Web API・Hookは、camelCaseの同じタスクの表現を使います。`task.json`のメタデータ（`results`を含み、常に配列として入ります）に、`history`・`description`・`body`・`acceptance`・`acceptanceError`、表示用の`updatedAt`、`epic`（`{id, name, color}`または`null`）を加えたものです。読むときに導く項目は、`agentStatus`、`questionIds`（タスクの`questions`）・`questionsError`（そのfrontmatterが不正か）・`openQuestionIds`、そして`pendingRequestId`・`pendingReason`・`pendingChoices`です。最後の3つは、タスクが`pending`と表示される間、IDが最も小さい未回答の質問から取り、それ以外は`null`と空です。`pendingRequestId`にはその質問のID（`Q-12`など）が入り、ボードは回答するときにこのIDを送ります。`requestAnswers`が履歴に現れることはありません。

- スナップショットは、`project`・`version`・`cursor`・`epics`・`tasks`（それぞれ全履歴を持つ）・`problems`を一度の読み込みから返します。CLIのスナップショットは`nextTaskId`も含み、CLIのスナップショット・Hook・`wait`は`fetchedAt`を含みます。
- プロジェクト一覧は`projects`（id・name・createdAt）と`catalogVersion`を返し、タスクは含みません。
- `ls --all-projects --json`は、`catalogVersion`と、プロジェクトごとのスナップショットを名前順に返します。cursorはそれぞれのプロジェクトのものです。

`problems`は形式の不備を報告します。`[{ "file": "projects/<id>/tasks/12/TASK.md", "field": "acceptance[1].text", "reason": "The text must not be empty." }]`の形で、`field`はタスクのファイルなら`frontmatter`・`acceptance[<index>].<key>`・`questions`・`history`・`history[<index>].<key>`のいずれか、`QA.md`ならその項目、`file`は`shared/`からの相対パス、`reason`は英語です。不備が読み書きにどう影響するかは[保存と復旧](../concepts/saving-and-recovery.md#ファイルに不備があるとき)にあります。

## 初回の案内

- `shared/.internal/onboarding.json`: `{ "formatVersion": 2, "status": "unseen" | "completed" | "skipped" }`。以前のリリースが書いたバージョン1のファイルは、`completed`、`skipped`、`unseen`のいずれかとして読み、一度だけ書き直します。[保存と復旧](../concepts/saving-and-recovery.md)を参照してください。
- `tasks/<id>/task.json`の`onboardingSample`: `{ "runId": "<32桁の小文字の16進数>", "ordinal": 1 | 2 }`。以前のリリースが、案内のサンプルカードにだけ書いたものです。今は何も書きませんが、読み込みでは、そのまま保持します。

## setupが書き込むファイル {#agent-settings}

`agboard setup`は独自の記録を持ちません。何が導入されているかは各エージェントのプラグインの一覧が示し、データ領域の外で変更するのは次のファイルだけです。

| ファイル | 変更 |
| --- | --- |
| `$CODEX_HOME/config.toml`（通常は`~/.codex/config.toml`） | `sandbox_workspace_write.writable_roots`にデータフォルダを加えます。`workspace-write`で、権限プロファイルがないときだけです。 |
| `$CODEX_HOME/rules/agboard.rules` | 存在しないときに、`prefix_rule(pattern=["agboard"], decision="allow")`を書いて作ります。フルアクセスでは書きません。 |
| `$CLAUDE_CONFIG_DIR/settings.json`（通常は`~/.claude/settings.json`） | `permissions.additionalDirectories`にデータフォルダを加えます。 |

- 変更するファイルは、先に同じ場所へ`<file>.agboard-backup…`として、元のファイルのアクセス権のままバックアップします。新しく作るファイルは所有者だけが読み書きできます。
- Codexのhookの信頼は、`codex app-server`を通して、Codex自身が設定の`hooks.state`に保存します。
- 導入したプラグインは、各エージェントがプラグインを置く場所にあり、agboardはそこに書き込みません。
- `agboard update`は、これらのファイルを変更しません。

## フォルダの紐付け

フォルダの紐付けは、実フォルダとProjectIdを対応づけ、Hookと`agboard progress`が作業フォルダが属するプロジェクトを識別できるようにします。端末ローカルのデータ領域にだけ保存し、共有領域や追跡ファイルには保存しません。ProjectIdを保存するので、名前変更に追従し、同じ名前で作り直したプロジェクトへは移りません。最も近い紐付け済みの祖先フォルダを使います。存在しないフォルダ・壊れた紐付け・削除済みのProjectIdは、説明つきのエラーにします。

## プロジェクトのドキュメント

`shared/projects/<project-id>/docs/`は、プロジェクトの文書のフォルダです。ボードではなく利用者のものです。ファイルには形式も`formatVersion`も項目もなく、Agent Boardは検証しません。

- **プロジェクトと一緒に作る。** `project create`と、プロジェクトを作るときの`init`は、新しいプロジェクトの一時フォルダの中に`docs/`と`README.md`を作り、それからフォルダを正式な名前に変えます。READMEは英語か日本語で、`.internal/preferences.json`のアプリの言語に合わせます（`ja`なら日本語、それ以外は英語）。文面は`src/docs/templates/`にあります。
- **起動時に補う。** `serve`は、`docs/`がないプロジェクトに`docs/`とREADMEを作ります。すでにあるフォルダには触れないので、利用者が消したREADMEは消えたままです。ここでの失敗は無視します。フォルダがなければ空のツリーとして読むためです。
- **プロジェクトと一緒に消える。** `project rm`はプロジェクトのフォルダを丸ごと削除し、`docs/`も消えます。退避はしません。既存のプロジェクトに対する`init`は`tasks/`と`epics/`だけを初期化するので、`docs/`は残ります。
- **ボードのデータではない。** 監視は`docs/`の下をすべて無視し、ファイルはプロジェクトの`version`に含まれません（[変更の通知](../concepts/notifications.md)を参照）。編集しても`changed`は送られません。
- **ドキュメントのルートからは読むだけ。** ツリーはフォルダとファイルを一覧にし、ファイルのルートは2 MiB以下のUTF-8の`.md`と`.mdx`ファイルを読みます。画像のルートは10 MiB以下のPNG・JPEG・WebP・GIF・AVIF・SVGを返します。ファイルを書くルートはありません。編集は利用者が自分のエディターで行い、**エディターで開く**がそのエディターを起動します。[Web API](./web-api.md#プロジェクトのドキュメント)を参照してください。
- **保存されたとおりに返す。** ファイルの読み込みは、ディスク上のバイト列をそのまま返します。改行コード、BOM、末尾の改行、フロントマターは変えません。`revision`は、`sha256:`とそのバイト列のSHA-256（16進数）です。
