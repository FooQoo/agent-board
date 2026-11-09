# ブラウザのデモ

ブラウザのデモは、`agboard serve`を置かずに静的サイトの上でボードを動かすものです。このドキュメントサイトと一緒に[`/agent-board/demo/`](https://fooqoo.github.io/agent-board/demo/)で公開しています。画面は製品と同じもので、サーバーだけがページ内で動くサンプルデータのサーバーに置き換わっています。

訪れた人には、まず[初回の案内](../../guide/quickstart.md#before-you-start-the-first-run-guide)が表示され、そのあと通常のボードを操作できます。このページでは、その仕組み、ビルドの方法、公開前に確かめる方法を説明します。

## 仕組み

```mermaid
flowchart LR
    Screens["ボードの画面<br/>(変更なし)"] -->|"fetch and EventSource"| Shim["デモの通信<br/>demo/transport.ts"]
    Screens -->|"img src"| Images["画像の差し替え<br/>demo/images.ts"]
    Shim --> Core["サンプルデータのサーバー<br/>mock-server/"]
    Images --> Core
    Core --> Boards["ボードと案内<br/>(メモリ上)"]
```

`app/entry/board.tsx`は`import.meta.env.MODE`を見ます。`demo`モードでは、まず`web/src/app/development/demo/install.ts`を読み込んで通信を差し替え、そのあとでボードを描画します。ほかのビルドはこの読み込みを通らないため、製品のビルドにデモのコードは含まれません。

### サンプルデータのサーバー

`web/src/app/development/mock-server/`は、メモリ上のボードから`agboard serve`と同じように`/api/*`に応答します。NodeのAPIを使わないので、次の2つの通信路で共有しています。

- `web/mock-api.ts`は、[サンプルデータモード](../getting-started/setup.md#開発)（`pnpm --dir web dev --mode mock`）でViteの開発サーバーの後ろに置きます。
- デモは、ページの`fetch`と`EventSource`の後ろに置きます。

ボードは、サーバーが起動するたびに`web/test/fixtures/board.json`から作り直します。デモのビルドは、このフィクスチャをビルド時に`virtual:agboard-demo-seed`モジュールとして読み込みます（`web/demo-build.ts`）。読み取りに加えて、訪れた人ができる書き込みにも応答します。

- カードの作成、編集、レーン間の移動、レーン内の並べ替え
- 判断依頼への回答
- 受入条件のチェックと、そのあとの自動Done。すべての条件を満たしたAIのタスクを、サーバーの監視と同じようにDoneに移します（`completion.ts`）

変更はそれぞれSSEの`changed`イベントと同じ形で購読者に届くので、画面は本物のサーバーを相手にしたときと同じように更新されます。

### fetchとEventSourceの差し替え

`demo/transport.ts`は`window.fetch`と`window.EventSource`を置き換えます。

- ページと同じオリジンの`/api/`または`/__mock/`へのリクエストは`MockRequest`になり、サンプルデータのサーバーが応答します。それ以外はブラウザの`fetch`に渡します。
- リクエストの本文はテキストとして読みます。マルチパートのフォームは、開発サーバーと同じく`metadata`フィールドだけを読みます。
- 置き換えた`EventSource`は次のタスクで接続を開いて`ready`を送り、そのあとの変更は、それを起こした書き込みへの応答のあとに届けます。ネットワーク越しと同じ順序です。

画像は`fetch`を通りません。`demo/images.ts`がページを監視し、サーバーを指す`<img>`を、同じページ内のサーバーが返す`data:` URLに書き換えます。

### 初回の案内

案内のルート（`mock-server/guide.ts`、`guideState.ts`、`guideCards.ts`）は`agboard serve`に合わせてあります。リース、開始、台本どおりの手順、完了、中断を扱います。案内はAIの役を担い、2枚のサンプルカードを作って1枚をDoneまで進め、もう1枚で質問を出し、回答を受けてから完了させます。

案内の状態はメモリにしかありません。新しいページは新しいサーバーなので、ページを開くたびに案内が始まり、**スキップ**はそのページでだけ案内を閉じます。画面での手順は[クイックスタート](../../guide/quickstart.md#before-you-start-the-first-run-guide)を参照してください。

### 言語

デモは、訪れた人のブラウザの言語で始まります。`demo/install.ts`が`demo/locale.ts`を通して`navigator.languages`の先頭を読み、`ja`で始まれば日本語、それ以外は英語にします。最初の画面を描く前にその言語を適用するので、画面と初回の案内はその言語で始まります。同じ言語を`locale`としてサンプルデータのサーバーにも渡します。

サンプルのボードは英語のフィクスチャから作ります。日本語で始めるときは、`mock-server/sampleJa.ts`が日本語の文に置き換えます。対象はカードのタイトルと説明、履歴、回答待ちの理由、選択肢、受入条件、エピック名、長いMarkdownの説明です。カードのID、レーン、状態は変わりません。サンプルデータモード（`pnpm --dir web dev --mode mock`）は`locale`を渡さないので、英語のままです。

以前の訪問でブラウザに残った言語は使いません。設定で言語を選ぶとすぐに切り替わり、ページを再読み込みするまでその言語のままです。再読み込みすると、またブラウザの言語に従います。サンプルデータは、始めたときの言語のままです。

### 隠している機能

静的サイトには手元のコンピューターも`agboard serve`もないので、それらが必要な機能はデモでは隠しています。

| 機能 | 隠している場所 | 理由 |
| --- | --- | --- |
| プロジェクトのDocs | `BoardWorkspace.tsx`が`onDocs`を渡さないので、ヘッダーに**Docs**ボタンが出ない | Docsはコンピューター上のファイルやフォルダーを開くため。 |
| モバイル接続 | `BoardSettings.tsx`が接続の行とダイアログを出さない | スマホは`agboard serve`に接続するため。 |
| 添付 | `EditorBody.tsx`と`RequestDialog.tsx`が画像の欄を出さず、貼り付けやドロップした画像を無視する | 何も保存しないので、置き場所がないため。 |
| 言語とテーマの保存 | `app/entry/board.tsx`と`BoardSettings.tsx`が`/api/preferences`を使わない | 保存するサーバーがないため。テーマはサンプルデータモードと同じくブラウザの中に残し、言語はページを開くたびにブラウザに従う。 |

ページのトークンは固定で、ビルドIDは空です。そのため新しいビルドを理由に再読み込みすることはありません。何も保存しないので、再読み込みするとサンプルデータから始まります。

## ビルドする

コマンドとベースパスの指定は、[開発環境のセットアップのデモビルド](../getting-started/setup.md#demo-build)にあります。要点は、`pnpm --dir web build:demo`がベース`/agent-board/demo/`向けに`web/dist-demo/`を書き出し、`AGBOARD_DEMO_BASE`でベースを変えられることです。

`.github/workflows/docs.yml`は、ドキュメントサイトをビルドし、デモをビルドし、`web/dist-demo/`を`docs/.vitepress/dist/demo/`にコピーします。VitePressはビルドのたびに出力フォルダーを空にするので、コピーはサイトのビルドのあとです。サイトのワークフローのそのほかの部分は[ドキュメントと画像](../docs-and-images.md#ドキュメントサイト)を参照してください。

## 手元で確かめる

さっと見るだけなら、[デモビルド](../getting-started/setup.md#demo-build)にあるとおり`pnpm --dir web preview:demo`でデモだけを配信できます。

公開されるときと同じ形で確かめるには、デモを含めたサイトをビルドしてから、デモのスイートを実行します。

```sh
pnpm --dir docs build
pnpm --dir web build:demo
rm -rf docs/.vitepress/dist/demo
cp -R web/dist-demo docs/.vitepress/dist/demo
pnpm --dir e2e test:demo
```

このスイート（`e2e/playwright.demo.config.ts`と`e2e/demo/`）は、`docs/.vitepress/dist/`を`vitepress preview`でポート8446（または`AGBOARD_DEMO_E2E_PORT`）から配信し、Chromiumで`/agent-board/demo/`を開きます。ドキュメントサイトのスイートと同じく、ボードがページの中にあるので、Rustのビルドも`AGBOARD_HOME`も要りません。確かめる内容は次のとおりです。

- ページを開くと案内が始まり、質問への回答を含めて最後まで進む
- 案内のあと、カードを別のレーンにドラッグで移動できる
- 回答待ちのカードに回答し、残りの受入条件をチェックすると、自動でDoneに移る
- Docsボタンとモバイル接続がなく、再読み込みするとサンプルデータから始まる
- `ja-JP`のブラウザでは、画面、案内、サンプルのカードが日本語で始まる
- 設定で選んだ言語は再読み込みまで続き、再読み込みするとブラウザの言語で始まる

英語のテストはブラウザのロケールを`en-US`に、日本語のテストは`ja-JP`に、`test.use({ locale })`で設定しています。

Pagesのワークフローは、デモをコピーしたあと、何かをアップロードする前に、プルリクエストでも同じスイートを実行します。そのため、壊れたデモが公開されることはありません。

デモの画面を変えたときは、[規約](../getting-started/pull-request.md#規約)にあるとおり、デスクトップとスマホの幅、ライトとダークのテーマでも見てください。
