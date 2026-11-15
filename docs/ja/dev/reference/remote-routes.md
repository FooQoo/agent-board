# モニターのルート

ngrokの入口の背後で配信する経路です。PCと同じアプリとAPIであるボードのアプリと、引き続き配信している`/monitor/`の旧モバイルモニターがあります。入口・Hostの検査・session・トンネルの関係は[モバイルモニター](../concepts/remote-access.md)にあります。接続設定のAPIはローカルの経路で、[Web API](./web-api.md#モバイル接続)にあります。

## 入口から使うボードのアプリ

入口は、ローカルのリスナーと同じパスで、ボードのページとAPIを配信します。スマホやほかのコンピューターのブラウザは、ボードのアプリそのものを使い、画面はウィンドウの幅で切り替わります（[サーバーと画面](../concepts/server-and-ui.md)を参照）。

| ルート | 内容 |
| --- | --- |
| GET/HEAD `/` | ボードのページ。PCと同じHTMLで、`meta[name=agboard-token]`は空。トークン・session・ボードのデータは含まない。ngrokの警告ページで**Visit Site**を押すとこのアドレスに戻る。 |
| GET/HEAD `/assets/{name}`、`/logo.png`、`/logo-white.png`、`/docs-sandbox`、`/docs-sandbox/{name}` | 内容で名前を付けたスクリプトとスタイルシート、ロゴ、固定のDocsサンドボックスのページ。どれもトークンやボードのデータを持たないので、入口の検査は通すがsessionは要らない。 |
| GET `/api/remote/session` | Cookieの有効なsessionを知らせ、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。有効なsessionがなければ401 `session_required`で、sessionは開始しない。クロスサイトの`Sec-Fetch-Site`は403。 |
| POST `/api/remote/unlock` | 合言葉をsessionと交換する。`POST /monitor/api/unlock`と同じ本文・同じ応答・同じ間違いの回数で数える。正しければCookie`agboard_ngrok_session`（`Path=/`）を設定し、CSRFトークンを返す。 |
| [Web API](./web-api.md)のそのほかの`/api/`の経路すべて | ボード自身の経路。SummaryとDetail、イベント（`/api/events`）、書き込み、プロジェクトのドキュメント、ガイド、表示設定。読み取りには有効なsessionが必要。変更にはさらに、公開Origin・`Sec-Fetch-Site: same-origin`・`X-Agboard-Csrf`のCSRFトークンが必要で、クライアントが送った`X-Agboard-Token`は取り除く。 |

- sessionがないとき、ページの殻と上の静的ファイル、sessionの経路、unlockの経路以外はすべて401 `session_required`で、イベントのストリームも同じです。Cookieを設定するのは、正しい合言葉だけです。
- PC自身に作用する経路は、sessionがあっても入口には含めません。接続設定（`/api/monitor-connections`とその配下）、`POST /api/notify`、`POST /api/projects/{projectId}/docs/open`は、ここでは404です。
- ローカルのリスナーには`/api/remote/`はなく、Host・Origin・トークンの検査は変わりません。
- イベントのストリームは、モニターのものと同じく、sessionの終了・実行の終了・5分で終わります（ページが再接続します）。

## 旧モニターの経路

| ルート | 内容 |
| --- | --- |
| GET/HEAD `/monitor/` | モニターのHTML。トークン・session・ボードのデータは含まない。`/monitor`は`/monitor/`へリダイレクトする。 |
| GET `/monitor/api/session` | Cookieの有効なsessionを知らせ、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。有効なsessionがなければ401 `session_required`で、sessionは開始しない。クロスサイトの`Sec-Fetch-Site`は403。 |
| POST `/monitor/api/unlock` | 合言葉をsessionと交換する。本文はJSONの`{"code":"1234"}`で256バイトまで。公開Originと`Sec-Fetch-Site: same-origin`が必要で、CSRFトークンは要らない。正しければCookie`agboard_ngrok_session`を設定し、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。間違いは手がかりを示さない403 `unlock_failed`。連続5回間違えたあとは、正しい合言葉も含むすべての試行が、接続を開始し直すまで429 `unlock_locked`になる。Originやフェッチサイトの不備は403 `forbidden`、JSONと宣言されていない本文は415、256バイトを超える本文は413、解釈できない本文は400（これらは推測として数えない）。 |
| POST `/monitor/api/disconnect` | sessionを終了し、そのCookieを消す（CSRFトークンと公開Originが必要）。`{"disconnected": true}`を返し、サインアウト先はない。そのあとも合言葉は使える。 |
| GET/HEAD `/monitor/assets/monitor/{name}` | モニターのmanifestにある、内容から名前を付けたスクリプトとスタイルシートだけ。immutableでキャッシュさせ、受け付ける場合はgzipで送る。ほかの名前は`no-store`の404。 |
| GET/HEAD `/monitor/api/projects/{projectId}/summary` | プロジェクトのSummary。タスク、進捗付きのエピック、problemsを持ち、本文は含まない。その`version`が`ETag`になり、一致する`If-None-Match`には304を返す。存在しないプロジェクトは404 `project_not_found`。[Web API](./web-api.md#summaryとdetail)を参照。 |
| GET/HEAD `/monitor/api/projects/{projectId}/tasks/{id}/detail` | タスクの本文・受入条件・履歴を、NDJSONのストリームで返す。`?sections=document`か`?sections=history`で一部だけ読める。 |
| GET/HEAD `/monitor/api/projects/{projectId}/epics/{epicId}/detail` | エピックのドキュメントを、NDJSONのストリームで返す。 |
| GET `/monitor/api/events?project=<projectId>` | `ready`（モニターのビルドIDを含む）・`changed`・`resync`・`heartbeat`・`preferences`（保存した言語とテーマ。変更のあとに送る）の専用SSE。`project`は必須で、欠落または形式の誤りは422 `invalid_value`、存在しないプロジェクトは404 `project_not_found`。そのプロジェクトの変更だけを送る。 |
| GET `/monitor/api/preferences` | 保存した言語とカラーテーマ。PCの`GET /api/preferences`と同じJSON。 |
| PUT `/monitor/api/preferences` | 言語とテーマだけを保存する。`locale`・`theme`・両方のいずれか。回答と同じく、公開Origin・`Sec-Fetch-Site: same-origin`・CSRFトークンが必要。未知の項目と不正な値は422 `invalid_preferences`。 |
| GET `/monitor/api/projects/{projectId}/qa/{questionId}` | 質問1件。ボードと同じ。 |
| POST `/monitor/api/projects/{projectId}/qa/answers` | 質問に回答する。本文と結果はボードと同じ。質問を取り下げる経路はない。 |
| PUT `/monitor/api/projects/{projectId}/tasks/{id}/acceptance/{condition}` | 条件を1件付け外しする。ボードと同じ動き。PUTだけ。 |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/attachments/{attachmentId}` | 所有する画像だけ。 |
| GET/HEAD `/monitor/api/projects/{projectId}/epics/{epicId}/attachments/{attachmentId}` | 所有するエピックの画像だけ。 |

- `/monitor/api/`は読み取りのrouterと、回答・受入条件のチェック・言語とテーマの保存だけの書き込みrouterに分け、PCのAPIには合流させません。PCのrouterへのfallback、prefixを外すリダイレクト、メソッドの上書き、モニターの経路からPCの資産への別名はありません。
- HEADは許可したJSONと画像のGETと同じ範囲で、SSEには設けません。未知の経路はHTMLへのfallbackなしの404、許可した経路で許可しないメソッドは405です。モニターの経路では、health・notify・archive、ほかの書き込み、ファイルの一覧を配信しません。
- PCのボードとそのAPIは、`/monitor/`の下では配信せず、上で述べたとおり`/`と`/api/`で配信します。
- モニターにはプロジェクトの一覧がありません。`/monitor/api/projects`と、プロジェクト全体を返す`/monitor/api/projects/{projectId}/board`は提供しません。モニターのアドレスは一つのプロジェクトを指し、どの読み取りも、パスまたは`?project=`からプロジェクトIDを受け取ります。IDは読む対象を選ぶもので、アクセス権ではありません。
- すべての要求は、まずHostの検査を通ります（失敗は理由を示さない403）。ページの殻・静的ファイル・`session`・`unlock`を除く経路は、そのうえで有効なsessionが必要で（なければ401 `session_required`）、変更にはさらに公開Origin・同一オリジンのメタデータ・CSRFトークンが必要です。この入口で受け付ける書き込みは、回答・受入条件のチェック・言語とテーマの保存・切断だけです。一覧にないパスは404です。
