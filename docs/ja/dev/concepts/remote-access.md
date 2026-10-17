# リモートアクセスとモバイルモニター

既定では、ボードに接続できるのは同じマシンからだけです。リモートアクセスを有効にすると、専用のリスナーが追加され、スマホや別のコンピューターからHTTPSプロキシ経由で接続できるようになります。モバイルモニターは、そのリスナーで配信する、読み取り中心の別のアプリです。利用者向けの設定手順は[モバイルモニターのガイド](../../guide/operations/mobile-monitor.md)、経路は[リモート・モニターのルート](../reference/remote-routes.md)にあります。

## 全体の構成

```mermaid
flowchart LR
    Phone["スマホ・PCのブラウザ"] -->|HTTPS + Basic認証| Caddy["LAN IP上のCaddy"]
    Phone -->|HTTPS + tailnetの規則| TS["Tailscale Serve"]
    Caddy --> RL["リモート用リスナー（127.0.0.1、例: 7422）"]
    TS --> RL
    RL --> Shared["共通のFileStoreの索引・監視・changedのbroadcast"]
    LL["ローカルのリスナー（127.0.0.1）"] --> Shared
```

- リモート用リスナーは、`--remote-port`と一つ以上の`--remote-origin`を指定したときだけ起動します。ローカルのリスナーと同じ`serve`プロセスで動き、どちらも127.0.0.1だけでbindし、ライフサイクルのガード、FileStoreの索引とreader、監視、`changed`のbroadcastを共有します。
- 両方のbindが成功してから配信を始め、失敗や停止では両方を終えます。リモート用リスナーの起動に失敗したら、ローカルのリスナーも止め、`serve.json`を残しません。`serve.json`にはローカルのポートだけを残すので、CLI・Hook・`wait`は影響を受けません。
- 外部の認証はすべてプロキシが担います。Agent Board自身は、すべての書き込みでHost・Origin・トークンを確かめます。

用途ごとに三種類の状態を持ち、アクセス範囲を分離しています。

| 状態 | 含むもの | 含まないもの |
| --- | --- | --- |
| `RemoteBoardState` | reader・書き込みサービス・`changed`・登録したHTTPSのorigin・独自のセッショントークン。書き込みの処理を複製せずにPCの処理を再利用する。 | ローカルのトークン。 |
| `MonitorState` | 読み取り専用のreader・`changed`の購読・許可するHost・独自の資産。 | ボードのトークンや書き込みサービス。 |
| モニターの回答router | 回答の経路一つと、独自のトークン。 | PCやリモートのボードのトークン。 |

## 認証と書き込みの保護

**リモートのボードへの書き込み**には、対象の確認より前に次のすべてが必要です。満たさなければ、何も変えずに403です。

- `Host`が、bindしたループバックのauthorityか登録したリモート用オリジンと完全に一致すること。`Forwarded`と`X-Forwarded-Host`は信用せず、CORSは開きません。
- `Host`と`Origin`が同じ登録済みのHTTPSのoriginに一致し、`Sec-Fetch-Site`が`same-origin`であること。
- `X-Agboard-Token`が、リモート用セッショントークンと定数時間の比較で一致すること。欠落・`null`・別のorigin・ローカルのトークンは拒否します。

リモート用トークンは起動ごとに32バイトの乱数から、ローカルのトークンとは別に生成し、リモート用の`/board/`のHTMLにだけ埋め込みます。

**モニターの回答**は三つ目のトークンを使います。これも起動ごとに32バイトの乱数から生成し、どちらのボードのトークンとも相互に使えません。配信時にだけ`/monitor/`のHTMLに差し込みます。回答には、対象の確認より前に、登録したHTTPSのoriginに完全に一致するHostとOrigin、`Sec-Fetch-Site: same-origin`、定数時間の比較でのトークンの一致が必要です。そのうえでFileStoreが、ロックの中でPending・依頼ID・選択肢を確かめ直します。受け付けるのはTodoかDoingのタスクの現在の依頼だけで、Done・回答済み・アーカイブ済み・別の依頼は拒否します。

トークンが、共通の入口・静的なJSやCSS・manifest・APIの応答・`serve.json`・ログに現れることはありません。すべてのHTMLと機密のAPIは`Cache-Control: no-store`・`Referrer-Policy: no-referrer`・`X-Content-Type-Options: nosniff`と、スクリプトと接続を自分自身に限り`frame-ancestors 'none'`とするCSPを送ります。

**プロキシ。** Caddyは選んだLAN IPのHTTPSポートだけで待ち受け、すべての経路に`tls internal`と`basic_auth`を適用し（認証されていない要求には401）、専用のポートだけに転送し、`Authorization`は転送せず、SSEをバッファしません。Tailscale Serveも同じポートに転送し、登録したoriginに一致するHostとOriginを保ち、tailnetのアクセス規則に頼り、Funnelは使いません。プロキシがHostやOriginを書き換えて、ローカルのガードを回避してはいけません。パスワードのハッシュ・秘密鍵・実際のLAN IPは利用者の設定に置き、リポジトリには置きません。共有の設定例は環境変数を使います。

## モニターのアプリ

- 共通の入口（`web/access.html`・`web/src/access/entry.ts`・`web/vite.access.config.ts`）は`web/dist/access/`にビルドし、DOMとWeb APIだけを使います。React・アプリのコード・APIクライアント・トークンは含みません。
- モニター（`web/monitor.html`・`web/src/monitor-main.tsx`・`web/vite.monitor.config.ts`）は`web/src/monitor/App.tsx`だけを起点にします。PCの`App.tsx`・`DetailPanel`・エディター・汎用の書き込みクライアントはimportしません。独自のmanifestとともに`web/dist/monitor/`にビルドし、`src/server/monitor/assets.rs`はそのmanifestだけを配信します。スマホでの自動の移動で、PCのHTML・トークン・エディターを先読みすることはありません。
- 共通の表示部品（ヘッダー、タスクの内容、状態のラベル、プロジェクトの切り替え、テーマ、i18n、閲覧専用のMarkdown・受入条件・履歴）は再利用します。タスクの見出しから、本文・受入条件・履歴・エピックのタブを持つ閲覧専用のドロワーを開き、回答フォームはタスク上に置きます。
- モニターのクライアントは、カタログ・ボード・イベント、所有する画像・証跡・エピックの読み取り、回答のPOST一つだけを持ちます。トークンは実行時に配信されたHTMLから読みます。PATCH・PUT・DELETEの関数はありません。
- PCとモニターの回答は、FileStoreの一つの保存処理を共有します。ロックの中での依頼の照合、`requestAnswers`と履歴の項目、索引の更新、通知です。回答に成功したタスクは、そのレーンのIdleになります。
- ドロワーはprojectId・taskId・epicIdと世代番号で対象を固定します。タスクの本文と履歴はスナップショットから、エピックの本文は`getEpic`から読み、タブごとのスクロール位置を保ち、遅れた応答や範囲外の応答は無視します。エピックの読み込みに失敗しても再試行でき、一覧や回答を妨げません。

## 取得と復帰

モニターは、定期的なポーリングを使わずに最新のデータを表示します。最新と確認できない場合は、データが古い可能性を明示します。

- **All Projects**は、カタログを取得し、各ボードを最大4並列で取得し、カタログを確かめ直します。その間に`catalogVersion`が変わったら、新しい世代として取り直します。プロジェクトをまたいだ同一時点の一貫性はありません。
- **データの不備。** スナップショットの`problems`は、ProjectIdとともに表示へ渡します。HTTP 200でも問題が一つでもあれば`partial`にします。サマリーは「—」にし、読めたタスクだけを並べ、データに不備があると案内します。外したタスクを0件として数えることはありません。取得に失敗したプロジェクトとデータに不備のあるプロジェクトは分けて表示し、修復の操作はありません。データの不備だけでは、再試行・ポーリング・再接続をしません。
- **鮮度**は`loading`・`syncing`・`fresh`・`stale`・`partial`・`error`のいずれかです。表示が`fresh`になるのは、SSEの`ready`が届き、すべてのプロジェクトを問題なく取得し、heartbeatが期限内のときだけで、`onopen`だけでは足りません。SSEが止まった状態で手動のGETが成功したら、取得済みだが自動更新は止まっていると表示します。最後の全体取得の時刻は、問題のない完全な取得でだけ進めます。
- **一つの取得処理**を、手動の更新・SSEの通知・ページへの復帰が共有します。`AbortController`と世代番号で遅れた応答を捨て、取得中の`changed`はdirtyフラグで一回の後続の取得にまとめます。
- **SSE。** モニターはブラウザの`EventSource`を使います。SSEは`changed`を中継し、`ready`を送り、15秒ごとに`heartbeat`（data `{}`）を送ります。表示中に45秒何も届かなければ接続を古い状態にして再接続します。heartbeatでスナップショットを取り直すことはありません。
- **ページの表示状態。** 非表示の間はSSEとheartbeatの判定を止めます。表示に戻るとすぐに取り直して再接続し、`ready`による重複をまとめます。GETは10秒でタイムアウトします。再試行は1・2・5・10・30秒と間隔を延ばし、非表示の間は止めます。カタログの確かめ直しが失敗し続けたら、取り直し続けるのではなく、syncingかstaleに戻して復旧のタイマーに任せます。
- **並び順。** `agentStatusChangedAt`は稼働状態の変更時刻、`taskStatusChangedAt`はDoneの並び順に使います。相対時刻は1分ごとに更新してよいですが、そのタイマーで取り直すことはありません。
- セットアップの完了前は読み込み中を表示し、プロジェクトやタスクが0件であることとネットワークの失敗を区別します。取得した本文や件数は、`localStorage`やService Workerに保存しません。
