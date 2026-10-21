# コード構成

リポジトリ内の各モジュールと、その役割をまとめます。各部分がどう連携するかは[Agent Boardの仕組み](../concepts/overview.md)を読んでください。

## コードの場所

| モジュール | 責務 |
| --- | --- |
| `main.rs` | `cli::run()`を呼ぶ。 |
| `cli` | 引数、コマンド、出力の整形、エラーの表示。 |
| `file_store` | 共有領域のデータ形式と読み書き全般。<br>パス、保存、ロック、検証、操作、索引、監視。 |
| `domain` | タスク・レーン・稼働状態・エピック・判断依頼・入力の上限・規則。<br>I/Oなし。 |
| `server` | axumのアプリ、API、SSE、書き込みの保護、埋め込んだWeb資産、モニターの入口。 |
| `agent` | Hookと`wait`。 |
| `progress` | `agboard progress`とHookが共有する進行表を組み立てる。 |
| `interact` | 人による確認（端末の判定、y/N入力）と通知のクライアント。 |
| `setup` | データ領域へのエージェントのアクセスを準備する。 |
| `paths`<br>`lifecycle`<br>`clock`<br>`error` | データ領域の解決、`serve`のロック、UTCの時刻、`AgboardError`（コード・終了コード・message・reason）。 |

依存は一方向です。

`cli`は`agent`・`interact`・`server`・`setup`・`progress`を使います。`agent`は`progress`を使い、`agent`・`progress`・`server`は`file_store`を、`file_store`は`domain`を使います。

`interact`と`setup`は`paths`と`error`だけを使います。`cli`に依存するものはなく、`server`は`cli`・`agent`・`progress`に依存しません。

`domain`はI/Oを行わず、`file_store`への参照は型の別名`HistoryRecord`の一つだけです。

`file_store`のうち、よく触る部分は次のとおりです。

| モジュール | 責務 |
| --- | --- |
| `model` | 永続形式のserdeの型（`deny_unknown_fields`、camelCase、`formatVersion`）。 |
| `layout` | 検証済みのIDだけから所有パスを組み立てる。<br>文字列を直接パスにしない。 |
| `frontmatter`<br>`history`<br>`validate` | 本文とfrontmatterの分割、受入条件と履歴の解析、未知のキーを保ったファイルの検証。 |
| `transaction` | `task.json`と`TASK.md`の組を、永続ジャーナルで保存・復旧する。 |
| `reader` | JSONとMarkdownから、スナップショットと`problems`を組み立てる。 |
| `ops/` | タスク・稼働状態・回答・エピック・画像・自動完了の操作。 |
| `io`・`lock` | renameによる置き換え保存と、`write.lock`・`lifecycle.lock`。 |
| `project`・`bindings` | プロジェクトの一覧と、フォルダの紐付け。 |
| `index`・`watch` | `serve`内のメモリ上の索引と、OSイベントの監視。 |

`server`の中では、ルーター同士が依存し合わず、共有のモジュールに依存します。

| モジュール | 責務 |
| --- | --- |
| `api/` | ボードのルーター、Hostのガードと書き込みのガード、ルートごとにまとめたハンドラ（ページ、プロジェクト、タスク、タスクの編集、multipart、アーカイブ、タスクの画像、エピック、エピックの画像、モバイル接続の`monitor_connections`）。 |
| `monitor/` | モニターの読み取り用ルーター、回答のエンドポイント、資産。 |
| `monitor_connection/` | ngrokのモバイル接続。監督役と状態（`lifecycle`・`start`・`run`）、保存する設定（`config`）、トークンと安全な保管場所への保存（`token`・`keychain`）、公開アドレスの契約と、Traffic Policyなしで開くngrokのエンドポイント（`contracts/`）、ngrokのセッション（`backend`）、モニターの前段の入口の検査（`router`・`entry`と、合言葉のunlockを扱うその`session`の経路）。 |
| `monitor_auth/` | モニターのアプリsessionとCSRFトークン（`session`）、4桁の合言葉と間違いの回数の制限（`passcode`）、そのヘッダーの検査（`guard`）、Cookie名や12時間の上限などの定数（`contracts`）。 |
| `guard` | ローカルとモニターの書き込みに対するHost・Origin・Sec-Fetch-Site・トークンの確認と、HTTPSのoriginの正規化。 |
| `response`<br>`request` | JSONのエラー本文、`AgboardError`からHTTPステータスへの対応、そのほかの共有の応答と、失敗時にそのエラー本文を返すJSONの本文。 |
| `store`<br>`answer` | すべてのルーターが使う、ブロッキングのファイルアクセス・索引・URLのIDと、ボードとモニターが共有する回答の保存。 |
| `web_assets` | 埋め込んだボードとモニターのスクリプトとスタイルシート、それぞれのビルドID、キャッシュできるgzipまたは非圧縮の応答。 |

`src/`以外の主なファイルとディレクトリは次のとおりです。

- `build.rs`: ビルドしたWeb画面を埋め込み、資産の表とビルドIDを書き出します。
- `web/`: Viteのアプリです。`web/src/`のソースは`app/`・`pages/`・`features/`・`shared/`に分けています（[Webコードの置き場所](../concepts/server-and-ui.md#webコードの置き場所)）。
- `web/.storybook/`: Storybookの設定、架空のfixture、decorator、通信ガード、共通部分のテストを置きます。UIのStoryと対応台帳は、説明するソースの近くに置きます。詳しくは[Storybookのセットアップと台帳](../getting-started/setup.md#storybook)を参照してください。
- `tests/`: Rustの結合テストとCLIのテストを置きます。
- `e2e/`: Playwrightのテストと、スクリーンショット・動画の生成スクリプトを置きます。
- `docs/`: このドキュメントサイトです。
- `integrations/`: Hookのテンプレートを置きます。
- `.agents/skills/agent-board/`: エージェントのスキルを置きます。

## 採用技術

<div class="technology-table">

| 用途 | 採用 | 理由 |
| --- | --- | --- |
| 言語 | Rust（stable） | 型・所有権・コンパイラを、AIが書くコードのハーネスとして使う。 |
| CLI | clap（derive） | サブコマンド・help・検証の定番。 |
| Webサーバー | axum<br>tokio | SSEとJSON APIを少ない記述で書ける。tokioは`wait`でも使う。 |
| ファイルの監視 | notify 8.2 | macOSのFSEventsとWindowsのReadDirectoryChangesW。イベントは別のdebouncerなしでtokio上で集約する。 |
| frontmatter | serde_yaml_ng 0.10 | `serde_yaml`は非推奨、`serde_yml`は保守終了。未知のキーは`Value`として保持する。 |
| JSON・日時・ハッシュ | serde / serde_json<br>chrono<br>sha2 | 出力とAPIで共通の型、UTCでの保存、内容のversion。 |
| ほかのRustのクレート | dirs<br>thiserror<br>getrandom<br>reqwest + eventsource-stream<br>toml_edit<br>ngrok<br>keyring | ホームディレクトリ、型付きのエラー、乱数のIDとトークン、`wait`のSSE、`setup`でのコメントを保つTOMLの編集、モバイルモニター用のプロセス内ngrokトンネル、保存したngrokトークンのためのOSの資格情報ストア。 |
| 画面 | TypeScript<br>Vite<br>React | 画面の状態とAPIの形を型で固定する。ビルドはバイナリに埋め込む。 |
| 画面のライブラリ | nuqs<br>shadcn/ui（Radix）<br>Tailwind CSS<br>lucide-react<br>i18next<br>@dnd-kit/react | URLの状態、アクセシブルな部品、スタイル、アイコン、英語と日本語の文言、ドラッグ＆ドロップ。 |
| Markdown | react-markdown + remark-gfm<br>Milkdown Crepe 7.22<br>mermaid 12 | 生のHTMLなしの表示、Markdownとの相互変換に対応するWYSIWYG編集、strictモードの図。 |
| テスト | assert_cmd、predicates、tempfile<br>expectrl<br>Vitest、Testing Library<br>Playwright | 一時的なデータ領域でのCLI、疑似端末でのプロンプト、画面の単体とコンポーネント、ブラウザでのE2E。 |
| ドキュメント | VitePress 1.6<br>mermaid 11 | `docs/package.json`の独立した依存。 |

</div>

既存の依存を、無関係な変更のついでに一括更新しないでください。追加する依存は互換性のある安定版にし、`Cargo.lock`と`web/pnpm-lock.yaml`に固定します。
