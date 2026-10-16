---
title: データとバックアップ
---

# データとバックアップ

## データの保存先

既定のデータフォルダは、ホームフォルダ直下の`.agent-board/`です。

| OS | 既定のフォルダ |
| --- | --- |
| macOS | `~/.agent-board/` |
| Windows | `%USERPROFILE%\.agent-board\` |

別のデータフォルダを使うには`AGBOARD_HOME`を設定します。空の値は未設定として扱います。ボードを共有するには、CLI、サーバー、フック、`agboard setup`が同じフォルダを使う必要があります。

```text
.agent-board/
  bindings.json          フォルダの登録(マシン固有)
  serve.json             CLIが起動中のagboard serveを見つける情報
  shared/
    workspace.json
    projects/<project-id>/
      README.md
      project.json
      tasks/<card-id>/
        task.json
        TASK.md
        assets/
        evidence/
      epics/<EPIC-ID>/
        epic.json
        PLAN.md
        assets/
```

`task.json`には現在のレーンや担当などのカードメタデータを保存し、形式の版は3です。本文・受入条件・操作履歴は`TASK.md`に保存し、画面の履歴タブも同じMarkdown履歴を読みます。画面とCLIからの状態変更は同じ履歴へ追記されます。トップレベルの`history` frontmatterには、日時の`at`と内容の`reason`だけを持つ履歴を保存します。作業の進捗とカード操作は、ファイル・API・CLIで同じ形式です。本文には計画・検証結果・証跡への参照を記述し、時系列の履歴は記述しません。エピックの計画は`PLAN.md`に保存します。進行順はpriorityメタデータに、参考条件はMarkdown本文に記述し、エピックには履歴を保存しません。

タスクの形式の版が1と2のファイルは未対応で、アプリは問題として報告し、ファイルを変更しません。移行、旧形式へのフォールバック、旧タスクデータの削除・初期化は行いません。ほかの共有JSONファイルは形式の版が1のままです。

## 共有フォルダをセットアップする

`agboard setup`は、CodexとClaude Codeのためにデータフォルダを準備します。プロジェクトは不要で、次を行います。

- データフォルダと、その中の`shared/`フォルダを作成します。
- Codexの`config.toml`にある`sandbox_workspace_write.writable_roots`へ、データフォルダを追加します。対象は`$CODEX_HOME`、なければ`~/.codex`です。
- Claude Codeの`settings.json`にある`permissions.additionalDirectories`へ、データフォルダを追加します。対象は`$CLAUDE_CONFIG_DIR`、なければ`~/.claude`です。

```sh
agboard setup --dry-run
agboard setup
```

`--agent codex|claude|all`で更新する設定を選びます。既定は`all`です。`--dry-run`は変更内容を表示するだけで、何も変更しません。`--json`は同じ結果を機械で読める形式で表示します。ドライランの出力は次のようになります(`<home>`はホームフォルダを表します)。

```text
Dry run: no files, folders, or backups were created.
Data directory: <home>/.agent-board
Shared folder: <home>/.agent-board/shared
Codex: planned <home>/.codex/config.toml
  - add "<home>/.agent-board" to sandbox_workspace_write.writable_roots
Claude Code: planned <home>/.claude/settings.json
  - add "<home>/.agent-board" to permissions.additionalDirectories
```

セットアップは既存の設定をすべて残し、上の配列だけを変更します。既存の設定ファイルを変更する前に、同じフォルダへ`<file>.agboard-backup-<id>`という名前のバックアップを作成します。もう一度実行しても何も変更されず、各ファイルは`unchanged`と表示されます。

Codexの設定は、`sandbox_mode`が`"workspace-write"`でない限り書き込みません。対応しているのはこのモードだけで、権限プロファイル(`default_permissions`、`permissions`、`profile`、`profiles`)も対象外です。セットアップは`sandbox_mode`を自分では変更しません。拒否されたら、`config.toml`に`sandbox_mode = "workspace-write"`を自分で設定してから、もう一度セットアップを実行してください。拒否された場合は何も書き込まれず、既定の`--agent all`では、拒否されたCodexの対象がClaude Codeの変更も止めます。Codexを使わない場合は`agboard setup --agent claude`を実行してください。

セットアップは、フックとエージェントのスキルを登録しません。これらは別の手動の手順のままです([エージェントとの連携](./agents)を参照してください)。セットアップは一度だけ、あなたが実行する手順です。通常の作業中にエージェントへ実行させないでください。プロジェクトの設定や組織の管理設定によって、フォルダへのアクセスが制限されることもあるため、新しいセッションで確認してください。

## 既存のボードを移行する

以前のバージョンは、OSのアプリケーションデータフォルダにボードを保存していました。macOSでは`~/Library/Application Support/agboard/`、Windowsでは`%APPDATA%\agboard\`です。現在のバージョンは既定で`~/.agent-board/`を使います。古いフォルダのデータは移行も削除もされません。内容はそのまま残り、既定のフォルダからは読み込まれません。

共有フォルダへ移るには、次の手順を行います。

1. 更新したリポジトリから`agboard`を再インストールし(詳しくは[インストールと開始](./getting-started)を参照)、`agboard serve`を再起動します。どちらも自動では更新されません。
2. `agboard setup`を自分で実行します。Codexを使わない場合は`agboard setup --agent claude`を実行します。
3. 変更を読み込ませるため、Codex と Claude Code の新しいセッションを開始します。

古いフォルダのボードを引き続き使うには、`AGBOARD_HOME`にそのフォルダを設定します。その場合、セットアップは既定のフォルダではなく、そのフォルダをエージェントの設定に追加します。

## バックアップと復元

バックアップや復元の前に、`agboard serve`、エージェント、ファイルへ書き込むエディタを止めてください。すべてのプロジェクトとワークスペースの形式を保つには、`shared/`フォルダ全体をコピーします。1つのプロジェクトだけなら、`workspace --json`の`folder`の値を使って、そのフォルダ全体をコピーします。サーバーとエージェントを再起動する前に、コピーを同じ場所へ戻してください。

## フォルダの登録

フォルダの登録は、データ領域の`bindings.json`に別に保存され、マシン固有のパスを含みます。同じマシンでのバックアップには、必要に応じてこのファイルも残してください。別のマシンでは`project bind`で正しいフォルダを登録します。このファイルをコミットしたり、共有のプロジェクトファイルの中に置いたりしないでください。
