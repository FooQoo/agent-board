# コード構成

リポジトリ内の各モジュールと、その役割をまとめます。各部分がどう連携するかは[Agent Boardの仕組み](../concepts/overview.md)を読んでください。

## コードの場所

| モジュール | 責務 |
| --- | --- |
| `main.rs` | `cli::run()`を呼ぶ。 |
| `cli` | 引数、コマンド、出力の整形、エラーの表示。 |
| `file_store` | 共有領域のデータ形式と読み書き全般。<br>パス、保存、ロック、検証、操作、索引、監視。 |
| `docs` | プロジェクトのドキュメント。パスの規則（`paths`）、共通の型（`model`）、ツリー・ファイル・画像の読み込み（`reader`）、`revision`を確かめる保存（`writer`）、`revision`の計算（`revision`）、新しい`docs/`に置くREADME（`templates`）。 |
| `domain` | タスク・レーン・稼働状態・エピック・判断依頼・入力の上限・規則。<br>I/Oなし。 |
| `server` | axumのアプリ、API、SSE、書き込みの保護、埋め込んだWeb資産、モニターの入口。 |
| `agent` | Hookと`wait`。 |
| `progress` | `agboard progress`とHookが共有する進行表を組み立てる。 |
| `interact` | 人による確認（端末の判定、y/N入力）と通知のクライアント。 |
| `setup` | データ領域へのエージェントのアクセスを準備する。 |
| `paths`<br>`lifecycle`<br>`clock`<br>`error` | データ領域の解決、`serve`のロック、UTCの時刻、`AgboardError`（コード・終了コード・message・reason）。 |

依存は一方向です。

`cli`は`agent`・`interact`・`server`・`setup`・`progress`を使います。`agent`は`progress`を使い、`agent`・`progress`・`server`は`file_store`を、`file_store`は`domain`を使います。`server`は`docs`を使い、`docs`はパスと保存に`file_store`の`layout`と`io`を使います。`file_store`が`docs`から使うのは、新しい`docs/`のREADMEを選ぶ`DocsLocale`だけです。

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
| `projection` | 解析済みのスナップショットから作るプロジェクトのSummaryと、2つの投影の間の変更の組。タスクとエピックごとのversionを持つ。 |
| `detail` | 1つのDetailストリームのデータ。スナップショットからコピーし、そこからNDJSONのイベントを作る。読むのは画像のヘッダーだけ。 |
| `ops/` | タスク・稼働状態・回答・エピック・画像・自動完了の操作。 |
| `io`・`lock` | renameによる置き換え保存と、`write.lock`・`lifecycle.lock`。 |
| `project`・`bindings` | プロジェクトの一覧と、フォルダの紐付け。 |
| `index`・`watch` | `serve`内のメモリ上の索引と、OSイベントの監視。 |

`server`の中では、ルーター同士が依存し合わず、共有のモジュールに依存します。

| モジュール | 責務 |
| --- | --- |
| `api/` | ボードのルーター、Hostのガードと書き込みのガード（`guards`）、ルートごとにまとめたハンドラ（ページ、プロジェクト、タスク、タスクの編集、multipart、アーカイブ、タスクの画像、エピック、エピックの画像、プロジェクトのドキュメントの`docs/`（`tree`・`file_get`・`file_put`・`assets`・`open`）、モバイル接続の`monitor_connections`）。 |
| `monitor/` | モニターの読み取り用ルーター、回答のエンドポイント、資産。 |
| `monitor_connection/` | ngrokのモバイル接続。監督役と状態（`lifecycle`・`start`・`run`）、保存する設定（`config`）、トークンと安全な保管場所への保存（`token`・`keychain`）、公開アドレスの契約と、Traffic Policyなしで開くngrokのエンドポイント（`contracts/`）、ngrokのセッション（`backend`）、モニターの前段の入口の検査（`router`・`entry`と、合言葉のunlockを扱うその`session`の経路）。 |
| `preferences/` | 保存した言語とカラーテーマ。内部領域の`preferences.json`（`PreferencesStore`）、PCとモニターで共有する`GET`・`PUT`の処理、変更の通知。 |
| `monitor_auth/` | モニターのアプリsessionとCSRFトークン（`session`）、4桁の合言葉と間違いの回数の制限（`passcode`）、そのヘッダーの検査（`guard`）、Cookie名や12時間の上限などの定数（`contracts`）。 |
| `guard` | ローカルとモニターの書き込みに対するHost・Origin・Sec-Fetch-Site・トークンの確認と、HTTPSのoriginの正規化。 |
| `response`<br>`request` | JSONのエラー本文、`AgboardError`からHTTPステータスへの対応、そのほかの共有の応答と、失敗時にそのエラー本文を返すJSONの本文。 |
| `store`<br>`answer` | すべてのルーターが使う、ブロッキングのファイルアクセス・索引・URLのIDと、ボードとモニターが共有する回答の保存。 |
| `web_assets` | 埋め込んだボードとモニターのスクリプトとスタイルシート、それぞれのビルドID、キャッシュできるgzipまたは非圧縮の応答。 |
| `contracts/` | データ層の通信の型。Summary、DetailのNDJSONの各行、`changed`イベント。`tests/fixtures/data-layer/`の例が形を固定します。 |
| `change_feed.rs` | このサーバーの実行で変更の組に番号（`seq`、実行ごとの`instanceId`）を付け、まだ送っていないイベントを保持する。遅れすぎたストリームには`resync`を送る。 |
| `summary_response.rs`<br>`api/summary.rs`・`api/detail.rs`・`monitor/data.rs` | `ETag`付きのSummaryの応答と、Detailのストリーム。ボードとモニターは同じ組み立て処理を使う。 |

`src/`以外の主なファイルとディレクトリは次のとおりです。

- `build.rs`: ビルドしたWeb画面を埋め込み、資産の表とビルドIDを書き出します。
- `web/`: Viteのアプリです。`web/src/`のソースは`app/`・`pages/`・`features/`・`shared/`に分けています（[Webコードの置き場所](../concepts/server-and-ui.md#webコードの置き場所)）。
- `src/domain/markdown_blocks.rs`: 本文をトップレベルのMarkdownブロックに分けます。I/Oは行いません。
- `web/src/shared/data/`: データ層です。`api/`は契約の型とDetailの解析、`core/`はReactに依存しないキャッシュ・スケジューラー・イベント接続、`react/`は画面が使うフックを置きます。[データの読み取りと更新](../concepts/server-and-ui.md#データの読み取りと更新)を参照してください。
- `web/src/shared/markdown/`: Markdownの描画部です。`MarkdownBlocks`は本文のブロックを描き、大きい本文を仮想化します（`VirtualMarkdown.tsx`）。
- `web/src/shared/preferences/`: ブラウザ側の保存した言語とカラーテーマ。読み取りと保存、ブラウザの最初の描画用の控え、`preferences`イベントを扱います。[サーバーと画面](../concepts/server-and-ui.md)を参照してください。
- `web/.storybook/`: Storybookの設定、架空のfixture、decorator、通信ガード、共通部分のテストを置きます。UIのStoryと対応台帳は、説明するソースの近くに置きます。詳しくは[Storybookのセットアップと台帳](../getting-started/setup.md#storybook)を参照してください。
- `tests/`: Rustの結合テストとCLIのテストを置きます。
- `e2e/`: Playwrightのテストと、スクリーンショット・動画の生成スクリプトを置きます。
- `docs/`: このドキュメントサイトです。
- `integrations/`: Hookのテンプレートを置きます。
- `.agents/skills/agent-board/`: エージェントのスキルを置きます。

### プロジェクトのドキュメント

- `src/docs/`: パス、読み込み、保存、READMEの文面（`templates/README.en.md`・`templates/README.ja.md`）。
- `src/server/api/docs/`: ボードのルーターにある4つのルート。
- `src/file_store/project.rs`: 新しいプロジェクトと一緒に`docs/`を作る処理（`create_project_with_docs`）と、起動時に補う処理（`ensure_docs_dirs`）。
- `web/src/features/docs/`: リクエスト（`api/docsApi.ts`）、ツリー・ファイル・編集の状態（`model/`）、ダイアログ（`ui/DocsDialogContainer.tsx`。外枠とファイル一覧は`ui/shell/`、本文の欄・フロントマター・競合のバナーは`ui/document/`）。
- `web/src/shared/markdown/frontmatter.ts`と`resolveRelativeImage.ts`: ダイアログが使う、フロントマターの分離と相対パスの画像の解決。
- `tests/docs_*.rs`: ルート、読み込み、保存、README、モニターとの境界のRustの試験。

### 初回の案内

- `src/file_store/onboarding_state.rs`: 状態ファイル、そのロック、run の型。
- `src/file_store/onboarding_model.rs`: サンプルの識別と検査。
- `src/file_store/ops/onboarding.rs`: 案内の操作。
- `src/server/api/onboarding.rs`: 案内の経路。
- `web/src/app/onboarding/`: 要求の窓口、制御、層。
- `web/src/features/onboarding/ui/`: 表示部品。
- `e2e/tests/onboarding.spec.ts`: E2E 試験。

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
