# モニターのルート

ngrokのモニター入口の背後で配信する経路です（モバイルモニターを含む）。入口・Hostの検査・session・トンネルの関係は[モバイルモニター](../concepts/remote-access.md)にあります。接続設定のAPIはローカルの経路で、[Web API](./web-api.md#モバイル接続)にあります。

## モニターの入口の経路

| ルート | 内容 |
| --- | --- |
| GET/HEAD `/` | `/monitor/` へ308で転送する。ngrokの警告ページで「Visit Site」を押すと、このアドレスに戻るため。 |
| GET/HEAD `/monitor/` | モニターのHTML。トークン・session・ボードのデータは含まない。`/monitor`は`/monitor/`へリダイレクトする。 |
| GET `/monitor/api/session` | Cookieの有効なsessionを知らせ、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。有効なsessionがなければ401 `session_required`で、sessionは開始しない。クロスサイトの`Sec-Fetch-Site`は403。 |
| POST `/monitor/api/unlock` | 合言葉をsessionと交換する。本文はJSONの`{"code":"1234"}`で256バイトまで。公開Originと`Sec-Fetch-Site: same-origin`が必要で、CSRFトークンは要らない。正しければCookie`agboard_ngrok_session`を設定し、`csrfToken`・`expiresAt`・`expiresInSeconds`を返す。間違いは手がかりを示さない403 `unlock_failed`。連続5回間違えたあとは、正しい合言葉も含むすべての試行が、接続を開始し直すまで429 `unlock_locked`になる。Originやフェッチサイトの不備は403 `forbidden`、JSONと宣言されていない本文は415、256バイトを超える本文は413、解釈できない本文は400（これらは推測として数えない）。 |
| POST `/monitor/api/disconnect` | sessionを終了し、そのCookieを消す（CSRFトークンと公開Originが必要）。`{"disconnected": true}`を返し、サインアウト先はない。そのあとも合言葉は使える。 |
| GET/HEAD `/monitor/assets/monitor/{name}` | モニターのmanifestにある、内容から名前を付けたスクリプトとスタイルシートだけ。immutableでキャッシュさせ、受け付ける場合はgzipで送る。ほかの名前は`no-store`の404。 |
| GET/HEAD `/logo-white.png` | ヘッダーのロゴ。入口の検査は必要だが、sessionは要らない。 |
| GET `/monitor/api/projects`、`/monitor/api/projects/{projectId}/board` | 本文・全履歴・problemsを持つ読み取り専用のAPI。 |
| GET `/monitor/api/events?project=<projectId>` | `ready`（モニターのビルドIDを含む）・`changed`・`resync`・`heartbeat`・`preferences`（保存した言語とテーマ。変更のあとに送る）の専用SSE。`project`は必須で、欠落または形式の誤りは422 `invalid_value`、存在しないプロジェクトは404 `project_not_found`です。そのプロジェクトの変更だけを送ります。 |
| GET `/monitor/api/preferences` | 保存した言語とカラーテーマ。PCの`GET /api/preferences`と同じJSON。 |
| PUT `/monitor/api/preferences` | 言語とテーマだけを保存する。`locale`・`theme`・両方のいずれか。回答と同じく、公開Origin・`Sec-Fetch-Site: same-origin`・CSRFトークンが必要。未知の項目と不正な値は422 `invalid_preferences`。 |
| POST `/monitor/api/projects/{projectId}/tasks/{id}/answer` | 現在の依頼への回答だけ。 |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/attachments/{attachmentId}` | 所有する画像だけ。 |
| GET `/monitor/api/projects/{projectId}/epics/{epicId}`とその添付 | 所有するエピックの情報と画像だけ。 |

- `/monitor/api/`は読み取りのrouterと、回答と言語・テーマの保存だけの書き込みrouterに分け、PCのAPIには合流させません。PCのrouterへのfallback、prefixを外すリダイレクト、メソッドの上書き、モニターの経路からPCの資産への別名はありません。
- HEADは許可したJSONと画像のGETと同じ範囲で、SSEには設けません。未知の経路はHTMLへのfallbackなしの404、許可した経路で許可しないメソッドは405です。モニターの経路では、health・notify・archive、ほかの書き込み、ファイルの一覧を配信しません。
- PCのボードとそのAPIは、モニターの入口では配信しません。
- すべての要求は、まずHostの検査を通ります（失敗は理由を示さない403）。`session`と`unlock`を除く`/monitor/api/`の経路は、そのうえで有効なsessionが必要で（なければ401 `session_required`）、変更にはさらに公開Origin・同一オリジンのメタデータ・CSRFトークンが必要です。このエントリで受け付ける書き込みは、回答・言語とテーマの保存・切断の三つだけです。一覧にないパスは404です。
