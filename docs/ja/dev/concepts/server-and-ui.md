# サーバーと画面

`agboard serve`は、JSON APIと更新通知を提供し、バイナリに埋め込んだReactアプリでボードを表示します。このページでは、リクエストの処理、画面の構成、エラー発生時の動作を説明します。エンドポイントは[Web API](../reference/web-api.md)にあります。

## serveの起動と停止

- `serve`は`127.0.0.1`だけで待ち受け、プロジェクトが0件でも動きます。空のデータ領域には`workspace.json`を作ることがあります。
- データ領域ごとにサーバーが一つだけ動くよう、`lifecycle.lock`（標準の`try_lock`）を起動から終了まで保持します。ファイルがあるだけでサーバーが動いているとは判断しません。ロックはプロセスの終了で外れます。
- 起動時に`serve.json`があり、そのポートの`GET /api/health`が同じ`pid`を返すなら、`serve`は`already_serving`で終了します。そうでなければ古いファイルとして上書きします。
- `serve`は待ち受けを始めた後に`serve.json`（`pid`・`port`・`started_at`）を書きます。SIGINTかSIGTERMを受けると、自分のpidが書かれている場合だけ`serve.json`を消します。

## リクエストの処理

リクエストは、次の順序で処理します。

1. **Hostの確認。** `127.0.0.1:<port>`か`localhost:<port>`だけを受け付けます。
2. **書き込みの保護**（書き込みのみ）。`Origin`・`Sec-Fetch-Site: same-origin`・`X-Agboard-Token`がすべて一致しなければなりません（[セキュリティモデル](./security.md#ブラウザからの書き込み)を参照）。これらの検証は対象データを検索する**前**に行うため、不正なリクエストからデータの存在を探ることもできません。
3. **操作。** 読み込みはメモリ上の索引から返します。書き込みはプロジェクトの書き込みロックを取って最新のファイルを読み、`task.json`と`TASK.md`を一組で確定し、何かが変わったときだけ再読み込みと通知を起こします（[保存と復旧](./saving-and-recovery.md#タスクの保存)を参照）。

書き込みの対象は、常にURLのProjectIdです。Webの`actor`は常に`human`で、要求から受け取ることはありません。`/api/board`のような対象のない経路、互換の別名、プロジェクトを作成・名前変更・削除するHTTP APIはありません。

JSONとHTMLの応答は`no-store`です。スクリプトとスタイルシートは内容から名前を付け、`Cache-Control: public, max-age=31536000, immutable`で送ります。ブラウザがgzipを受け付ける場合はgzipで圧縮して送ります。新しいビルドではHTMLが読み込む名前が変わるため、再読み込みすれば常に最新の画面になります。HTMLの応答には`Referrer-Policy: no-referrer`と`Content-Security-Policy`を付けます。スクリプトと接続は自分自身だけ、スタイルは自分自身と`'unsafe-inline'`（エディターが実行時に`<style>`を挿入するため）、画像は自分自身・`data:`・`http`・`https`です。

## Web画面の作り

- `web/`はVite・TypeScript・Reactのアプリです。nuqsが選択対象のプロジェクトをURLで管理し（`useQueryState('project', parseAsString)`）、`useBoard`がプロジェクトごとの取得・購読・読み込みを担い、一つの`useReducer`が適用中のプロジェクト・切り替え待ち・タスクの選択・ダイアログを連動させます。部品内の入力は`useState`です。ほかの状態管理やフォームのライブラリは足しません。
- 初回のプロジェクト選択はブラウザ履歴を置き換え、メニューからの選択は履歴に追加します。戻る・進むはnuqsのadapterに従います。History APIを直接使ったり、独自に`popstate`を処理したりはしません。
- `pnpm --dir web build`は、`index.html`、入口のスクリプトとスタイルシート`assets/app-[hash].js`・`assets/app-[hash].css`、動的な分割チャンク`assets/chunk-[name]-[hash].js`としてのエディターとMermaid、独自のmanifestを持つ`monitor/`の別ビルドを出力します。ボードのビルドは、チャンクごとのimport・`web/src/`のモジュール・パッケージを記した`chunk-graph.json`も書き出します。最後の手順で、すべてのスクリプトとスタイルシートの横に`.gz`を書き出します。
- 最初のスクリプトには、最初の画面に必要なものだけを入れます。カード・エピック・一括アーカイブ・設定のダイアログ、詳細パネルのMarkdown表示、モニターの詳細ドロワーは`preloadable`（`web/src/shared/lib/lazy/preloadable.ts`）で分割し、最初の画面を表示した直後に取得します。表示部品が届くまで、本文はプレーンテキストで表示します。エディターのアウトラインは表示側のMarkdownパーサーで`##`見出しを読むため、CodeMirrorはエディターを開いたときにだけ読み込まれます。
- `web/test/monitor/build-contract.test.ts`は、ページごとの初回読み込み（入口と、そこから静的にimportされるチャンク）に上限を設け、500 kBを超えるスクリプトは使うときだけ読み込むことを確かめます。Viteの`chunkSizeWarningLimit`は、使うときだけ読み込む大きなチャンク（MermaidのELKレイアウト、文法パーサー、リッチエディター）に合わせて1500 kBにしています。
- Rustは二つのロゴ、HTMLのテンプレート、`.gz`ファイルを埋め込みます。`build.rs`はボードとモニターのスクリプトとスタイルシートを`OUT_DIR`の表にまとめ、両方にある同じファイルは一度だけ埋め込みます。配信するのは表にある名前だけです。各ページのHTMLとファイル名から、ページごとのビルドIDも作ります。ファイルや`.gz`がない場合、またはHTMLが表にないファイルを読み込む場合は、`Run "pnpm --dir web build" first.`でビルドを止めます。画面のビルドを`cargo build`の前に行うのはこのためです。`web/dist/`はコミットしません。
- 各HTMLは`<meta name="agboard-build">`に自分のビルドIDを持ち、SSEの`ready`はサーバーの現在のビルドIDを伝えます。両者が違うとページを一度だけ再読み込みします。編集ダイアログ、送信前の回答、そのほかの操作が開いている間は、終わるまで待ちます（`useBuildReload`）。同じビルドのために一度再読み込みしたタブは、もう再読み込みしません。ビルドIDを持たないページ（Viteの開発サーバー）は再読み込みしません。
- 表示用の純粋関数（日時、並び替え、件数）は`web/src/features/*/model/`または`web/src/shared/lib/`に置いてVitestで試験し、コンポーネントはTesting Libraryで試験します。
- shadcnのRadix版部品（Dialog・Button・Badge・Input・Textarea・Label・RadioGroup・DropdownMenu）と、モニターの下から出るシート（Radix Dialogを使う`drawer.tsx`）は`web/src/shared/ui/`に置き、`cn`は`web/src/shared/lib/classnames/utils.ts`、別名は`@/* → ./src/*`です。Dialogのフォーカスはライブラリに任せ、保存中に閉じさせない・送信・入力の保持は機能側で扱います。UIのスタイルは`shared/styles/ui.css`、テーマと製品のスタイルは`shared/styles/theme.css`・`tokens.css`・`app.css`です。
- 外部のCDNやフォントは読み込みません。書体は`--font-sans`と`--font-mono`の指定だけです。
- 本文の上限・書式の検証・下書きの規則・エラーは`domain`と`file_store`の一か所に置き、CLIとサーバーが共有します。

**入力されたテキストの表示。** テキストはReactの通常のエスケープで表示し、`dangerouslySetInnerHTML`は使いません。MarkdownはReact要素にし（react-markdown・remark-gfm、`rehype-raw`は使わない）、生のHTMLは文字として表示します。有効なリンクは`http`と`https`だけで、新しいタブで開きます。タスクやエピックに添付された画像（`assets/<id>.<ext>`、`attachment:<id>`）は画像APIに解決し、外部の画像は`http`/`https`からだけ`referrerpolicy="no-referrer"`で読み込み、失敗すれば「No image」にします。Mermaidは`securityLevel: 'strict'`で描画し、挿入するのはそれが生成したSVGだけです。

**下から出るシートのドラッグ。** シート上端のハンドルをドラッグしても、Reactのstateは更新しません。`useDrawerDrag`（`web/src/shared/ui/use-drawer-drag.ts`）がポインターと引き下げ量をrefに持ち、ドラッグの開始時にシートの高さを一度だけ測り、引き下げ量を1アニメーションフレームにつき最大1回、シートの`--drawer-drag-y`とバックドロップの`--drawer-swipe-progress`に書き込みます。スタイルシートがこれらを`translate`と`opacity`に変えます。シートの高さの4分の1を超える引き下げか、24px以上を0.5px/msより速く動かすフリックで閉じます。それより短い、またはキャンセルされたドラッグは、シートが開いている間だけ有効なtransitionで元の位置に戻すので、transitionとkeyframeが同時に`translate`を動かすことはありません。閉じたシートは退出のkeyframeのために引き下げ量を保ち、開くシートは描画の前に以前の引き下げ量を捨てます。動作は[モバイルモニター](../../guide/operations/mobile-monitor.md)を参照してください。

**エディター。** `RichMarkdownEditor`（Milkdown Crepe）は`MarkdownEditor`と同じ契約を保ちます。`value`・`onChange`・`onCursorChange`・`disabled`と、`goTo`・`focus`・`insert`を持つrefです。遅延読み込みで、その間は`MarkdownView`を表示します。有効にするのはCodeMirror・ListItem・ImageBlock・Cursor・Placeholder・LinkTooltip・Toolbar・Tableだけで、Crepeのテーマは使いません。初期値はマウント時に一度だけ渡し、`onChange`は利用者の編集でだけ呼びます。編集していない文書は元の文字列のまま保存するので、変えていないMarkdownの書式は崩れません。アップロードは保留中の添付になり、`assets/<id>.<ext>`で参照します。Mermaidのプレビューと閲覧は`renderMermaid`を共有します。`web/src/shared/rich-editor/`の中では、`RichMarkdownEditor.impl.tsx`は外部の値でセッションを作り直す境界だけを持ち、`useRichEditorSession.ts`がセッション（元の文章・編集済みかどうか・初期化前のコマンド・見出し位置・後始末）、`createEditor.ts`が機能の組み合わせ、`editorCommands.ts`が`goTo`・`focus`・`insert`・`markdown`のハンドル、`MermaidPreviews.ts`が図のプレビューを受け持ちます。図のエラー文は画面の翻訳を受け取って作ります。

**テーマ。** `web/src/shared/theme/index.ts`が、テーマの型・一覧・検証・DOMの属性を受け持ちます。テーマはモード（lightかdark）と12色のアクセントの一つです。Reactの描画前に`data-mode`・`data-accent`・`dark`クラス・`color-scheme`を同期して適用します。保存した値はPCの`preferences.json`にあり、`web/src/shared/preferences/index.ts`が`GET`・`PUT /api/preferences`で読み書きします（[共有ファイル](../reference/files.md#表示設定)を参照）。ブラウザは最初の描画のためだけに、`localStorage`の`agboard.theme`と`agboard.locale`に控えを持ちます。テーマの変更がタスクの履歴に届くことはありません。

エピック一覧は、ボードの応答の`epics`と`epicTaskCounts`を読みます。件数はサーバーが`epics`と同じスナップショットから集計するので、一覧が二つの読み込みを混ぜることはありません。モバイルモニターも同じ件数を応答に含みますが、エピック一覧の画面はありません。一覧はアーカイブと`ListPane`で外枠を共有し、読み込み中・読み込み失敗・再取得失敗・空の各状態はプロジェクトのresourceから決まります。再取得に失敗しても直前に読めた行を残します。

タスク詳細（アーカイブ・モニターを含む）とエピック詳細は、`web/src/features/tasks/detail/DetailHeader.tsx`の`DetailHeader`を共有します。識別表示・操作ツールバー・閉じるボタンを共通の配置にし、閉じるボタンまでの間隔を揃えます。画面ごとの操作は呼び出し側が渡します。

### Webコードの置き場所

`web/src/`は、上から順に次の4層です。

| 層 | 置くもの |
| --- | --- |
| `app/` | 2つの入口（`entry/board.tsx`・`entry/monitor.tsx`）、ボードの`App`、プロジェクトのセッション、集約する`api.ts`、遅延ダイアログの接続、サンプルデータのモード。 |
| `pages/` | 画面ごとのフォルダー: `board/`・`archive/`・`epics/`・`monitor/`。 |
| `features/` | `tasks/`・`epics/`・`projects/`・`settings/`・`monitor-connections/`（モバイル接続のPC用ダイアログ）: 一つの主題の表示、フック、計算、リクエスト。 |
| `shared/` | `ui/`の基盤部品と汎用の枠、`markdown/`、`rich-editor/`、`api/`（HTTPの共通処理とサーバーのやり取りの型）、`lib/`、`styles/`、`theme/`、`i18n/`。 |

ファイルがimportしてよいのは、自分の機能またはページと、それより下の層です。`shared/`は上の層をimportせず、機能どうし・ページどうしも直接importしません。隣の機能のものが必要な部品は、ページまたは`app/`が組み合わせて渡します。`TaskCard`は`renderEpic`、`RequestDialog`は`renderEpic`、`EditDialog`は`renderEpicChip`、`EpicDialog`は`renderTask`、`Header`は`projectSwitcher`と`settings`を受け取ります。ボードの設定スロット（`app/BoardSettings.tsx`）もこうした組み合わせの一つで、設定ダイアログにチュートリアルとモバイル接続の行を置き、隣にある接続ダイアログを持ちます。そのため、設定ダイアログを閉じてから接続ダイアログが開きます。2つの行は、`shared/ui`の`SettingsEntryRow`を呼ぶ薄い部品（`TutorialEntryRow`・`ConnectionEntryRow`）で、アイコンのタイル、文言、ボタンは`SettingsEntryRow`が描きます。モニターの`useBuildReload`も、入口から同じように渡します。

`pnpm --dir web check`は、Biomeの後に`web/scripts/check-boundaries.mjs`を実行します。静的import、`import type`、再エクスポート、`import()`をたどり、規則に反するimport、解決できないimport、循環importがあると失敗します。許可リストで黙らせず、共通部分を下の層へ移すか、ページで組み合わせてください。機能全体を一つのファイルから再エクスポートしないでください。エディターやMarkdown表示のような重いモジュールが最初のスクリプトに入ってしまいます。遅延importは実装ファイルを指します。

UI部品のStory、焦点を絞ったテスト、専用CSS、Story対応台帳はソースの近くに置きます。台帳では、公開された部品とStory ID、表示状態を対応付けます。ページStoryは画面全体の合成を、部品Storyはその部品が持つ状態と操作を記録します。コマンドと台帳検査の現在の範囲は[Storybook](../getting-started/setup.md#storybook)を参照してください。

## 画面での失敗時の振る舞い

**保存と回答**

- 作成・移動・回答を楽観的に反映することはありません。画面は成功を待ち、失敗したら入力と選択を保って再試行できるようにします。
- PCとモバイルの回答フォームは、Todo/Doingのタスクの現在のPendingの依頼だけを送信します。二度は送らず、古いスナップショットが表示されても送信成功後は再送しません。応答を失ったら、スナップショットを読み直して依頼IDと状態を確かめてから再試行します。
- 回答の再送時に、同じ回答の重複送信かどうかは判定しません。成功の後は依頼がすでに解除されているので、`request_changed`で失敗します。画像のアップロードも重複を判別しないので、応答を失った後の再送で同じ画像が二つになることがあります。
- PCの回答の入力は、プロジェクト・タスク・依頼ごとに持ちます。Todo/Doing間の移動で依頼が取り下げられても入力は残しますが、古い回答は止めて確認を促します。Doneへの移動では入力を捨て、遅れた応答で復活させません。回答の送信中も、移動などのほかの操作はできます。
- 共通の`DecisionRequestForm`が、PCとモバイルに同じ入力・検証・送信中・失敗の状態を与えます。

**下書きと編集**

- Webの編集は保存時の競合検出は行わず、後から保存した内容を優先します。下書きになる前に読んだ内容でエージェントがタスクを上書きすることや、複数のタブでの編集は防げません。
- 人が下書きの確定を忘れると、エージェントはそのタスクを動かせません。画面とJSONの`isDraft`で分かります。
- 読み込めない外部の画像は「No image」を表示し、ほかを妨げません。

**プロジェクトの切り替え**

- 切り替えでは、前のプロジェクトのタスク表示と選択状態をクリアします。ボードの読み込みに失敗してもURLの対象を保ち、再試行できるようにします。プロジェクトの一覧の取得に失敗したら、古い一覧から推測せず、全体のエラーと再試行を表示します。
- 遅れて届いたボード・保存・再取得の応答は、現在の対象IDと要求番号に合うときだけ適用します。プロジェクトの切り替えは、進行中のすべての保存が終わるまで待ちます。
- 入力中や保存中の戻る・進むは最新のURLの対象を保留し、完了か取り消しの後に適用します。
- 名前変更の後も、開始済みのフォームとURLは同じIDを使います。選択中のプロジェクトが削除されたらその旨を表示して別のプロジェクトの選択を促し、最後の一つが削除されたら作成を案内します。

**アーカイブ**

- ブラウザは成功まで確認を開いたままにし、ネットワークの失敗の後は再試行できるようにします。保存中は二重送信・閉じる・切り替えを止め、開始時のIDや要求番号が違う遅れた応答を捨てます。
- 削除での404は再取得して、タスクがすでにないことを示します。ネットワークの失敗を削除の成功として扱うことはありません。空・読み込み中・一覧の失敗と再試行・切断の状態は、アーカイブの画面にも適用します。

**設定**

- 言語とカラーテーマは、ブラウザではなくPCの一つのファイルに保存し、このPCのすべてのブラウザとモバイルモニターがその値を使います。ファイルがない・不正・読めない場合は既定（英語とライトブルー）に戻し、ブラウザやOSの言語や配色は使いません。
- 起動時、ページはブラウザの控えで描画してから、`GET /api/preferences`を読みます。PCの値と違えば、ページはPCの値に切り替えます。正しいのはPCの値で、ブラウザの控えは表示が一瞬ずれるのを防ぐためだけに使います。
- `preferences`イベントは、開いているすべてのページに変更をすぐに反映します。再読み込みは要りません。ページは、すでに新しい版を表示していれば、遅れて届いた古い応答やイベントを無視します。
- 保存に失敗した場合（`invalid_preferences`・`preferences_unavailable`、または接続できない場合）も、選んだ設定は今のページに反映します。設定のダイアログには保存の失敗を表示し、PCの値は変えません。日本語の翻訳キーがなければ英語の文言を表示します。設定の失敗でボードのデータが変わることはありません。
- 詳細欄の幅は、保存する設定には含みません。`agboard.detailWidth`の別のキーでブラウザごとに保存し、値がない・不正なときは既定の幅に戻します。

## プロジェクトをまたぐ読み込み

`ls --all-projects`は全プロジェクトを順に読みます。各プロジェクトは並行する保存の前か後の状態で返り、プロジェクトをまたいだ一貫性はありません。データ領域を作らず、通知せず、ファイルを変えません。データ領域がなければ空の`projects`を返し、不正な`project.json`が一つでもあれば、部分的な出力はせずエラーだけを返します。

## 初回の案内

案内の表示部品は `web/src/features/onboarding/ui` にあります。部品は props だけを受け取り、ボードを import しません。`web/src/app/onboarding` の制御（`useGuide`）が案内の経路を呼び、手順を進め、10 秒ごとにリースを延長します。`GuideLayer` は部品をボードに結び付けます。案内が指すレーンを測り、スポットライトの中に実際のタスクカードとその回答フォームを描きます。`BoardWorkspace` は層を別に読み込まれる部品として載せます。そのため案内のコードはボードの初回読み込みに含まれません。案内はボードの表示中で、ほかの操作・回答・エピック表示・アーカイブ表示が開いていないときだけ提示されます。設定の「チュートリアル」の行は、完了またはスキップ済みの案内をもう一度出すようボードに頼みます。`useTutorialReplay` は、ボードが案内を表示できるようになるまでこの依頼を保持し、その後 `POST /api/onboarding/replay` を呼びます。案内の経路は PC のボードのルーターにだけ登録されます。モニターは `/monitor/api` という独自の経路を持ち、そのどれも案内を扱いません。

スポットライトの枠の高さは、中のカードの高さに合わせます。ただし下端が案内パネルより 24 px 上に収まるよう上限を設け、それより高いカードは枠の中でスクロールします。制御は、ボードが表示するプロジェクトごとに案内を 1 回読み、すべてのコマンドを画面に表示中のプロジェクトへ送ります。実行の途中でタブを閉じたり再読み込みしたりすると、ファイルはリースが切れたまま `active` で残ります。そのため最初の読み取りでサーバーに run の回収を依頼し、案内は中断された案内として改めて提示されます。HTTP ステータスが 500 以上の失敗では、サーバーの英語の文言ではなく、翻訳済みの接続エラーの文言を表示します。