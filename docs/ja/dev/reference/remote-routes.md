# 入口のルート

ngrokの入口の背後で配信する経路です。PCと同じアプリとAPIであるボードのアプリです。入口・Hostの検査・session・トンネルの関係は[リモートアクセス](../concepts/remote-access.md)にあります。接続設定のAPIはローカルの経路で、[Web API](./web-api.md#リモート接続)にあります。

## 入口から使うボードのアプリ

入口は、ローカルのリスナーと同じパスで、ボードのページとAPIを配信します。スマホやほかのコンピューターのブラウザは、ボードのアプリそのものを使い、画面はウィンドウの幅で切り替わります（[サーバーと画面](../concepts/server-and-ui.md)を参照）。

| ルート | 内容 |
| --- | --- |
| GET/HEAD `/` | ボードのページ。PCと同じHTMLで、`meta[name=agboard-token]`は空。トークン・session・ボードのデータは含まない。ngrokの警告ページで**Visit Site**を押すとこのアドレスに戻る。 |
| GET/HEAD `/assets/{name}`、`/logo.png`、`/logo-white.png`、`/docs-sandbox`、`/docs-sandbox/{name}` | 内容で名前を付けたスクリプトとスタイルシート、ロゴ、固定のDocsサンドボックスのページ。どれもトークンやボードのデータを持たないので、入口の検査は通すがsessionは要らない。 |
| GET `/api/remote/session` | Cookieの有効なsessionを知らせ、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。有効なsessionがなくても、有効な`agboard_ngrok_device`のCookie（登録済みの端末で、この公開アドレスに結び付く）があれば、ここで合言葉なしに新しいsessionを開き、同じ本文で200を返し、`agboard_ngrok_session`のCookieと更新した端末Cookieを設定する。なければ401 `session_required`で、何も設定しない。クロスサイトの`Sec-Fetch-Site`は403。 |
| POST `/api/remote/unlock` | 合言葉をsessionと交換する。本文はJSONの`{"code":"1234"}`で256バイトまで。公開Originと`Sec-Fetch-Site: same-origin`が必要で、CSRFトークンは要らない。正しければCookie`agboard_ngrok_session`（`Path=/`）と、ブラウザが登録済みの端末のCookieをまだ持っていなければ新しい`agboard_ngrok_device`（`Secure; HttpOnly; SameSite=Lax; Path=/`、`Max-Age=34560000`）を設定し、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。間違いは手がかりを示さない403 `unlock_failed`。連続5回間違えたあとは、正しい合言葉も含むすべての試行が、接続を開始し直すまで429 `unlock_locked`になる。Originやフェッチサイトの不備は403 `forbidden`、JSONと宣言されていない本文は415、256バイトを超える本文は413、解釈できない本文は400（どれも推測として数えない）。 |
| GET `/api/remote/push` | sessionが必要。`{deviceRegistered, publicKey, subscribed}`を返す。sessionに登録済みの端末があるか、購読に使うVAPIDの公開鍵、端末がすでに購読しているか。登録済みの端末がなければ`{"deviceRegistered": false}`だけで、鍵は返さない。 |
| PUT `/api/remote/push/subscription` | sessionとCSRFトークンが必要。ブラウザの`PushSubscription.toJSON()`の本文（`endpoint`と`keys.p256dh`/`keys.auth`、JSONで4 KiBまで）を、sessionの端末のものとして保存し、古いものは置き換える。登録済みの端末がなければ409 `device_required`、公開`https`アドレスでないendpointや不正な鍵は400 `invalid_subscription`、ほかに400 `invalid_json`・413・415。`{"subscribed": true}`を返す。 |
| DELETE `/api/remote/push/subscription` | sessionとCSRFトークンが必要。端末の購読を削除する（購読がなくても成功）。登録済みの端末がなければ409 `device_required`。 |
| GET `/manifest.webmanifest`、`/sw.js` | sessionは不要。Webアプリのマニフェストと、ページがWeb Pushを受け取るためのService Worker。ローカルのリスナーでも提供する。 |
| [Web API](./web-api.md)のそのほかの`/api/`の経路すべて | ボード自身の経路。SummaryとDetail、イベント（`/api/events`）、書き込み、プロジェクトのドキュメント、ガイド、表示設定。読み取りには有効なsessionが必要。変更にはさらに、公開Origin・`Sec-Fetch-Site: same-origin`・`X-Agboard-Csrf`のCSRFトークンが必要で、クライアントが送った`X-Agboard-Token`は取り除く。 |

- sessionがないとき、ページの殻と上の静的ファイル、sessionの経路、unlockの経路以外はすべて401 `session_required`で、イベントのストリームも同じです。Cookieを設定するのは、正しい合言葉と、登録済みの端末のCookieだけです。
- PC自身に作用する経路は、sessionがあっても入口には含めません。接続設定（`/api/monitor-connections`とその配下）、`POST /api/notify`、`POST /api/projects/{projectId}/docs/open`は、ここでは404です。
- ローカルのリスナーには`/api/remote/`はなく、Host・Origin・トークンの検査は変わりません。
- イベントのストリームは、sessionの終了・実行の終了・5分で終わります（ページが再接続します）。

## プロジェクトの一覧と切り替え

スマホでも、PCと同じ方法でプロジェクトを一覧し、切り替えます。`GET /api/projects`がすべてのプロジェクトを返し、各プロジェクトは`/api/projects/{projectId}/…`（Summary、Detail、イベントなど、[Web API](./web-api.md)のとおり）で読みます。ページはアドレスでプロジェクトを指定し（`/?project=<ProjectId>`）、ボードのアプリがPCと同じように読み取ります。パスにあるProjectIdは読み取り先を選ぶだけで、アクセス権ではありません。合言葉を通ったsessionは、PCにあるすべてのプロジェクトを読めます。

## 旧モニターのアドレスは廃止

以前のスマホ用モニターは、`/monitor/`の下に独自のページ・API・資産を持っていました。いずれも配信しません。

| ルート | 応答 |
| --- | --- |
| `/monitor`と`/monitor/`以下のすべてのパスへの、どのメソッドも | Hostの検査のあと、sessionの有無にかかわらず404。リダイレクトはなく、古いアドレスが新しいアドレスに転送されることもない。 |

- ローカルのリスナーも、同じアドレスに404を返します。
- すべての要求は、まずHostの検査を通ります（失敗は理由を示さない403）。そのうえで、ページの殻・静的ファイル・sessionの経路・unlockの経路を除くすべての経路に有効なsessionが必要で（なければ401 `session_required`）、変更には公開Origin・同一オリジンのメタデータ・CSRFトークンも必要です。一覧にないパスは404です。
