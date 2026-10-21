# モニターのルート

ngrokのモニター入口の背後で配信する経路です（モバイルモニターを含む）。入口・トークン・トンネルの関係は[モバイルモニター](../concepts/remote-access.md)にあります。

## モニターの入口の経路

| ルート | 内容 |
| --- | --- |
| GET/HEAD `/monitor/` | モニターのHTML。回答用のトークンは配信時にだけ差し込む。 |
| GET/HEAD `/assets/monitor/{name}` | モニターのmanifestにある、内容から名前を付けたスクリプトとスタイルシートだけ。immutableでキャッシュさせ、受け付ける場合はgzipで送る。ほかの名前は`no-store`の404。 |
| GET/HEAD `/logo.png`、`/logo-white.png` | ロゴ。 |
| GET `/monitor/api/projects`、`/monitor/api/projects/{projectId}/board` | 本文・全履歴・problemsを持つ読み取り専用のAPI。 |
| GET `/monitor/api/events` | `ready`（モニターのビルドIDを含む）・`changed`・`heartbeat`の専用SSE。 |
| POST `/monitor/api/projects/{projectId}/tasks/{id}/answer` | 現在の依頼への回答だけ。 |
| GET `/monitor/api/projects/{projectId}/tasks/{id}/attachments/{attachmentId}` | 所有する画像だけ。 |
| GET `/monitor/api/projects/{projectId}/epics/{epicId}`とその添付 | 所有するエピックの情報と画像だけ。 |

- `/monitor/api/`は読み取りのrouterと回答だけの書き込みrouterに分け、PCのAPIには合流させません。PCのrouterへのfallback、prefixを外すリダイレクト、メソッドの上書き、モニターの経路からPCの資産への別名はありません。
- HEADは許可したJSONと画像のGETと同じ範囲で、SSEには設けません。未知の経路はHTMLへのfallbackなしの404、許可した経路で許可しないメソッドは405です。モニターの経路では、health・notify・archive、ほかの書き込み、ファイルの一覧を配信しません。
- PCのボードとそのAPIは、モニターの入口では配信しません。
