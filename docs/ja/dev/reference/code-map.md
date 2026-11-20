# コード構成

リポジトリ内の各モジュールと、その役割をまとめます。各部分がどう連携するかは[Agent Boardの仕組み](../concepts/overview.md)を読んでください。

## コードの場所

| モジュール | 責務 |
| --- | --- |
| `main.rs` | `cli::run()`を呼ぶ。 |
| `cli` | 引数、コマンド、出力の整形、エラーの表示。 |
| `file_store` | 共有領域のデータ形式と読み書き全般。<br>パス、保存、ロック、検証、操作、索引、監視。 |
| `docs` | プロジェクトのドキュメント。パスの規則（`paths`）、共通の型（`model`）、ツリー・ファイル・画像の読み込み（`reader`）、ファイルの内容の`revision`の計算（`revision`）、新しい`docs/`に置くREADME（`templates`）。 |
| `domain` | タスク・レーン・稼働状態・エピック・質問・入力の上限・規則。<br>I/Oなし。 |
| `server` | axumのアプリ、API、SSE、書き込みの保護、埋め込んだWeb資産、ngrokの入口。 |
| `agent` | Hookと`wait`。 |
| `autostart` | コマンドが必要とするときに共有のサーバーを起動する。確認、`autostart.lock`、切り離した`serve --auto`の子プロセス（`spawn`）、`autostart.paused`の目印。 |
| `progress` | `agboard progress`とHookが共有する進行表を組み立てる。 |
| `interact` | 人による確認（端末の判定、y/N入力）、通知のクライアント、ボードのページをブラウザーで開く処理（`browser`：ボードのアドレス、開かない場合の判定、OSごとに開くプログラム）。 |
| `setup` | Agent Boardプラグインを導入・更新し、データ領域へのエージェントのアクセスを準備する。 |
| `paths`<br>`lifecycle`<br>`clock`<br>`error` | データ領域の解決、`serve`のロック、UTCの時刻、`AgboardError`（コード・終了コード・message・reason）。 |

依存は一方向です。

`cli`は`agent`・`autostart`・`interact`・`server`・`setup`・`progress`を使います。`agent`と`cli`は`autostart`を使い、`autostart`は`server`と`file_store`を使います。`agent`は`progress`を使い、`agent`・`progress`・`server`は`file_store`を、`file_store`は`domain`を使います。`server`は`docs`を使い、`docs`はパスと読み込みのエラーに`file_store`の`layout`と`io`を使います。`file_store`が`docs`から使うのは、新しい`docs/`のREADMEを選ぶ`DocsLocale`だけです。

`interact`と`setup`は`paths`・`error`・`domain`だけを使います。`interact::browser`は、`agboard`のコマンドラインで動いているかどうかを`autostart`にも尋ねます。`server`は、Docsの経路でOSごとに開くプログラムを選ぶのに`interact::browser`を使います。`cli`に依存するものはなく、`server`は`cli`・`agent`・`progress`に依存しません。

`domain`はI/Oを行わず、`file_store`への参照は型の別名`HistoryRecord`の一つだけです。

`file_store`のうち、よく触る部分は次のとおりです。

| モジュール | 責務 |
| --- | --- |
| `model` | 永続形式のserdeの型（`deny_unknown_fields`、camelCase、`formatVersion`）。 |
| `layout` | 検証済みのIDだけから所有パスを組み立てる。<br>文字列を直接パスにしない。 |
| `frontmatter`<br>`history`<br>`validate` | 本文とfrontmatterの分割、完了条件と履歴の解析、未知のキーを保ったファイルの検証。 |
| `transaction` | `task.json`と`TASK.md`の組を、永続ジャーナルで保存・復旧する。複数のファイルをまとめて保存するバッチのジャーナル（`batch.rs`）も持つ。 |
| `message.rs` | 質問と依頼の共通の形（`Message`、`MessageSource`トレイト、`Question`・`Request`の2つの型）と、Summaryの`messages`の一覧。 |
| `qa/` | メッセージ。質問と依頼のモデル（`model.rs`）、`QA.md`の読み書き（`codec.rs`）、ファイルが満たす規則（`check.rs`）、メッセージの置き場所と読み方（`store.rs`）、タスクに導く状態（`derive.rs`）、呼び出し側が受け取るビュー（`view.rs`）。 |
| `reader` | JSONとMarkdownから、スナップショットと`problems`を組み立てる。 |
| `projection` | 解析済みのスナップショットから作るプロジェクトのSummaryと、2つの投影の間の変更の組。タスクとエピックごとのversionを持つ。 |
| `detail` | 1つのDetailストリームのデータ。スナップショットからコピーし、そこからNDJSONのイベントを作る。読むのは画像のヘッダーだけ。 |
| `ops/` | タスク・稼働状態・メッセージ（`qa/`: 質問・回答・依頼の送信・受け付け・取り下げ・参照・読み出しと、旧形式の一度きりの変換`migrate.rs`）・人による完了条件のチェック・エピック・画像・自動完了の操作。 |
| `io`・`lock` | renameによる置き換え保存と、`write.lock`・`lifecycle.lock`。 |
| `project`・`bindings` | プロジェクトの一覧と、フォルダの紐付け。 |
| `index`・`watch` | `serve`内のメモリ上の索引と、OSイベントの監視。 |

`server`の中では、ルーター同士が依存し合わず、共有のモジュールに依存します。

| モジュール | 責務 |
| --- | --- |
| `api/` | ボードのルーター（`router`と、ローカルのガードとローカル専用の経路を外したngrokの入口用の`remote_router`）、Hostのガードと書き込みのガード（`guards`）、ルートごとにまとめたハンドラ（ページ、プロジェクト、タスク、タスクの編集、人による完了条件のチェック（`task_acceptance`）、multipart、アーカイブ、タスクの画像、エピック、エピックの画像、プロジェクトのドキュメントの`docs/`（`tree`・`file_get`・`assets`・`open`）、リモート接続の`monitor_connections`）。 |
| `monitor_connection/` | ngrokのリモート接続。監督役と状態（`lifecycle`・`restore`・`start`・`run`）、保存する設定（`config`。コマンドラインからの保存は`src/remote_settings.rs`を通ります）、トークンと安全な保管場所への保存（`token`・`keychain`）、公開アドレスの契約と、Traffic Policyなしで開くngrokのエンドポイント（`contracts/`）、ngrokのセッション（`backend`）、モニターの前段の入口の検査（`router`・`entry`と、合言葉のunlockを扱うその`session`の経路）。 |
| `notification_settings/` | スマホに届ける通知の種類。内部領域の`notification-settings.json`（`NotificationSettingsStore`）、種類・サマリーの間隔・既定値の定義、`/api/notification-settings`の`GET`・`PUT`の処理。 |
| `preferences/` | 保存した言語とカラーテーマ。内部領域の`preferences.json`（`PreferencesStore`）、`/api/preferences`の`GET`・`PUT`の処理、変更の通知。 |
| `monitor_auth/` | 入口のアプリsessionとCSRFトークン（`session`）、4桁の合言葉と間違いの回数の制限（`passcode`）、そのヘッダーの検査（`guard`）、Cookie名や12時間の上限などの定数（`contracts`）。 |
| `guard` | ローカルの書き込みに対するHost・Origin・Sec-Fetch-Site・トークンの確認。 |
| `response`<br>`request` | JSONのエラー本文、`AgboardError`からHTTPステータスへの対応、そのほかの共有の応答と、失敗時にそのエラー本文を返すJSONの本文。 |
| `store`<br>`qa`<br>`acceptance` | すべてのルーターが使う、ブロッキングのファイルアクセス・索引・URLのIDと、メッセージの読み出し、回答の保存、依頼の送信と取り下げ（`messages.rs`。ボードのハンドラーは`api/messages.rs`）、人による完了条件1件の設定。 |
| `web_assets` | 埋め込んだボードのスクリプトとスタイルシート、ビルドID、キャッシュできるgzipまたは非圧縮の応答。 |
| `contracts/` | データ層の通信の型。Summary、DetailのNDJSONの各行、`changed`イベント。`tests/fixtures/data-layer/`の例が形を固定します。 |
| `launch`<br>`bind`<br>`idle` | サーバー一つの起動と終了（`launch`）。待ち受けと、その失敗の意味、ポートを使っているもの、空きポートへの切り替え（`bind`）。自動のサーバーで「使われている」とみなすものと、使われないときの停止（`idle`）。 |
| `change_feed.rs` | このサーバーの実行で変更の組に番号（`seq`、実行ごとの`instanceId`）を付け、まだ送っていないイベントを保持する。遅れすぎたストリームには`resync`を送る。 |
| `summary_response.rs`<br>`api/summary.rs`・`api/detail.rs` | `ETag`付きのSummaryの応答と、Detailのストリーム。 |

`src/`以外の主なファイルとディレクトリは次のとおりです。

- `build.rs`: ビルドしたWeb画面を埋め込み、資産の表とビルドIDを書き出します。
- `web/`: Viteのアプリです。`web/src/`のソースは`app/`・`pages/`・`features/`・`shared/`に分けています（[Webコードの置き場所](../concepts/server-and-ui.md#webコードの置き場所)）。
- `src/domain/markdown_blocks.rs`: 本文をトップレベルのMarkdownブロックに分けます。I/Oは行いません。
- `web/src/shared/data/`: データ層です。`api/`は契約の型とDetailの解析、`core/`はReactに依存しないキャッシュ・スケジューラー・イベント接続、`react/`は画面が使うフックを置きます。[データの読み取りと更新](../concepts/server-and-ui.md#データの読み取りと更新)を参照してください。
- `web/src/shared/lib/gesture/sortableDrag.ts`: カードをグループにまたがって並べ替える一覧（ボードのレーンと、エピック編集画面のウェーブ）が共有する、ドラッグ操作と落とし先の判定です。`cardSensors`（`cardActivationConstraints`と`GRIP_CLASS`を含む）は、カード全体をドラッグ対象にし、グリップへのタッチはすぐに、ほかへのタッチは短く押したままにしてからドラッグを始めるので、スワイプのスクロールは妨げられません。`dropPlacement`は、終わったドラッグを、グループ、そのグループのほかの項目の中での位置、動かなかったかどうかとして読みます。並べ替えの項目は`useSortable({ group })`で、落とし先の領域は`data.group`でグループを示します。
- `web/src/features/epics/editor/`: エピックのダイアログです。`waveModel.ts`はウェーブの純粋な操作（`normalizeWaves`、`moveTask`、`moveWave`、`waveStatuses`）、`EpicProgressList.tsx`はドラッグの範囲と落としたときの処理、`WaveRow.tsx`は1つのウェーブ（見出し、ハンドル、カードの行）、`WaveTask.tsx`は1枚のカード、`useEpicEditor.ts`は`waves`を保存する編集の状態を持ちます。[作業順序を決める](../../guide/watch/epics.md)を参照してください。
- `web/src/shared/markdown/`: Markdownの描画部です。`MarkdownBlocks`は本文のブロックを描き、大きい本文を仮想化します（`VirtualMarkdown.tsx`）。`collectImages.ts`は1つの本文にある画像を並べ、`EnlargedImages.tsx`はそれらをまたいで拡大表示を開きます。
- `web/src/shared/ui/lightbox/`: 画像や図の拡大表示です。`Lightbox`はダイアログの枠（図にも使います）、`ImageViewer`はスワイプで切り替えるビューア、`ImageLightbox`はその2つを組み合わせたものです。スタイルは`web/src/shared/styles/lightbox.css`にあります。
- `web/src/features/notification-settings/`: 設定ダイアログの「通知」の行と、それが開くダイアログ。読み取りと保存、およびサーバーと同じ種類と既定値を持ちます。
- `web/src/shared/preferences/`: ブラウザ側の保存した言語とカラーテーマ。読み取りと保存、ブラウザの最初の描画用の控え、`preferences`イベントを扱います。[サーバーと画面](../concepts/server-and-ui.md)を参照してください。
- `web/.storybook/`: Storybookの設定、架空のfixture、decorator、通信ガード、共通部分のテストを置きます。UIのStoryと対応台帳は、説明するソースの近くに置きます。詳しくは[Storybookのセットアップと台帳](../getting-started/setup.md#storybook)を参照してください。
- `tests/`: Rustの結合テストとCLIのテストを置きます。
- `e2e/`: Playwrightのテストと、スクリーンショット・動画の生成スクリプトを置きます。
- `docs/`: このドキュメントサイトです。
- `plugins/agent-board/`: Agent Boardプラグインです。マニフェスト、`skills/agent-board/`の`agent-board`スキルの薄い入口、`skills/remote/`の`remote`スキル、`skills/wait/`の`wait`スキル、`hooks/`の各エージェントのHookを置きます。
- `.agents/plugins/marketplace.json`と`.claude-plugin/marketplace.json`: CodexとClaude Codeのマーケットプレイスのカタログです。

### プラグインのsetupとupdate

- `src/setup/`: `mod.rs`（エージェントとオプション）、`prepare.rs`（読み取りだけの計画）、`execute.rs`（計画の実行）、`report.rs`（テキストとJSONの結果、終了コード）。`plan.rs`・`codex.rs`・`claude.rs`が設定の変更を求め、`apply.rs`と`apply/files.rs`がバックアップを取りながら書き込みます。`env.rs`はパスを解決し、`agent_cli.rs`はエージェントのコマンドを実行し、`plugin.rs`はマーケットプレイスからプラグインを導入し、`trust.rs`は`codex app-server`を通してCodexのhookを信頼します。
- `src/cli/commands/setup.rs`: `agboard setup`と`agboard update`のオプション、エージェントの選択、確認の質問。`setup_remote.rs`は`agboard setup remote`と、`setup`の任意のリモートアクセスの手順、`remote.rs`は`agboard show remote`です。`src/cli/run/remote.rs`は、プロジェクトの保存領域が要らないときに、この二つを実行します。`src/remote_settings.rs`は、保存するngrok設定の、共有された検証と保存です。
- `src/nudge/`: エージェントが忘れやすいことのリマインダー。`mod.rs`にルールの登録簿の型と2つの実行方法（進行表向けの`state_reminders`、Stopフック向けの`turn_end_reminders`）、`rules.rs`に`RULES`の一覧、`turn.rs`にClaude CodeとCodexのトランスクリプトの読み取り、`cases.rs`に全ルールのテストケース、`coverage.rs`に全コマンドと進行表のフィールドをルールに対応付ける表があります。Stopフック本体は`src/agent/stop/`です。[忘れごとのルール](../concepts/agents.md#nudge-rules)を参照してください。
- `src/skills/`: `agboard skills`が出力する`agent-board`スキルの本文（`agent-board.md`、`topics/`）。
- `src/plugin_hash.rs`、`src/setup/auto_update.rs`、`src/setup/auto_update/`: プラグインの内容のハッシュ（`build.rs`が計算）と、Hookの自動更新、そのロックと記録。`tests/plugin_auto_update.rs`と`tests/skills_command.rs`がテストします。
- `tests/setup.rs`と`tests/setup_plugin.rs`: 偽のエージェントのコマンド（`tests/support/fake_agents.rs`）を相手にしたsetupとupdateのテスト。`tests/plugin_layout.rs`は、マーケットプレイスとプラグインのファイルと、その版を確かめます。
- `src/cli/commands/message/`と`src/cli/args/message.rs`: `agboard message`の各コマンド、そのJSON入力（`input.rs`）、`message ask`と`message wait`のJSON Linesのイベント（`stream.rs`）。待機そのものは、共通の待機エンジンの上に作った`src/agent/message_wait.rs`です。
- `web/src/features/tasks/messages/`: メッセージの一覧。`model/messages.ts`はタブ・件数・`canSendAnswer`、`api.ts`はメッセージの読み出しと回答・取り下げの送信、`MessageBand.tsx`は件数を示す帯（PCのボードとスマホ画面で共通）、`MessageCenter.tsx`は帯と一覧をつなぎ、`MessageRows.tsx`は行を描き、`MessagesSurface.tsx`は一覧・質問・依頼をモーダルまたは下からのシートで表示します。`web/src/features/tasks/answer/`は質問と回答の欄（`DecisionQuestion`・`DecisionAnswerFields`）を描き、`web/src/app/model/useMessagesController.ts`は一覧をPCのボードにつなぎます。
- `web/src/features/messages/ask/`: **AIに依頼**の入力画面（`AskAiDialog.tsx`、`AskAiToolbar.tsx`）と、multipartの依頼を組み立てる`sendRequest.ts`。
- ボード（`pages/board/ui/Lane.tsx`）とスマホのモニター（`pages/monitor/components/MonitorLanes.tsx`）は、AIの下書きのタスクを下書きのバッジ付きの通常のカードとして描きます。WebのUIに、計画のカード・計画のレビュー・開始のルートはありません。
- `web/src/pages/monitor/`: スマホ幅の画面です。`View.tsx`がヘッダー、レーンのタブ、レーン、下部のバー（`components/PhoneNav.tsx`と`components/PhoneNavBar.tsx`）を組み立てます。`components/LaneTabs.tsx`は件数付きのタブ、`components/MonitorLanes.tsx`は指に追従するレーンのカルーセル（`hooks/useLaneCarousel.ts`）、`components/SwipeableCard.tsx`と`hooks/useCardGesture.ts`はカードの長押しで選ぶ動きとスライドして開く動き（`web/src/shared/lib/gesture/useSideSwipe.ts`の上に作っています）、`components/MonitorLaneDialogs.tsx`はアーカイブ・まとめてアーカイブの確認を持ち、アーカイブ一覧も開きます。`components/ArchiveListSheet.tsx`と`components/ArchiveSwipeRow.tsx`がその一覧で（タップで行を選び、右スワイプで復元ボタンを開く）、`hooks/useArchiveSheet.ts`は一覧が開いている間だけアーカイブを読みます。`model/lanes.ts`はレーンの並びとスワイプで出るボタンを持ち、`hooks/useLaneOverlay.ts`はこのスマホが保存した内容を次の読み取りまで画面に残します。`components/MonitorLanesScreen.tsx`は同じ部品をStorybook用に組み立てます。`web/src/shared/viewport/stableHeight.ts`はソフトウェアキーボードが開いている間のページの高さを保ちます。
- `scripts/release/`と`.github/workflows/release.yml`: リリースのアーカイブ、署名、公証、Formula（[リリースをビルドする](../getting-started/setup.md#build-release)を参照）。

### プロジェクトのドキュメント

- `src/docs/`: パス、読み込み、READMEの文面（`templates/README.en.md`・`templates/README.ja.md`）。
- `src/server/api/docs/`: ボードのルーターにある4つのルート。
- `src/server/push_delivery/`: ボードの変更のWeb Push配信（`events.rs`: 変更の前後でタスクが示す内容を比較し、タスクごとに通知を1件に選ぶ、`message.rs`: 文面とリンク、`webpush.rs`: RFC 8291の暗号化とRFC 8292の署名、`transport.rs`: `PushTransport`トレイトと`reqwest`による実装、`ledger.rs`: `.internal/push-ledger.json`、`deliver.rs`: 送信と再試行、`runtime.rs`: 変更フィードを追うタスク、`summary.rs`・`summary/run.rs`: 定期サマリーのスケジュールと通知）。サマリー自体は`src/file_store/notify.rs`が保存し、`src/server/api/summaries.rs`が提供します。[Web Pushの配信](../concepts/notifications.md#web-pushの配信)を参照。
- `src/server/resident/`: 画面を持たないClaude CodeとCodexのセッションの起動処理です。これらのCLIを知っている唯一のコードです（`cli.rs`は名前、ログインの確認、モデル、引数、環境の除去、`mod.rs`は起動処理、停止、シャットダウン、`driver/`は`AgentDriver`トレイトとその出来事、`ClaudeDriver`（双方向のstream-json）、`CodexDriver`（`codex app-server`のJSON-RPC。やり取りは`codex_parse.rs`と`codex_inbound.rs`）、`spawn.rs`はドライバーを通したセッションの起動、出来事の読み取り、pusherの実行、`push/`はpushモード（`mod.rs`はpusherの状態とボードを1回見ること、`decide.rs`は何を送るかと再試行の方針）、`board.rs`はボードの場所、変更時のpusherの起こし方、セッション一覧に出る起動したセッション、`supervisor.rs`と`watch.rs`は再起動、不健全の確認、サーバー起動時の自動起動、`health.rs`はAPIが返す健全性、`autostart.rs`は`.internal/resident-autostart.json`）。ルートは`src/server/api/sessions.rs`にあります。
- `src/server/sessions/`、`src/server/api/sessions.rs`、`src/agent/session_identity.rs`、`src/agent/session_touch.rs`: 張り付いたエージェントセッションのメモリ上の登録、その読み取りルートとtouchルート、コマンドが自分のセッションを名乗る方法、全コマンドとフックが送るベストエフォートの報告。
- `src/file_store/project.rs`: 新しいプロジェクトと一緒に`docs/`を作る処理（`create_project_with_docs`）と、起動時に補う処理（`ensure_docs_dirs`）。
- `web/src/features/resident-sessions/`: 常駐エージェントのダイアログ、設定画面の行、フッターの表示。`api.ts`はセッションのルートのクライアント、`state.ts`は`health`オブジェクトからバッジの状態（`working`・`waiting`・`restarting`・`stopped`・`failed`）を求め、`useResidentSession.ts`はセッションのルートをポーリングし、`useResidentController.ts`はダイアログの選択・起動・停止・自動起動を扱い、`ui/`がダイアログ（`ResidentView.tsx`・`ResidentDialog.tsx`）、行、表示を描きます。それらをどこに出すかは`web/src/app/residentSlot.tsx`が決めます。利用者に見える内容は[常駐エージェントのガイド](../../guide/delegate/resident-session.md)を参照してください。
- `web/src/features/docs/`: リクエスト（`api/docsApi.ts`）、ツリー・選んだファイル・ディスクの変化への追従（`model/`）、ダイアログ（`ui/DocsDialogContainer.tsx`。外枠とファイル一覧は`ui/shell/`、本文の欄・フロントマター・ファイルの表示・MDXの枠は`ui/document/`）。
- `web/src/shared/markdown/frontmatter.ts`と`resolveRelativeImage.ts`: ダイアログが使う、フロントマターの分離と相対パスの画像の解決。
- `tests/docs_*.rs`: ルート、読み込み、README、サンドボックス、ngrokの入口のRustの試験。

### 初回の案内

- `src/file_store/onboarding_state.rs`: 状態ファイル。案内を見たかどうかだけを記録します。
- `src/server/api/onboarding.rs`: 案内の2つのルート。
- `web/src/app/onboarding/`: リクエスト、制御、サンプルカードと質問、サンプルの回答フォーム、層。
- `web/src/app/development/mock-server/guide.ts`: デモの案内の2つのルート。
- `web/src/features/onboarding/ui/`: 表示部品。
- `e2e/tests/onboarding.spec.ts`: E2Eテスト。
- `web/src/app/dialogs/TaskPreviewDialog.tsx`: タスクのプレビューとサーバーの接続。下書きの出入り、カードの読み直し、稼働中とアーカイブの状態を扱います。
- `web/src/app/model/useStreamSubscriptions.ts`: プレビューとドキュメントのダイアログが追従する変更通知の購読。
- `e2e/tests/preview-modal.spec.ts`: プレビューのE2Eテスト。

### ブラウザのデモ

- `web/src/app/development/mock-server/`: Node APIを使わないサンプルデータのサーバー。サンプルデータモード（`web/mock-api.ts`）とデモで共有します。`sampleJa.ts`はサンプルのボードの日本語の文です。
- `web/src/app/development/demo/`: デモの開始（`install.ts`）、`fetch`と`EventSource`の差し替え（`transport.ts`）、画像の書き換え（`images.ts`）、始めの言語の判定（`locale.ts`）。
- `web/demo-build.ts`: `demo`モードのViteプラグイン、ベースパス、ページに渡すサンプルデータ。
- `e2e/playwright.demo.config.ts`と`e2e/demo/`: ビルド済みのドキュメントサイトを相手にするデモのスイート。[ブラウザのデモ](../concepts/demo.md)を参照してください。

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
| ほかのRustのクレート | dirs<br>thiserror<br>getrandom<br>reqwest + eventsource-stream<br>toml_edit<br>ngrok<br>keyring | ホームディレクトリ、型付きのエラー、乱数のIDとトークン、`wait`のSSE、`setup`でのコメントを保つTOMLの編集、リモートアクセス用のプロセス内ngrokトンネル、保存したngrokトークンのためのOSの資格情報ストア。 |
| 画面 | TypeScript<br>Vite<br>React | 画面の状態とAPIの形を型で固定する。ビルドはバイナリに埋め込む。 |
| 画面のライブラリ | nuqs<br>shadcn/ui（Radix）<br>Tailwind CSS<br>lucide-react<br>i18next<br>@dnd-kit/react | URLの状態、アクセシブルな部品、スタイル、アイコン、英語と日本語の文言、ドラッグ＆ドロップ。 |
| Markdown | react-markdown + remark-gfm<br>Milkdown Crepe 7.22<br>mermaid 12 | 生のHTMLなしの表示、Markdownとの相互変換に対応するWYSIWYG編集、strictモードの図。 |
| テスト | assert_cmd、predicates、tempfile<br>expectrl<br>Vitest、Testing Library<br>Playwright | 一時的なデータ領域でのCLI、疑似端末でのプロンプト、画面の単体とコンポーネント、ブラウザでのE2E。 |
| ドキュメント | VitePress 1.6<br>mermaid 11 | `docs/package.json`の独立した依存。 |

</div>

既存の依存を、無関係な変更のついでに一括更新しないでください。追加する依存は互換性のある安定版にし、`Cargo.lock`と`web/pnpm-lock.yaml`に固定します。
