---
title: データとバックアップ
---

# データとバックアップ

Agent Boardのデータは、すべて手元のマシンの一つのフォルダに保存されます。このページでは、ファイルの場所、プロジェクトとフォルダの登録、エージェントにフォルダへのアクセスを許可する方法、バックアップの取り方を示します。

## データの保存先

既定のデータフォルダは、ホームフォルダ直下の`.agent-board/`です。

| OS | 既定のフォルダ |
| --- | --- |
| macOS | `~/.agent-board/` |
| Windows | `%USERPROFILE%\.agent-board\` |

別のデータフォルダを使うには`AGBOARD_HOME`を設定します。空の値は未設定として扱います。ボードを共有するには、CLI、サーバー、Hook、`agboard setup`が同じフォルダを使う必要があります。

```text
.agent-board/
  bindings.json          フォルダの登録(マシン固有)
  serve.json             CLIが起動中のagboard serveを見つける情報
  .internal/
    preferences.json     言語とカラーテーマ（アプリが書き込む）
  shared/
    workspace.json
    projects/<project-id>/
      README.md
      project.json
      docs/
        README.md
      tasks/<task-id>/
        task.json
        TASK.md
        assets/
      epics/<EPIC-ID>/
        epic.json
        EPIC.md
        assets/
```

ファイルはプレーンなMarkdownとJSONです。各ファイルに必要な内容は[Markdownファイルの形式](../automation/file-format)に説明があります。`formatVersion`が1でないファイルは未対応で、アプリは問題として報告し、ファイルを変更しません。移行、旧形式へのフォールバック、旧データの削除・初期化は行いません。

`.internal/`フォルダには、アプリ自身の設定が入ります。`preferences.json`には、**設定**で選んだ言語とカラーテーマを保存します。この設定は、このPCのすべてのブラウザとモバイルモニターに適用されます。ファイルはアプリが書き込むので、手で編集しないでください。`shared/`の外にあるため、プロジェクトのファイルには含まれません。

各プロジェクトの`docs/`には、自分のMarkdown文書を置きます。ボードのヘッダーの**ドキュメント**から読んだり編集したりできます。フォルダは短い`README.md`とともにAgent Boardが作りますが、中のファイルはボードのデータとして扱いません。変更してもボードは変わりません。詳しくは[プロジェクトのドキュメント](../use/docs)を参照してください。

## プロジェクトとフォルダ {#projects-and-folders}

ほとんどのコマンドは、`--project NAME`でプロジェクトを指定します。プロジェクトは、名前を変えてもIDを保つので、フォルダの登録・タスク・履歴は新しい名前に追従します。

```sh
agboard project create "My project"
agboard project ls --json
agboard --project "My project" project rename "Website launch"
```

`--project`を明示しているコマンドでは、名前を更新してください。フォルダに基づく進行表とHookは、同じプロジェクトを引き続き解決します。`project rm`は、指定したプロジェクトと、そのタスクと`docs/`を削除します。人の確認を求め、エージェントは使えません。

### フォルダを登録する

`--project`を渡さないとき、`agboard progress`とHookは、最も近い登録済みのプロジェクトのフォルダを使います。`project create`は、現在の作業フォルダも登録します。別の既存のフォルダには`--folder`を、既存のプロジェクトには`project bind`を使います。

```sh
agboard project create "Website launch" --folder ./website
agboard project bind "My project"
agboard project bind "My project" --folder ./docs
```

一つのフォルダは一つのプロジェクトに属し、複数のフォルダが同じプロジェクトに属することもできます。サブフォルダでコマンドを実行した場合は、親フォルダをたどり、最も近い登録先のプロジェクトを選びます。登録がない、または壊れているときは、別のプロジェクトを推測せずにエラーを返します。ほかのコマンドも、ブラウザやほかのエージェントからプロジェクトを推測しません。

登録は、データフォルダの`bindings.json`に別に保存され、マシン固有のパスを含みます。同じマシンのバックアップには、このファイルを残してかまいません。別のマシンでは、`project bind`で正しいフォルダを登録します。コミットしたり、共有のプロジェクトファイルの中に置いたりしないでください。

## 共有フォルダをセットアップする

`agboard setup`は、CodexとClaude Codeのためにデータフォルダを準備します。プロジェクトは不要で、次を行います。

- データフォルダと、その中の`shared/`フォルダを作成します。
- Codexの`config.toml`にある`sandbox_workspace_write.writable_roots`へ、データフォルダを追加します。対象は`$CODEX_HOME`、なければ`~/.codex`です。
- Claude Codeの`settings.json`にある`permissions.additionalDirectories`へ、データフォルダを追加します。対象は`$CLAUDE_CONFIG_DIR`、なければ`~/.claude`です。

```sh
agboard setup --dry-run
agboard setup
```

`--agent codex|claude|all`で更新する設定を選びます。既定は`all`です。`--dry-run`は変更内容を表示するだけで、何も変更しません。`--json`は同じ結果をJSON形式で表示します。ドライランの出力は次のようになります(`<home>`はホームフォルダを表します)。

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

Codexの設定を更新できるのは、`sandbox_mode`が`"workspace-write"`の場合だけです。権限プロファイル（`default_permissions`、`permissions`、`profile`、`profiles`）には対応していません。セットアップが`sandbox_mode`を変更することもありません。

設定の更新が拒否された場合は、`config.toml`に`sandbox_mode = "workspace-write"`を自分で設定してから、再実行してください。拒否された実行では、ファイルは変更されません。既定の`--agent all`では、Codexの設定を更新できなければClaude Codeの設定も変更しません。Codexを使わない場合は、`agboard setup --agent claude`でClaude Codeだけを対象にできます。

HookとエージェントのSkillは、セットアップでは導入しません。導入するのは`agboard connect`で、同じ権限の変更も行います（[エージェントとの連携](../automation/agents#connect-your-agent)を参照）。

セットアップは、利用者自身が一度だけ実行する手順です。通常の作業中にエージェントへ実行させないでください。プロジェクトや組織の設定によってアクセスが制限される場合もあるため、セットアップ後は新しいセッションで共有フォルダを読み書きできることを確認してください。

## 連携の記録、バックアップ、手作業の権限設定 {#integration-records-backups-and-manual-permissions}

`connect`と`update`は、専用のファイルをいくつか保持します。これらは`shared/`の外にあるため、プロジェクトのバックアップには含まれません。

- **連携の記録。** データフォルダの`integrations.json`（通常は`~/.agent-board/integrations.json`）に、`connect`が導入したものを記録します。エージェント、SkillかHookか、スコープ、ファイルとその場所、導入した版、管理する各部分のハッシュです。`update`と更新の通知がこれを読みます。手で編集しないでください。壊れている、または未知の`schemaVersion`の記録は書き換えません。コマンドは止まって、その旨を表示します。
- **バックアップ。** `connect`や`update`は、ファイルを変更する前に、元のものを隣へ`<name>.agboard-backup-<id>-<n>`（例: `settings.json.agboard-backup-...`）としてコピーします。記録そのものを変更するときも同様です。置き換えたり削除したりするSkillのフォルダは、Skillを置くフォルダの中ではなく、その親にある隠しフォルダ`.agboard-backups`（例: `~/.claude/.agboard-backups/`）へ移します。エージェントが古いコピーを2つ目のSkillとして読み込まないようにするためです。コピーが自動で削除されることはありません。元の設定が入っているので、共有フォルダには置かず、アクセス権も保ってください。元に戻すには、エージェントを止めて、バックアップを元のファイルへコピーします。
- **Projectスコープとgit。** Projectスコープでは、バックアップのファイルと`.agboard-backups`フォルダが、リポジトリの中（`.claude/`、`.codex/`、`.agents/`の下）に作られます。コミットされないように、`.gitignore`へ`*.agboard-backup-*`と`.agboard-backups/`を追加してください。
- **競合。** `connect`が導入したSkillのファイルを編集した、そのフォルダにファイルを足した、管理しているHookを削除または変更した場合、コマンドは競合として報告し、そのエージェントには何も書き込みません。あなたの変更を残してエージェントをそのままにするか、編集を別の場所へ退避してからコマンドをやり直してください。
- **中断された実行。** 書き込み中は、エージェントごとに小さなジャーナル（`integrations-journal-<agent>.json`）とロック（`integrations-<agent>.lock`）がデータフォルダにあります。実行が途中で止まったときは、次の`connect`か`update`が、バックアップからファイルを元に戻します。その間に変わったファイルはそのままにして、ジャーナルも残し、そのエージェントについてコマンドは止まり、終了コード`1`で終わります（確認の質問で取り消した場合は、これまでどおり`0`です）。変わったファイルとそのバックアップ、ジャーナルの場所を、標準エラーへ表示します。もう一方のエージェントには影響しません。それらのファイルをバックアップから自分で戻し、ジャーナルを削除してから、もう一度実行してください。
- **手作業の権限設定。** Codexにデータフォルダの権限を加えるのは、`config.toml`が`sandbox_mode = "workspace-write"`で、権限プロファイルを使っていない場合だけです。そうでないと、`connect`はCodexを飛ばして、すべきことを表示します。自分で設定してから、もう一度`connect`を実行してください。`PATH`上に見つからなかったエージェントは設定されません。インストールしてから、もう一度`connect`を実行してください。

## バックアップと復元

バックアップや復元の前に、`agboard serve`、エージェント、ファイルへ書き込むエディターを止めてください。すべてのプロジェクトをワークスペースの管理情報とともに保存するには、`shared/`フォルダ全体をコピーします。1つのプロジェクトだけなら、`workspace --json`の`folder`の値を使って、そのフォルダ全体をコピーします。サーバーとエージェントを再起動する前に、コピーを同じ場所へ戻してください。

`shared/`をコピーしても`.internal/`は含まれないため、プロジェクトのバックアップには言語とカラーテーマが残りません。それらも残すには、`preferences.json`もあわせてコピーしてください。

## 次に読む

- [エージェントとの連携](../automation/agents): エージェントをこのフォルダにつなぎます。
- [トラブルシューティング](./troubleshooting): プロジェクトやフォルダが見つからない。
