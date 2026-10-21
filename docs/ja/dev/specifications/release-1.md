# v1.0.0 リリース仕様

承認済みの実装前仕様。ここに記載したconnect/update・配布は、実装済み・公開済みであることを意味しない。現在の操作は[利用ガイド](../../guide/index.md)を参照する。

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

既存設定は必要なキー・管理対象エントリだけをマージする。同一内容の再実行で重複や不要なバックアップを増やさない。管理対象の利用者編集・同時変更は競合として保護する。管理下Hookのスコープ移行は削除先と追加先を確認する。管理外の重複は削除せず変更を止める。

権限mode、managed policy、Hookの信頼・承認を自動で緩めない。Codexのworkspace-write以外など、自動変更が適切でない権限方式は手動手順を示す。書き込み完了と実エージェントの読み込みを分け、再起動・Hook承認など残作業をエージェント別に示す。

変更前にバックアップし、原子的に書き込む。失敗したエージェントの今回の書き込みを復旧し、他のエージェントの成功を巻き戻さない。部分成功はエージェント・配置・復旧状況を示して非ゼロ終了する。管理対象のハッシュは利用者変更の検出に使い、配布元の真正性や悪意のある直接編集を防ぐ認証手段とは扱わない。

## Hookの対象解決

Hook入力のcwd（利用できないときはプロセスcwd）から、最も近いbindを解決する。Global Hookも未bindフォルダで起動するが、正常な未bindはstdout/stderrとも空・終了コード0とし、進捗を注入しない。明示的な--projectは優先する。

壊れたbind、対象プロジェクトの消失、形式不正、読込・権限障害はAGBOARD_ERRORで原因を示す。親の別プロジェクトへフォールバックしない。通常の`agboard progress`の未bindはfolder_unboundのまま。Global Skillも未bindで別プロジェクトを推測しない。

## Skills・Hooksの更新

`agboard update`は変更を表示してy/Nで確認し、`agboard update --yes`は確認だけを省略する。対象は導入記録にあるGlobalと、現在の最も近いbindルートのProject構成。未bindでもGlobalは更新できる。他のプロジェクトを走査せず、エージェントやスコープを選び直さない。権限変更は追加しない。

導入記録はエージェント・構成・スコープ・解決済み配置先・導入バージョン・管理対象ハッシュとProjectのbind情報を保持する。`--yes`でも利用者変更を強制上書きしない。更新不要・成功・確認取消は0、失敗・競合は1、非対話で--yesなしなど引数・利用方法の誤りは2。失敗理由はstderrへ出す。更新用--jsonと--dry-runは設けず、グローバル--jsonとの組み合わせも拒否する。

本体更新後の差分は通常CLIの対話操作でstderrへ`agboard update`を案内する。通常処理の成否を変えず、Hook・JSON・待機/serveの継続出力を汚染しない。複雑なデータ移行は追加せず、既存データ互換処理を保持する。

## 公式ドキュメントと公開履歴

VitePressの英語・日本語ヘッダーに公開済みバージョンとGitHub Releasesへのリンクを表示する。`/releases`と`/ja/releases`は新しい順に変更・修正・破壊的変更・必要な更新操作を案内する。GitHub Releasesの公開済み履歴を正本とし、mainの開発中Cargoバージョンを公開版として表示しない。過去版の切替UIは設けない。

導入ガイドはHomebrew、connect、update、bind、Global/Projectの違い、Hookの未bind時のskipと信頼確認を説明する。画面はVitePress既定テーマに従い、アプリUIや新しいPencilモックは追加しない。
