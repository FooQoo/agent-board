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
- アーカイブのレイアウトは、タスクを選ぶ前と後の両方をブラウザで確認します。一括確認は、スクロールが必要になる十分な行数で、英語と日本語、ライトとダークのテーマ、狭い幅とデスクトップ幅で確認します。

## 検証

変更を終える前に、次を実行します。

```sh
pnpm --dir web install
pnpm --dir web build               # cargo buildの前に必要
cargo build
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
TZ=UTC cargo test
pnpm --dir web typecheck
pnpm --dir web check
TZ=UTC pnpm --dir web test
```

Webのフォーマットを適用するには`pnpm --dir web format`を実行します。

テストの規則:

- 表示時刻を固定するため、`TZ=UTC`を設定します。
- 既定のデータ領域は使いません。各テストが`AGBOARD_HOME`を一時ディレクトリに設定します。
- `agboard serve`は`127.0.0.1`だけで待ち受けます。ポート7420は使わず、空いているポートかポート0を使い、接続先には`localhost`ではなく`http://127.0.0.1:<port>/`を使います。

Playwrightのテストは`e2e/`にあります。初回は`pnpm --dir e2e install --frozen-lockfile`で依存関係を、`pnpm --dir e2e exec playwright install chromium`でブラウザをインストールします。

`pnpm --dir e2e test`はアプリのテストを実行し、共通の事前処理（global setup）でWeb画面とCLIをビルドします。`pnpm --dir e2e test:docs`は、ビルド済みのドキュメントサイトを検証します。
