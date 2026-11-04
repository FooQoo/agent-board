# v1.0.0 リリース仕様

v1.0.0の配布・connect・update・ドキュメントの仕様。このページは仕様を示す。動作は[利用ガイド](../../guide/index.md)に書く。版がリリース済みになるのは、そのGitHub Releaseを公開したときだけである。

[English](../../../dev/specifications/release-1.md)

## 配布・導入

Agent Boardの正式配布はMITライセンス、macOS 15以上のApple Silicon（arm64）とIntel（x86_64）を対象とする。初回バージョンは1.0.0、タグはv1.0.0。`brew install fooqoo/tap/agboard`でWeb UIを内蔵したバイナリを導入する。Agent BoardをコンパイルするRust・Node.jsは不要。Homebrew自体が要求するCommand Line Toolsなどは別の前提として案内する。

```sh
brew install fooqoo/tap/agboard
cd my-project
agboard project create "My project"
agboard connect
agboard serve
```

`project create`は実行フォルダへ自動bindする。既存プロジェクトは`project bind`で紐付ける。サーバーは127.0.0.1:7420で開く。本体更新は`brew upgrade fooqoo/tap/agboard`。Windows/Linux配布、本体の自動更新、macOS 13/14対応は初回対象外。

## connect

`agboard connect`は最も近いbindのプロジェクトとルートを表示する。未bindなら作成・bind手順を案内して終了し、別プロジェクトを選ばない。サブフォルダから実行してもProject設定はbindルートに置く。

検出したClaude Code / Codexから複数選び、全エージェント共通のSkillスコープをGlobal / Projectから一つ、Hookスコープを独立に一つ選ぶ。未検出エージェントは理由と導入手順を示し、利用可能として成功表示しない。配置・権限・重複の移行・バックアップなどの変更を確認してから実行する。非対話で確認待ちに入らず、対話端末が必要と説明して終了する。

| 対象 | Global | Project |
|---|---|---|
| Claude Code Skill | `~/.claude/skills/agent-board/` | `<bound-root>/.claude/skills/agent-board/` |
| Claude Code Hook | `~/.claude/settings.json` | `<bound-root>/.claude/settings.json` |
| Codex Skill | `~/.agents/skills/agent-board/` | `<bound-root>/.agents/skills/agent-board/` |
| Codex Hook | `~/.codex/hooks.json` | `<bound-root>/.codex/hooks.json` |

実効設定先の変更（CLAUDE_CONFIG_DIR、CODEX_HOMEなど）を尊重する。CodexのSkillはCODEX_HOMEとは独立した`.agents/skills`規則に従う。SKILL.md・references・assets・Hookテンプレートはバイナリに同梱し、導入後のGit cloneを要求しない。setupは従来の権限専用コマンドとして保持する。

既存設定は必要なキー・管理対象エントリだけをマージする。同一内容の再実行で重複や不要なバックアップを増やさない。管理対象の利用者編集・同時変更は競合として保護する。管理下Hookのスコープ移行は削除先と追加先を確認する。`connect`が手書きのHookを引き取るのは、導入するものと同じ場合（同じイベントとmatcherで、グループに一つだけあり、固定コマンドか、固定コマンドに`--project`でこのプロジェクトを指定したもの）だけとする。それ以外の管理外の重複は削除せず変更を止め、`update`は何も引き取らない。

権限mode、managed policy、Hookの信頼・承認を自動で緩めない。Codexのworkspace-write以外など、自動変更が適切でない権限方式は手動手順を示す。書き込み完了と実エージェントの読み込みを分け、再起動・Hook承認など残作業をエージェント別に示す。

変更前にバックアップし、原子的に書き込む。失敗したエージェントの今回の書き込みを復旧し、他のエージェントの成功を巻き戻さない。部分成功はエージェント・配置・復旧状況を示して非ゼロ終了する。管理対象のハッシュは利用者変更の検出に使い、配布元の真正性や悪意のある直接編集を防ぐ認証手段とは扱わない。

## 署名と公証

正式リリースの各CPUのバイナリは、Developer ID Application証明書で署名する。Hardened Runtimeとsecure timestampを付け、両CPUで同じTeam ID、固定のidentifier `io.github.FooQoo.agent-board.agboard`を使う。既定のDeveloper IDのdesignated requirementを使い、バイナリのハッシュは固定しない。署名したバイナリをZIPにしてAppleの公証へ提出し、状態が`Accepted`になってから、同じバイト列をCPUごとのtar.gzへ梱包し、`SHA256SUMS`のハッシュを求め、GitHub ReleaseとFormulaに使う。単体のコマンドラインのバイナリにはstapleしたチケットを持たせられないため、macOSは初回の起動で公証をオンラインで確認する。インストールでGatekeeperを無効にすることは求めない。公証にはApple IDのパスワードではなく、App Store ConnectのAPIキーを使う。秘密の値をコマンドラインで渡すことはない。証明書のパスワードは`openssl`が環境変数から読み、`security import`の前に乱数のその場限りのパスフレーズへ置き換える。APIキーは0600のファイルとして`notarytool`に渡す。リリースのワークフローのGitHub Actionsは、すべて完全なコミットSHAに固定する。

署名用のSecrets（`MACOS_CERT_P12`、`MACOS_CERT_PASSWORD`、`APPLE_TEAM_ID`、`APP_STORE_CONNECT_API_KEY`、`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`）は、保護された`release-signing` environmentの、プッシュした`v*`タグの実行にだけある。プルリクエストと手動のビルドは、署名なしの候補を作り、リリースのファイルにはならない。証明書がない、公証が拒否またはタイムアウトした、片方のCPUが失敗した場合は、リリースを止める。署名なしへ切り替えることはない。Team IDとidentifierは、リリースをまたいで変えない。開発者の手順は[リリースをビルドする](../getting-started/setup.md#build-release)にある。

## Hookの対象解決

Hook入力のcwd（ない、null、空のときはプロセスcwd）から、最も近いbindを解決する。Global Hookも未bindフォルダで起動するが、正常な未bindはstdout/stderrとも空・終了コード0とし、進捗を注入しない。明示的な--projectは優先する。

壊れたbind、対象プロジェクトの消失（`bound_project_missing`）、入力の形式不正やcwdの型違い・相対パス（`invalid_hook_input`）、cwdが存在しない・読めない（`hook_cwd_unavailable`）はAGBOARD_ERRORで原因を示す。親の別プロジェクトへフォールバックしない。通常の`agboard progress`の未bindはfolder_unboundのまま。Global Skillも未bindで別プロジェクトを推測しない。

## Skills・Hooksの更新

`agboard update`は変更を表示してy/Nで確認し、`agboard update --yes`は確認だけを省略する。対象は導入記録にあるGlobalと、現在の最も近いbindルートのProject構成。未bindでもGlobalは更新できる。他のプロジェクトを走査せず、エージェントやスコープを選び直さない。権限変更は追加しない。

導入記録はエージェント・構成・スコープ・解決済み配置先・導入バージョン・管理対象ハッシュとProjectのbind情報を保持する。`--yes`でも利用者変更を強制上書きしない。更新不要・成功・確認取消は0、失敗・競合は1、非対話で--yesなしなど引数・利用方法の誤りは2。失敗理由はstderrへ出す。更新用--jsonと--dry-runは設けず、グローバル--jsonとの組み合わせも拒否する。

本体更新後の差分は通常CLIの対話操作でstderrへ`agboard update`を案内する。通常処理の成否を変えず、Hook・JSON・待機/serveの継続出力を汚染しない。複雑なデータ移行は追加せず、既存データ互換処理を保持する。

## 公式ドキュメントと公開履歴

VitePressの英語・日本語ヘッダーに公開済みバージョンとGitHub Releasesへのリンクを表示する。文書サイトにはリリースノートのページを設けず、公開済みのGitHub Releasesをリリースノートとし、その履歴を正本とする。mainの開発中Cargoバージョンを公開版として表示しない。過去版の切替UIは設けない。

導入ガイドはHomebrew、connect、update、bind、Global/Projectの違い、Hookの未bind時のskipと信頼確認を説明する。画面はVitePress既定テーマに従い、アプリUIや新しいPencilモックは追加しない。

## 機能の提供段階

v1.0.0のすべての機能は、一般提供（GA）かパブリックプレビューのどちらかである。GAは、その機能を当面そのまま運用することを指し、不具合がないことや、互換性・サポートを無期限に保証することを意味しない。パブリックプレビューは、動作が変わる可能性があることを指す。v1.0.0には両方が混在する。パブリックプレビューは、Docs、タスクの受け取り（`wait --until task`）、モバイルモニターである。`connect`、`update`、初回の案内はGAである。Docsとモバイル接続の設定の画面に、バッジとリンク付きの注意を表示する。段階と制約を一覧にする場所は[機能の提供段階](../../guide/feature-stages.md)だけで、製品はその文言を表示し、そこへリンクする。
