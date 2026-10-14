---
title: モバイルモニター
---

# モバイルモニター

モバイルモニターは、席を離れていても進捗を確認し、質問に回答できる、スマートフォン向けのボード表示です。[ガイドの概要](./)と[README](https://github.com/FooQoo/agent-board/blob/main/README.ja.md)に戻れます。

## モニターに表示されるもの

モニターはカードを未着手、進行中、完了にまとめます。AI担当のカードにはエージェントの状態がカード内に表示され、未着手または進行中の待機中の質問には、カード上に回答フォームが表示されます。カードをタップすると、**本文**、**受け入れ条件**、**履歴**、**エピック**のタブを持つドロワーが下から開きます。ドロワーは下から滑り込み、上端のハンドルを下へドラッグすると追従し、閉じる操作で閉じます。各タブの内容は独立してスクロールします。受け入れ条件タブにはカードとエピックの条件が表示されます。エピックタブは、ドロワーと本文にすでに表示されているラベルやタイトルを繰り返さずに、計画を表示します。モニターは待機中の質問に回答できますが、書き込みできる操作はその回答だけです。

![本文タブを開いたカードのドロワーと、4つのタブを表示したモバイルモニター](../../images/mobile.ja.png){.screenshot--narrow}

横スワイプで、タブの内容と下線がいっしょに動きます。タブの内容の中でのジェスチャーはその領域内にとどまります。ドロワーを閉じるには、上端のハンドルをドラッグします。各プロジェクトのエピック一覧は、モニターの初期化時に全体を読み込み、ページを開いている間は保持されます。タブを切り替えてもエピックのリクエストは発生しません。エピック一覧を更新するにはページを再読み込みするか、最初のリクエストが失敗したあとは再試行ボタンを使います。

モニターのHTML、JavaScript、CSS、ビューアのチャンク、APIレスポンスは`Cache-Control: no-store`を使います。モニターにはオフライン用のスナップショットキャッシュもService Workerもありません。再読み込みすると最新のUIとデータを取得し、切断されているときはページが接続の状態を表示します。

以下のコマンドは、[Agent Boardをインストール](./getting-started)したあと、リポジトリのルートから実行します。

## 実機で確認する

レスポンシブなブラウザテストは狭い画面幅をカバーしますが、ソフトウェアキーボードは実機での確認が必要です。スマートフォンのブラウザでモニターを開き、待機中の質問を持つ未着手または進行中のカードを探します。キーボードが出ても回答欄と送信ボタンに届くことを確認し、回答を送信してください。あわせて、長い本文、受け入れ条件、エピックのタブでのスクロール、タブの横スワイプ、ハンドルによる下方向の閉じ操作も確認します。ブラウザのエミュレーションだけでは、Safariのキーボードの挙動は確認できません。

## リモートアクセス

`agboard serve`は通常のPC用リスナーをループバックに保ちます。信頼できるHTTPSプロキシの背後に置くときだけ、別のリモート用リスナーを追加してください。

```sh
agboard serve --port 7420 --remote-port 8040 \
  --remote-origin https://192.168.1.20:8443 \
  --remote-origin https://my-mac.example-tailnet.ts.net
```

実際に公開するオリジンだけを指定してください。リモート用ポートはプロキシのための2つ目のループバックのリスナーです。PC用のローカルポートをプロキシしてはいけません。共通のURLを開くと、768 CSSピクセル未満ではモニター、それより広いとPC用のボードが選ばれます。`/monitor/`と`/board/`を直接開くURLは、幅にかかわらず使えます。PC用のボードはリモートからの書き込みガードを保ちます。モニターのAPIが許すのは、専用の回答リクエストとトークンだけで、ほかの書き込みルートは使えません。

## CaddyでLANに公開する

[Caddyの公式のダウンロードとインストールガイド](https://caddyserver.com/docs/install)から、Caddy 2.8以降をインストールします。標準ビルドで足ります。[`examples/monitor/Caddyfile`](https://github.com/FooQoo/agent-board/blob/main/examples/monitor/Caddyfile)のCaddyfileは、選んだLANのIPにバインドし、Caddyの内部HTTPS認証局を使い、すべてのルートで[Basic認証](https://caddyserver.com/docs/caddyfile/directives/basic_auth)を要求します。専用のリモート用ポートへだけ転送し、Agent Boardのガードのためにブラウザのホストとオリジンを保ち、Authorizationと`X-Forwarded-Host`を取り除き、[SSEをすぐにフラッシュ](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)します。この例はCaddyの管理APIとルート証明書の自動インストールを無効にしており、ローカルのテストは一時的な公開ルートを直接読みます。

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

信頼できる同じLAN上の端末で`https://<LAN_IP>:<HTTPS_PORT>/`を開き、Basic認証の資格情報を入力します。Caddyの`tls internal`の証明書は、Caddyのローカル認証局が署名したもので、スマートフォンは既定ではこれを信頼しません。公開ルート証明書は`<Caddy data directory>/pki/authorities/local/root.crt`にあります(たとえば`XDG_DATA_HOME`を設定していれば`$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt`。[Caddyのデータディレクトリの規約](https://caddyserver.com/docs/conventions#data-directory)を参照)。その公開証明書だけを信頼できる経路でスマートフォンへコピーし、スマートフォンOSの手順で信頼させてください。Caddyの認証局の秘密鍵は、コピーも配布もしないでください。Caddyのデータディレクトリは永続的です。非公開にし、バックアップしてください。ルーターのポート転送を有効にしたり、このリスナーを公開インターネットに出したりしないでください。

2つのフォアグラウンドのプロセスはCtrl+Cで止めます。コンピュータがスリープしたり、どちらかのプロセスが止まったりすると、Agent BoardとCaddyが再び動くまでリモートのサービスは使えません。

## Tailscale Serve

[お使いのOS用のTailscaleスタンドアロンアプリ](https://tailscale.com/download)をインストールし、Tailscale CLI 1.52以降を使います。[現在のServe CLIの構文](https://tailscale.com/docs/reference/tailscale-cli/serve)は1.52で変わりました。コンピュータとスマートフォンを既存のtailnetに追加します。tailnetの管理画面で、アクセスを自分のアカウントと、このボードへ届かせたい特定の端末だけに制限してください。ServeにはtailnetでHTTPS証明書が有効である必要があり、Serveを呼び出すとその変更の承認を求められることがあります。同意のページを確認してから承認してください。[tailnetのアクセスルールはServeにも適用されます](https://tailscale.com/docs/features/tailscale-serve)。

Agent Boardを専用のリモート用ポートで起動し、そのループバックのポートに対してServeを開始します。

```sh
agboard serve --port 7420 --remote-port 8040 \
  --remote-origin https://<origin-shown-by-tailscale>
tailscale serve --bg http://127.0.0.1:8040
tailscale serve status
tailscale funnel status
```

Agent Boardを起動する前に、`tailscale serve status`が表示する正確なHTTPSオリジンを`--remote-origin`に指定してください。Serveがtailnetの中だけで有効で、Funnelがサービスを公開していないことを確認します。HostやOriginを書き換える独自のプロキシは追加しないでください。tailnetのアクセスルールはServeにも適用され、Agent Boardはそのうえでリモート用のPC書き込みトークンと同一オリジンのリクエストヘッダーも確認します。

Agent BoardはCtrl+Cで止めます。このServeのルートだけを外すには`tailscale serve --bg http://127.0.0.1:8040 off`を使います。既存の共有されたServeの設定を変える前に、`tailscale serve status`を確認してください。バックグラウンドのServeの設定は再起動後に再開することがありますが、コンピュータがスリープしている間やサーバーが止まっている間は、ボード自体は使えません。
