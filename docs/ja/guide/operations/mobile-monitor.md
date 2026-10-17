---
title: モバイルモニター
---

# モバイルモニター

モバイルモニターは、スマートフォン向けのボード表示です。席を離れているときに、進捗を確認したり、エージェントの質問に回答したりするために使います。このページでは、モニターの表示、スマホからボードに接続する方法、動作の確かめ方を説明します。

## モニターに表示されるもの

モニターでは、タスクが未着手・進行中・完了に分かれて表示されます。AI担当のタスクにはエージェントの状態が表示され、未着手または進行中で回答待ちの質問がある場合は、タスク上に回答フォームが表示されます。モニターから行える書き込み操作は、この質問への回答だけです。

タスクをタップすると、画面下部から詳細パネル（ドロワー）が開きます。**本文**・**受入条件**・**履歴**・**エピック**の4タブがあり、左右のスワイプでも切り替えられます。受入条件タブには、そのタスクの条件だけが表示されます。エピックの参考条件は計画本文で確認します。エピックタブでは、ほかの場所に表示済みのラベルやタイトルを繰り返さず、計画を表示します。

![本文タブを開いたタスクのドロワーと、4つのタブを表示したモバイルモニター](../../../images/mobile.ja.png){.screenshot--narrow}

各タブは個別にスクロールできます。横スワイプでは、タブの内容と選択中のタブを示す下線が一緒に動きます。タブ内の操作が、外側の画面の操作を引き起こすことはありません。ドロワーを閉じるには、上端のハンドルを下へドラッグします。ドロワーはドラッグに追従して動きます。

エピック一覧は、モニターを開いたときにプロジェクトごとにまとめて読み込み、ページを開いている間は保持します。タブを切り替えるたびに取得し直すことはありません。最新の一覧を取得するには、ページを再読み込みしてください。初回の取得に失敗した場合は、再試行ボタンを使えます。

モニターのHTML・JavaScript・CSS・閲覧用チャンク・APIレスポンスには、`Cache-Control: no-store`が指定されています。オフライン用のスナップショットキャッシュやService Workerはありません。再読み込みすると最新のUIとデータを取得し、切断中は接続状態を画面に表示します。

## 接続方法を選ぶ

ボードは、既定ではあなたのコンピューターだけで待ち受けます。スマホから接続するには、リモート用の待ち受けポート（リスナー）を追加し、その手前に信頼できるHTTPSプロキシを置きます。次のいずれかの方法を選んでください。

| 経路 | 使うとき | 節 |
| --- | --- | --- |
| **CaddyでLANに公開する** | スマホとコンピューターが同じ信頼できるネットワークにあり、ローカルの証明書を受け入れられる。 | [CaddyでLANに公開する](#caddyでlanに公開する) |
| **Tailscale Serve** | スマホとコンピューターがtailnetにあり、外部に公開したくない。 | [Tailscale Serve](#tailscale-serve) |

ボードをインターネットに公開したり、ルーターのポート転送を使ったりしてはいけません。

## リモートアクセスを有効にする

このページのコマンドは、[Agent Boardをインストール](../getting-started)したあと、リポジトリのルートで実行します。

`agboard serve`は通常のPC用リスナーをループバックに保ちます。信頼できるHTTPSプロキシの背後に置くときだけ、別のリモート用リスナーを追加してください。

```sh
agboard serve --port 7420 --remote-port 8040 \
  --remote-origin https://192.168.1.20:8443 \
  --remote-origin https://my-mac.example-tailnet.ts.net
```

実際に公開するオリジンだけを指定してください。リモート用ポートはプロキシのための2つ目のループバックのリスナーです。PC用のローカルポートをプロキシしてはいけません。共通の入口となるURLを開くと、768 CSSピクセル未満ではモニター、それより広いとPC用のボードが選ばれます。`/monitor/`と`/board/`を直接開くURLは、幅にかかわらず使えます。PC用のボードにも、リモートからの書き込みに対する保護が適用されます。モニターのAPIが許すのは、専用の回答リクエストとトークンだけで、ほかの書き込みルートは使えません。

## CaddyでLANに公開する

[Caddy公式のインストールガイド](https://caddyserver.com/docs/install)から、Caddy 2.8以降をインストールします。標準ビルドを使用できます。[`examples/monitor/Caddyfile`](https://github.com/FooQoo/agent-board/blob/main/examples/monitor/Caddyfile)のCaddyfileは、選んだLANのIPにバインドし、Caddyの内部HTTPS認証局を使い、すべてのルートで[Basic認証](https://caddyserver.com/docs/caddyfile/directives/basic_auth)を要求します。専用のリモート用ポートへだけ転送し、Agent Boardのガードのためにブラウザのホストとオリジンを保ち、Authorizationと`X-Forwarded-Host`を取り除き、[SSEをすぐにフラッシュ](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)します。この例はCaddyの管理APIとルート証明書の自動インストールを無効にしており、ローカルのテストは一時的な公開ルートを直接読みます。

お使いのマシンの値を設定し、パスワードのハッシュを作ります。平文のパスワードをシェルの履歴やCaddyfileに残さないでください。

```sh
export LAN_IP=192.168.1.20
export HTTPS_PORT=8443
export REMOTE_PORT=8040
export BASIC_AUTH_USER=board-reader
export BASIC_AUTH_HASH="$(caddy hash-password)"
```

1つ目のターミナルで、公開するHTTPSオリジンを正確に指定してAgent Boardを起動します。

```sh
agboard serve --port 7420 --remote-port "$REMOTE_PORT" \
  --remote-origin "https://${LAN_IP}:${HTTPS_PORT}"
```

別のターミナルで、プロキシを検証し、フォアグラウンドで実行します。

```sh
caddy validate --config examples/monitor/Caddyfile --adapter caddyfile
caddy run --config examples/monitor/Caddyfile --adapter caddyfile
```

信頼できる同じLAN上の端末で`https://<LAN_IP>:<HTTPS_PORT>/`を開き、Basic認証の資格情報を入力します。Caddyの`tls internal`の証明書は、Caddyのローカル認証局が署名したもので、スマートフォンは既定ではこれを信頼しません。ルート証明書（公開証明書）は`<Caddy data directory>/pki/authorities/local/root.crt`にあります(たとえば`XDG_DATA_HOME`を設定していれば`$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt`。[Caddyのデータディレクトリの規約](https://caddyserver.com/docs/conventions#data-directory)を参照)。その公開証明書だけを信頼できる経路でスマートフォンへコピーし、スマートフォンOSの手順で信頼させてください。Caddyの認証局の秘密鍵は、コピーも配布もしないでください。Caddyのデータディレクトリは永続的です。非公開にし、バックアップしてください。ルーターのポート転送を有効にしたり、このリスナーを公開インターネットに出したりしないでください。

2つのフォアグラウンドのプロセスはCtrl+Cで止めます。コンピューターがスリープしたり、どちらかのプロセスが止まったりすると、Agent BoardとCaddyが再び動くまでリモートのサービスは使えません。

## Tailscale Serve

[お使いのOS用のTailscaleスタンドアロンアプリ](https://tailscale.com/download)をインストールし、Tailscale CLI 1.52以降を使います。[現在のServe CLIの構文](https://tailscale.com/docs/reference/tailscale-cli/serve)は1.52で変わりました。コンピューターとスマートフォンを既存のtailnetに追加します。tailnetの管理画面で、アクセスを自分のアカウントと、このボードへのアクセスを許可する端末だけに制限してください。ServeにはtailnetでHTTPS証明書が有効である必要があり、Serveを呼び出すとその変更の承認を求められることがあります。同意のページを確認してから承認してください。[tailnetのアクセスルールはServeにも適用されます](https://tailscale.com/docs/features/tailscale-serve)。

Agent Boardを専用のリモート用ポートで起動し、そのループバックのポートに対してServeを開始します。

```sh
agboard serve --port 7420 --remote-port 8040 \
  --remote-origin https://<origin-shown-by-tailscale>
tailscale serve --bg http://127.0.0.1:8040
tailscale serve status
tailscale funnel status
```

Agent Boardを起動する前に、`tailscale serve status`が表示する正確なHTTPSオリジンを`--remote-origin`に指定してください。Serveがtailnetの中だけで有効で、Funnelがサービスを公開していないことを確認します。HostやOriginを書き換える独自のプロキシは追加しないでください。tailnetのアクセスルールはServeにも適用され、Agent Boardはそのうえでリモート用のPC書き込みトークンと同一オリジンのリクエストヘッダーも確認します。

Agent BoardはCtrl+Cで止めます。このServeのルートだけを外すには`tailscale serve --bg http://127.0.0.1:8040 off`を使います。既存の共有されたServeの設定を変える前に、`tailscale serve status`を確認してください。バックグラウンドのServeの設定は再起動後に再開することがありますが、コンピューターがスリープしている間やサーバーが止まっている間は、ボード自体は使えません。

## スマホで確認する

レスポンシブなブラウザテストは狭い画面幅をカバーしますが、ソフトウェアキーボードは実機での確認が必要です。スマートフォンのブラウザでモニターを開き、待機中の質問を持つ未着手または進行中のタスクを探します。キーボードが出ても回答欄と送信ボタンを操作できることを確認し、回答を送信してください。あわせて、長い本文、受入条件、エピックのタブでのスクロール、タブの横スワイプ、ハンドルによる下方向の閉じ操作も確認します。ブラウザのエミュレーションだけでは、Safariのキーボードの挙動は確認できません。

## 次に読む

- [判断依頼](../use/decisions): スマホから質問に回答します。
- [トラブルシューティング](./troubleshooting): ページが開かない、更新されない。
