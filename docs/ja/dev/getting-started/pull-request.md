# 検証とプルリクエスト

プルリクエストを出す前に、リポジトリの規約に従い、UIの変更をブラウザで確かめ、検証コマンドを実行します。

## 規約

振る舞いを変える前に、変更する領域の[開発者向けリファレンス](../index.md)を読んでください。そのうえで、次の規則に従います。

- ソースコード、コードコメント、リポジトリの指示文書、英語のREADME(`README.md`)は英語で書きます。UIの翻訳リソース、`README.ja.md`、`CONTRIBUTING.ja.md`、ドキュメントサイトの日本語ページ(`docs/ja/**`)は対象の言語で書けます。英語が正本なので、日本語訳は同じ変更で更新します。それ以外の文書は英語で書きます。
- 実装とテストはこのリポジトリに置きます。
- プロダクションのソースファイル(`src/**/*.rs`と、`web/src/`配下の`.ts`・`.tsx`)は、1ファイル300行以内に収めます。テストとスタイルには上限はありません。
  - Rust: `tests/file_size.rs`が確認し、`#[cfg(test)]`モジュールより前の行だけを数えます。
  - Web画面: `web/biome.json`のBiomeのルール`noExcessiveLinesPerFile`が確認するので、`pnpm --dir web check`で検出されます。同じコマンドが、続けて`web/src/`のimportの層と循環も検査します（[Webコードの置き場所](../concepts/server-and-ui.md#webコードの置き場所)）。
  - どうしても長いままにするファイルは、先頭行に理由つきでその旨を書きます。Rustでは`// file-size: allow (理由)`、Web画面では`// biome-ignore lint/style/noExcessiveLinesPerFile: 理由`です。この指定をしたファイルには上限がかからないので、できるだけ責務ごとに分けてください。Rustのテストは、理由のない指定や、上限に収まっているファイルに残った指定も失敗にします。
- `docs/dev/reference/`の開発者向けリファレンスは、Agent Boardの現在の仕組みを記述します。振る舞いを変えるときは、同じ変更でリファレンスと`docs/ja/dev/reference/`の日本語訳を更新します。
- Hook、設定、スクリプト、文書、生成物に、マシン固有の絶対パスをコミットしないでください。個人のホームディレクトリやローカルのチェックアウト先も含みます。
- プロジェクトのファイルや実行ファイルにはリポジトリ相対のパス、インストール済みのコマンドには`PATH`、実行時に解決する値には環境変数を使います。マシン固有の設定は、Gitの追跡対象から除外したローカルファイルに置きます。
- コミット前にステージした差分を確認し、`/Users/`や`/home/`などの個人のパスを取り除きます。変更したHookのコマンドが、特定の利用者のディレクトリ構成に依存せずに動くことを確かめます。

## UIの変更

- モーダルには既存のshadcn/uiのDialogとButtonを使います。独自のモーダルの枠を作らず、共通のオーバーレイとテーマのスタイルを再利用します。
- ボタンの大きさは、共通の部品だけで決めます。`Button`の`size`、ダイアログや確認の末尾のボタンの`DialogActions`、アイコンと文字の`IconLabel`、パネルの中の確認の`ConfirmPanel`です。`cursor: pointer`を持つスタイルの規則が、`px`の固定の高さや幅を自分で持つと、Biome（`web/biome-plugins/no-fixed-clickable-size.grit`）が、エディターと`pnpm --dir web check`で報告します。固定の大きさを残す必要がある規則（一覧の行、スライダーなど）は、宣言の前に理由をコメント`/* biome-ignore lint/plugin: 理由 */`で書きます。
- アーカイブのレイアウトは、タスクを選ぶ前と後の両方をブラウザで確認します。一括確認は、スクロールが必要になる十分な行数で、英語と日本語、ライトとダークのテーマ、狭い幅とデスクトップ幅で確認します。

## 検証

変更を終える前に、次を実行します。

```sh
pnpm --dir web install
pnpm --dir web build               # cargo buildの前に必要
cargo build
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
TZ=UTC cargo nextest run
pnpm --dir web typecheck
pnpm --dir web check
TZ=UTC pnpm --dir web test
pnpm --dir web typecheck:storybook
TZ=UTC pnpm --dir web test:storybook
pnpm --dir web build-storybook
```

Webのフォーマットを適用するには`pnpm --dir web format`を実行します。手元でカバレッジを測るには、Webは`pnpm --dir web test:coverage`（結果は`web/coverage/`に出ます）、Rustは`cargo llvm-cov nextest`を実行します（[cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov)は`cargo install cargo-llvm-cov --locked`でインストールします）。

[CIのワークフロー](https://github.com/FooQoo/agent-board/blob/main/.github/workflows/ci.yml)は、プルリクエストと`main`へのpushのたびに、同じ確認を実行します。

- Rustのジョブは、macOS 15で`cargo fmt`、`cargo clippy`、`cargo nextest run`を実行します。
- Webのジョブは、型チェック、リンター、単体テスト、Storybookのテストとビルドを実行します。
- E2Eのジョブは、macOS 15でPlaywrightのアプリのスイート（`pnpm --dir e2e test`）を実行します。15分ほどかかるため、プルリクエストでは実行せず、`main`へのpushと手動実行のときだけ動きます。
- カバレッジのジョブは、Rustのテストを`cargo llvm-cov nextest`で、Webの単体テストを`pnpm --dir web test:coverage`で計測し、両方の結果を[Codecov](https://codecov.io/gh/FooQoo/agent-board)に送ります。数値を報告するだけで、カバレッジが低くても実行は失敗しません。

プルリクエストには、[CodeRabbit](https://www.coderabbit.ai/)も日本語でレビューのコメントを付けます。設定は`.coderabbit.yaml`にあり、ロックファイルなどの自動生成されるファイルはレビューの対象から外しています。コメントは提案として扱い、正しいものは直し、直さないものには理由を返信します。

マージする前に、RustとWebのジョブが成功していることを確かめます。アプリの動作に関わる変更では、手元で`pnpm --dir e2e test`も実行します。`main`でE2Eのジョブが失敗したときは、トレースが`e2e-results`という成果物として実行結果に添付されます。

Rustのテストは[cargo-nextest](https://nexte.st/)で実行します（`cargo install cargo-nextest --locked`でインストールします）。テストはそれぞれ別のプロセスで動き、`.config/nextest.toml`の設定で、2分を超えたテストは止まります。`TZ=UTC cargo test`も使えますが、テストバイナリごとに1つのプロセスでまとめて動き、時間の上限もありません。

テストの規則:

- 表示時刻を固定するため、`TZ=UTC`を設定します。
- 既定のデータ領域は使いません。各テストが`AGBOARD_HOME`を一時ディレクトリに設定します。
- `agboard serve`を起動するテストは`AGBOARD_WATCH=poll`を設定します。テスト内で起動するサーバーは`server::run_until_in`と`WatchMode::Poll`で起動します。プラットフォームのファイルイベントを使うのは`tests/file_watch.rs`だけです。
- `agboard serve`は`127.0.0.1`だけで待ち受けます。ポート7420は使わず、空いているポートかポート0を使い、接続先には`localhost`ではなく`http://127.0.0.1:<port>/`を使います。

Playwrightのテストは`e2e/`にあります。初回は`pnpm --dir e2e install --frozen-lockfile`で依存関係を、`pnpm --dir e2e exec playwright install chromium`でブラウザをインストールします。

`pnpm --dir e2e test`はアプリのテストを実行し、共通の事前処理（global setup）でWeb画面とCLIをビルドします。`pnpm --dir e2e test:docs`は、ビルド済みのドキュメントサイトを検証します。`pnpm --dir e2e test:demo`は、デモをコピーしたビルド済みのサイトでデモを検証します（[ブラウザのデモ](../concepts/demo.md#手元で確かめる)を参照）。

アプリのテストは、複数のPlaywrightワーカーでテストファイルを並行して実行します。

- ワーカーごとに、一時的なデータ領域と、ポート0で起動した`agboard serve`を1つずつ持ちます。固定のポートは使わないため、2つのチェックアウトで同時に実行できます。
- ワーカー数の既定値はCPU数の半分です。変えるときは`AGBOARD_E2E_WORKERS`を設定するか、`--workers`を指定します。1つのファイルのテストは同じワーカーのボードを共有するため、1つのワーカーで順に実行されます。
- 別の`agboard`バイナリを使うときは`AGBOARD_E2E_BINARY`を指定します。`AGBOARD_E2E_HOME`と`AGBOARD_E2E_MAIN_URL`はワーカーのフィクスチャが設定するので、自分では設定しません。
- 結果とトレースは、システムの一時ディレクトリにある`agent-board-e2e-results-<チェックアウト>`に、チェックアウトごとに保存されます。

アプリのテストを書くときは、次の点を守ります。

- `test`と`expect`は`@playwright/test`ではなく`e2e/helpers/fixtures`から読み込みます。こうすると、ワーカーのサーバーとその`baseURL`を使います。
- `mainUrl()`、`mainOrigin()`、`mainHome()`は、ファイルの読み込み時ではなく、テストかフックの中で呼びます。
- 専用のサーバーが必要なテストは`startServe(home)`で起動し、返り値からポートを読みます。同じポートを渡すと、そのポートで再起動します。Playwrightは`beforeAll`より先に`baseURL`を決めるので、`states.spec.ts`のように、先に必要になった方からサーバーを起動します。`startImageServer()`の画像サーバーもポート0を使います。
- `resetBoard`は、ワーカーのサーバーが元に戻したボードを表示するまで待ちます。そのため、直後に開いたページはフィクスチャの内容を読み込みます。
