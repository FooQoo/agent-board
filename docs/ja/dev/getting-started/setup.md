# 開発環境のセットアップ

Agent Boardの開発に必要な環境を用意し、ビルド・動作確認・ソースからのインストールまでを行います。動作確認には一時的なボードを使います。コマンドはすべてリポジトリのルートで実行します。

## 始める前に

必要なもの:

- Rustのstableツールチェーン（`cargo`）。
- Node.jsと`pnpm`（Corepack経由）。
- 任意: 定型コマンドを実行する[`just`](https://github.com/casey/just)と、`just serve`のためのWatchexec（`cargo install --locked watchexec-cli`）。
- E2Eテストとスクリーンショット: PlaywrightのChromium（インストールのコマンドは[ドキュメントと画像](../docs-and-images.md)を参照）。デモ動画: `ffmpeg`。

普段使っているボードへの影響を避けるため、次の二点を守ってください。

- **一時的なデータ領域を使う。** 既定のデータ領域（macOSは`~/.agent-board/`、Windowsは`%USERPROFILE%\.agent-board\`）は普段使っているボードの保存先です。試すときやテストでは、`AGBOARD_HOME`に一時ディレクトリを設定してください。この設定は現在のシェル内で有効です。
- **ポート7420を空けておく。** 通常の利用の既定のポートです。ほかのポートか、テストではポート0を使ってください。

## ビルド

CLIはビルドしたWeb画面を埋め込むので、先に画面をビルドします。

```sh
pnpm --dir web install
pnpm --dir web build
cargo build
```

実行ファイルは`target/debug/agboard`です。`cargo build`が`Run "pnpm --dir web build" first.`で止まったら、Web画面がまだビルドされていません。

## 開発

よく使う手順は`just`で実行できます。

```sh
just dev          # サンプルのボードとViteのHMR(ポート5173)
just docs         # VitePressのドキュメントサイト(ポート8662)
just storybook    # Storybook(ポート8610)
just build        # Web画面とCLIを順にビルド
just serve        # 保存されたボードとViteのHMR、Rustの監視(ポート7420)
```

- `just dev`はサンプルデータを配信し、Webのファイルが変わるとHMRでブラウザを更新します。
- `just docs`はドキュメントサイトを`http://127.0.0.1:8662/agent-board/`で配信します。必要なら`just docs 8663`のように別のポートを指定できます。
- `just storybook`は部品とページのStoryを`http://127.0.0.1:8610/`で配信します。
- `just serve`は実際のAPIに接続します。Rustのファイルが変わるとRustのサーバーを起動し直し、画面はViteのHMRで配信します。`http://127.0.0.1:7420/`を開きます。RustのAPIはポート7421を使います。ボードは通常の場所、または設定されていれば`AGBOARD_HOME`から読みます。Rustが起動し直すと、書き込み用トークンを更新するためにページが再読み込みされます。
- ほかのポートは引数で渡します。例: `just dev 5174`、`just serve 7500 7501`（Webのポート、RustのAPIのポートの順）。

サンプルデータでWeb画面だけを開発するには:

```sh
pnpm --dir web dev --mode mock --port <port>
```

サンプルデータは新しいデータ領域と同じ状態から始まります。最初にページを開くと[初回の案内](../../guide/quickstart.md#before-you-start-the-first-run-guide)が表示され、2枚のサンプルカードをメモリ上で動かします。スキップもできます。完了またはスキップしたあとは、開発サーバーを再起動するか `POST /api/__mock/reset` でサンプルデータを戻すまで表示されません。

手でCLIを試すときは、一時的なデータ領域を使います。

```sh
export AGBOARD_HOME="$(mktemp -d)"
cargo run -- project create dev
cargo run -- --project dev add "Try it" --assignee ai --actor ai
cargo run -- serve --port <port>
```

データ領域には、プロジェクトのファイルを保存する`shared/`、サーバーの稼働情報を示す`serve.json`、多重起動を防ぐ`lifecycle.lock`があります。データベースは使いません。`task.json`はタスクの現在の状態（`formatVersion: 1`）を、`TASK.md`は本文・受入条件と`at`/`reason`の履歴を持ちます。`formatVersion`が1でないファイルは未対応として報告し、移行しません。すべてのファイルは[データモデル](../reference/files.md#ディスク上のファイル)で説明しています。

## Storybook

Storybookでは、UI部品とページ全体を架空のデータで表示できます。ツールバーで表示言語、ライト・ダークモード、アクセントの色、表示幅を切り替えられます。Storyは対象部品と同じ場所に`web/src/**/*.stories.tsx`として置きます。ページStoryは、アプリと同じ部品を組み合わせて画面全体を確認します。共通のfixture、decorator、テスト用の部品は`web/.storybook/`にあります。

```sh
just storybook
pnpm --dir web build-storybook
pnpm --dir web typecheck:storybook
TZ=UTC pnpm --dir web test:storybook
```

- `storybook`は開発サーバーを`http://127.0.0.1:8610/`で起動します。
- `build-storybook`は静的ビルドを`web/storybook-static/`に出力します。
- `typecheck:storybook`はStoryとStorybookの設定を型検査します。
- `test:storybook`はChromiumでブラウザの試験を2つのプロジェクトとして実行します。1つはすべてのStoryを、再生関数を含めて実行します。もう1つは`web/.storybook/`の共通部分の試験を実行します。

表示幅の切り替えでは、デスクトップの1280px、携帯の監視画面の375pxと390pxを選べます。

Storybookのビルドはアプリのビルドと分けています。Storybookは専用のViteの設定（`web/.storybook/vite.config.ts`）を使うため、アプリのモック、実APIへの接続、チャンクの設定は適用されません。出力先も異なり、Storybookは`web/storybook-static/`、アプリは`web/dist/`です。

製品のコードからStoryや`web/.storybook/`の内容をimportしてはいけません。Storyとテストだけが共通の部分を使えます。`pnpm --dir web check`がこの規則を確認します。300行の上限は`web/src`の製品のファイルだけに適用され、Storyとテストはこの上限の対象外です。また、Storyは製品のAPIとイベントストリームへのリクエストを拒否するため、それらを呼ぶStoryは失敗します。

Storyで使う架空の画像は`web/.storybook/static/`にあります。Storybookとテストはこのフォルダをルートから配信するため、Storyは設定なしに`/sample-attachment.png`のようなURLを使えます。

各部品の`*.stories.tsx`、焦点を絞った`*.test.tsx`、専用スタイル、`story-coverage*.json`は、その部品の近くに置きます。画面Storyでは、部品を組み合わせたページ全体と主要な画面状態を確認します。部品自身の振る舞いを持つStoryの代わりにはなりません。たとえば`Pages/Board/Board`と`ThreeLanes`の組み合わせから、`pages-board-board--three-lanes`というIDが作られます。型付きの`Meta`/`StoryObj`と安定したfixtureを使い、操作が重要な場合は`play`関数を追加します。Storyを重複して作らず、対象部品の既存ファイルを拡張してください。

各フォルダの`story-coverage.json`には、ソースのexport、表示するStory、各Storyが扱う状態を記録します。同じフォルダに複数の台帳が必要な場合は`story-coverage.<name>.json`を使います。台帳は対象部品の隣に置き、Story IDもそのフォルダの`*.stories.tsx`が登録するものに限ります。形式と規則は`web/.storybook/support/component-coverage.json`にあります。Nodeの検査は台帳の記載と配置を検証します。現在のexport台帳はまだ部分的で、UI exportのすべてが記載済みであることは保証しません。`test:storybook`の共通部品テストは、登録されたStory IDと台帳に記載されたStory IDが双方向で一致することを確認します。全UI exportの棚卸しは別の最終ゲートです。Storyには共通fixtureとadapterを使い、製品APIやイベントストリームへのアクセスを拒否する通信ガードの対象にします。

## リリースをビルドする {#build-release}

利用者はHomebrewでAgent Boardをインストールします（[インストールと起動](../../guide/getting-started.md)を参照）。この節は、リリースをビルドして公開する人のためのものです。ワークフローは`.github/workflows/release.yml`、スクリプトは`scripts/release/`にあります。

### アーカイブと検査

- **版。** 版は`Cargo.toml`と`Cargo.lock`が持ち、タグは`v`にその版を付けたものです。`scripts/release/check-version.py --tag vX.Y.Z`が、食い違いを失敗にします。`main`の版は開発中の版で、公開済みのGitHub Releaseだけがリリース済みの版です。
- **ビルド。** CPUごとに専用のmacOSランナー（Apple Siliconは`macos-15`、Intelは`macos-15-intel`）で、Web画面、`cargo build --release --locked`の順にビルドします。`MACOSX_DEPLOYMENT_TARGET=15.0`で、両CPUとも最低のmacOSは15です。stripをする場合は、署名の前に行います。
- **アーカイブ。** `package.sh`が`agboard-<version>-<target>.tar.gz`を作ります。中身は`agboard`、`LICENSE`、`THIRD_PARTY_NOTICES.txt`だけで、Web画面、Skill、Hookのテンプレートはバイナリの中にあります。`verify-artifact.sh`が、名前、2つのライセンスファイル、CPU、deployment target、システムライブラリだけにリンクしていること、実行できる環境では`--version`と埋め込んだWeb画面を確認します。
- **通知。** `generate-notices.py`が`THIRD_PARTY_NOTICES.txt`を作り、`--check`で古いと失敗します。MITの本文は`LICENSE`にあり、リリースの前に、著作権表示へ実際の権利者と年を入れる必要があります。
- **Actions。** `release.yml`のすべての`uses:`は、40文字のコミットSHAに固定し、行末のコメントに版を書きます（`actions/checkout@<sha> # v7.0.1`）。更新するときは、タグをコミットに解決し（注釈付きタグは実体のコミット）、SHAとコメントを一緒に変えます。
- **候補とリリース。** プルリクエストと手動の実行は、署名なしの候補（`candidate.json`が`signed: false`）だけを作ります。候補がリリースのファイルになることはありません。

### 署名と公証

正式な経路は、プッシュまたは再実行した`v*`タグでだけ、保護された`release-signing` environmentの中で動きます。署名用のSecretsがあるのは、そこだけです。

1. **人が一度だけ準備します。** Apple Developer Programに登録し、秘密鍵を持つDeveloper ID Application証明書を作って`.p12`に書き出し、App Store ConnectのAPIキー（`.p8`ファイルと、そのKey IDとIssuer ID）を作ります。次の6つのSecretsを、リポジトリSecretsではなく`release-signing` environmentに登録します。`MACOS_CERT_P12`、`MACOS_CERT_PASSWORD`、`APPLE_TEAM_ID`、`APP_STORE_CONNECT_API_KEY`（`.p8`ファイルの中身）、`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`です。値を、リポジトリ、Issue、ログに書いてはいけません。environmentは、信頼するタグに限定します。
2. **署名します。** `sign-macos.sh`が、ジョブの一時ディレクトリに一時キーチェーンを作り、証明書を取り込み、期待するTeamのDeveloper ID Applicationのidentityがちょうど1つに決まることを確かめて、`--options runtime --timestamp`と固定のidentifier `io.github.FooQoo.agent-board.agboard`で署名します。証明書のパスワードをコマンドラインに出すことはありません。`openssl`が環境変数の`MACOS_CERT_PASSWORD`を読んで復号し、鍵と証明書を、乱数のその場限りのパスフレーズで守った一時的な`.p12`に包み直し、そのパスフレーズだけを`security import -P`に渡します。復号したPEMは0600のファイルで、包み直した直後に削除します。包み直した`.p12`をmacOSが受け付けることは、最初の本番の実行で確認する必要があります。`verify-signature.sh`が、Team ID、identifier、Hardened Runtime、secure timestamp、designated requirementが既定のものであることを確認します。
3. **公証します。** `notarize-macos.sh`が、署名したバイナリをZIPにし（notarytoolはtar.gzを受け付けません）、App Store ConnectのAPIキーで提出して待ち、状態が`Accepted`のときだけ成功にします。鍵は一時フォルダの0600のファイルに書き出し、`notarytool`には`--key <path> --key-id <id> --issuer <uuid>`で渡します。ファイルはどの終わり方でも削除し、秘密の値がコマンドラインに出ることはありません。Invalid、拒否、タイムアウト、処理中は失敗です。タイムアウトした提出は、再提出せずにIDで続きを確認できます。
4. **同じバイト列を梱包します。** 公証に通ったバイナリをtar.gzへ入れ、`release-gate.py`が、署名したもの、公証したもの、梱包したものが同一であること、両CPUが同じTeam IDであることを確認してから、アーカイブと`SHA256SUMS`を作ります。一時キーチェーンと鍵の素材は、必ず実行されるステップで削除します。
5. **ドラフト。** 両CPUが通ったときだけ、ジョブがGitHub Releaseのドラフトを作り、Formulaの候補を作ります。証明書がない、公証が拒否された、片方のCPUが失敗したときは、実行が止まります。署名なしのアーカイブへ切り替えることはありません。

単体のコマンドラインのバイナリにはstapleしたチケットを持たせられないため、macOSは初回の起動で、公証をオンラインで確認します。インストールの手順としてGatekeeperを無効にしないでください。Team IDとidentifierは、リリースをまたいで同じものを使い続けます。証明書の期限切れや失効、Appleの資格情報の変更があったときは、新しい証明書やAPIキーを作って、Secretsを入れ替えます。署名だけでは、保存したKeychainの許可が引き継がれるとは限らないので、更新は、きれいなMacで確認してください。

### Homebrewへの公開

Releaseを公開したあとに、`scripts/release/render-formula.py --tag vX.Y.Z --sums SHA256SUMS --assets <dir> --out Formula/agboard.rb`で、公開したファイルからFormulaを作ります。CPUの欠け、版の違い、ハッシュの不一致は拒否されます。Formulaは、`on_macos`でCPUごとにアーカイブを選び、macOS 15を要求し（`depends_on macos: :sequoia`）、MITを宣言し、`agboard`を`bin`へ、2つのライセンスファイルを`pkgshare`へインストールします。`test do`では、`--version`を確認し、一時的な`AGBOARD_HOME`を使います。`scripts/release/test-formula.sh`がインストールとテストをローカルで再現します。Tapの手順は、そのREADMEにあります。`FooQoo/homebrew-tap`へ自動でpushすることはありません。人が、作られたFormulaを確認してコミットします。

## ソースからインストール

エージェントとHookは`PATH`の`agboard`を実行するので、変更をエージェント経由で試すには、ビルドした実行ファイルをインストールします。

```sh
pnpm --dir web install
pnpm --dir web build
cargo install --path . --locked --force
command -v agboard
```

`cargo install`は`~/.cargo/bin`（または`$CARGO_HOME/bin`）に書き込みます。そのディレクトリが`PATH`に入っている必要があります。`command -v agboard`が何も表示しなければ、例えば`export PATH="$HOME/.cargo/bin:$PATH"`で追加し、新しいシェルを開きます。

インストールした`agboard`と開発中のビルドは別のファイルです。Hookはインストールした方を呼び、`cargo build`・`cargo run`・`target/debug/agboard`は作業ツリーを使います。Hookで変更を確かめる前に、インストールし直してください。

`~/.cargo/bin`や自分のボードに触れずにインストールを試すには:

```sh
root="$(mktemp -d)"
cargo install --path . --locked --root "$root"
export AGBOARD_HOME="$(mktemp -d)"
"$root/bin/agboard" --help
"$root/bin/agboard" project create demo
"$root/bin/agboard" --project demo ls
```
