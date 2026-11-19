# 入口のルート

ngrokの入口の背後で配信する経路です。PCと同じアプリとAPIであるボードのアプリです。入口・Hostの検査・session・トンネルの関係は[リモートアクセス](../concepts/remote-access.md)にあります。接続設定のAPIはローカルの経路で、[Web API](./web-api.md#リモート接続)にあります。

## 入口から使うボードのアプリ

入口は、ローカルのリスナーと同じパスで、ボードのページとAPIを配信します。スマホやほかのコンピューターのブラウザは、ボードのアプリそのものを使い、画面はウィンドウの幅で切り替わります（[サーバーと画面](../concepts/server-and-ui.md)を参照）。

| ルート | 内容 |
| --- | --- |
| GET/HEAD `/` | ボードのページ。PCと同じHTMLで、`meta[name=agboard-token]`は空。トークン・session・ボードのデータは含まない。ngrokの警告ページで**Visit Site**を押すとこのアドレスに戻る。 |
| GET/HEAD `/assets/{name}`、`/logo.png`、`/logo-white.png`、`/docs-sandbox`、`/docs-sandbox/{name}` | 内容で名前を付けたスクリプトとスタイルシート、ロゴ、固定のDocsサンドボックスのページ。どれもトークンやボードのデータを持たないので、入口の検査は通すがsessionは要らない。 |
| GET `/api/remote/session` | Cookieの有効なsessionを知らせ、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。有効なsessionがなければ401 `session_required`で、sessionは開始しない。クロスサイトの`Sec-Fetch-Site`は403。 |
| POST `/api/remote/unlock` | 合言葉をsessionと交換する。本文はJSONの`{"code":"1234"}`で256バイトまで。公開Originと`Sec-Fetch-Site: same-origin`が必要で、CSRFトークンは要らない。正しければCookie`agboard_ngrok_session`（`Path=/`）を設定し、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。間違いは手がかりを示さない403 `unlock_failed`。連続5回間違えたあとは、正しい合言葉も含むすべての試行が、接続を開始し直すまで429 `unlock_locked`になる。Originやフェッチサイトの不備は403 `forbidden`、JSONと宣言されていない本文は415、256バイトを超える本文は413、解釈できない本文は400（どれも推測として数えない）。 |
| [Web API](./web-api.md)のそのほかの`/api/`の経路すべて | ボード自身の経路。SummaryとDetail、イベント（`/api/events`）、書き込み、プロジェクトのドキュメント、ガイド、表示設定。読み取りには有効なsessionが必要。変更にはさらに、公開Origin・`Sec-Fetch-Site: same-origin`・`X-Agboard-Csrf`のCSRFトークンが必要で、クライアントが送った`X-Agboard-Token`は取り除く。 |

- sessionがないとき、ページの殻と上の静的ファイル、sessionの経路、unlockの経路以外はすべて401 `session_required`で、イベントのストリームも同じです。Cookieを設定するのは、正しい合言葉だけです。
- PC自身に作用する経路は、sessionがあっても入口には含めません。接続設定（`/api/monitor-connections`とその配下）、`POST /api/notify`、`POST /api/projects/{projectId}/docs/open`は、ここでは404です。
- ローカルのリスナーには`/api/remote/`はなく、Host・Origin・トークンの検査は変わりません。
- イベントのストリームは、sessionの終了・実行の終了・5分で終わります（ページが再接続します）。

## プロジェクトの一覧と切り替え

スマホでも、PCと同じ方法でプロジェクトを一覧し、切り替えます。`GET /api/projects`がすべてのプロジェクトを返し、各プロジェクトは`/api/projects/{projectId}/…`（Summary、Detail、イベントなど、[Web API](./web-api.md)のとおり）で読みます。ページはアドレスでプロジェクトを指定し（`/?project=<ProjectId>`）、ボードのアプリがPCと同じように読み取ります。パスにあるProjectIdは読み取り先を選ぶだけで、アクセス権ではありません。合言葉を通ったsessionは、PCにあるすべてのプロジェクトを読めます。

## 成果のリンク

成果のリンクは、ボード自身のページに、対象をクエリで付けたものです。`/?project=<ProjectId>&task=<id>&result=<version>`

| 部分 | 規則 |
| --- | --- |
| パス | `/`。対象はパスにもハッシュにも入れません。そのため、ページ本体、解錠のリクエスト、その後の再読み込みのどれでも対象が保たれます。 |
| `project` | ProjectId（小文字16進32桁）。`?project=`と同じ方法でプロジェクトを選びます。 |
| `task` | タスクID（正の整数）。 |
| `result` | そのタスクの成果の版（正の整数。[成果](./files.md#results)を参照）。 |

- **配信。** ページ本体はどのクエリでも配信されます。`GET /`はクエリを無視し、Hostの検査だけを通し、トークンもボードのデータも含みません。そのため成果のリンクは、sessionなしで読み込めます。
- **合言葉のあと。** `RemoteGate`は合言葉の画面をその場に表示し、あとからボードをマウントします。リダイレクトは行わないのでクエリは失われず、送り先となるアドレスもありません。対象はページ自身だけです。ボードは`task`と`result`をクエリから読みます（`useResultLink`、`web/src/app/model/useResultLink.ts`）。
- **開く動作。** Summaryにそのタスクが載った時点で、スマホはタスクのドロワーを成果タブで開き、PCのボードはカードを選んで成果タブを開きます。成果までスクロールして強調表示します。値が壊れている、プロジェクトにないタスク、アーカイブ済みのタスクは、通常のボードを開きます。タスクにない版は、あるものの一覧の上に通知を表示します。
- **消去。** ドロワーを閉じるか別のプロジェクトを選ぶと、アドレスから`task`と`result`が外れるので、再読み込みしても開き直しません。
- **読み取り。** 成果タブは`GET …/tasks/{id}/results`（[Web API](./web-api.md)を参照）を読みます。SummaryとDetailのストリームは成果を運ばないためです。画像は`GET …/tasks/{id}/attachments/{attachmentId}`から表示します。どちらもsessionの内側にある、ボードの通常のルートです。

**リンクの作り方。** `PublicOrigin::result_link(project_id, task_id, version)`（`src/server/monitor_connection/contracts/access.rs`）を使います。`https://<host>[:port]/?project=<id>&task=<n>&result=<version>`を返し、小文字16進32桁でないプロジェクトや、1未満のタスクまたは版には`None`を返します。Web側にも同じ規則の`resultLinkUrl`（`web/src/features/tasks/results/resultLink.ts`）があります。プッシュ通知は、このURLをクリック先に持たせます。

## 旧モニターのアドレスは廃止

以前のスマホ用モニターは、`/monitor/`の下に独自のページ・API・資産を持っていました。いずれも配信しません。

| ルート | 応答 |
| --- | --- |
| `/monitor`と`/monitor/`以下のすべてのパスへの、どのメソッドも | Hostの検査のあと、sessionの有無にかかわらず404。リダイレクトはなく、古いアドレスが新しいアドレスに転送されることもない。 |

- ローカルのリスナーも、同じアドレスに404を返します。
- すべての要求は、まずHostの検査を通ります（失敗は理由を示さない403）。そのうえで、ページの殻・静的ファイル・sessionの経路・unlockの経路を除くすべての経路に有効なsessionが必要で（なければ401 `session_required`）、変更には公開Origin・同一オリジンのメタデータ・CSRFトークンも必要です。一覧にないパスは404です。
