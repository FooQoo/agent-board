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
  serve.log              裏で起動したサーバーの出力
  autostart.lock         コマンドがサーバーを二つ起動しないためのロック
  autostart.paused       agboard stopが残す目印。Hookはサーバーを起動しない
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
      qa/<request-id>/
        request.json
```

ファイルはプレーンなMarkdownとJSONです。各ファイルに必要な内容は[Markdownファイルの形式](../reference/file-format)に説明があります。`formatVersion`が1でないファイルは未対応で、アプリは問題として報告し、ファイルを変更しません。移行、旧形式へのフォールバック、旧データの削除・初期化は行いません。

`.internal/`フォルダには、アプリ自身の設定が入ります。`preferences.json`には、**設定**で選んだ言語とカラーテーマを保存します。この設定は、このPCのすべてのブラウザとリモートアクセスに適用されます。ファイルはアプリが書き込むので、手で編集しないでください。`shared/`の外にあるため、プロジェクトのファイルには含まれません。

各プロジェクトの`qa/`には、エージェントが出した質問と、その回答を、質問のまとまりごとに1フォルダで置きます。質問には`Q-12`のようなプロジェクト内のIDが付き、タスクは`TASK.md`の`questions`の一覧から質問を参照します。中身は`agboard qa ls`や`agboard qa show`で読み、`request.json`は手で編集しないでください。[判断依頼](../delegate/decisions)を参照してください。

各プロジェクトの`docs/`には、自分のMarkdown文書を置きます。ボードのヘッダーの**ドキュメント**から読んだり編集したりできます。フォルダは短い`README.md`とともにAgent Boardが作りますが、中のファイルはボードのデータとして扱いません。変更してもボードは変わりません。詳しくは[プロジェクトのドキュメント](../watch/docs)を参照してください。

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

`agboard setup`は、CodexとClaude Codeのためにデータフォルダを準備し、Agent Boardプラグインを導入します（[エージェントとの連携](../delegate/agents#set-up-your-agents)を参照）。プロジェクトは不要です。データフォルダについては、次のことを行います。

- データフォルダと、その中の`shared/`フォルダを作成します。
- `$CODEX_HOME`または`~/.codex`にあるCodexの`config.toml`で、`sandbox_workspace_write.writable_roots`にデータフォルダを追加します。
- 同じCodexのフォルダに`rules/agboard.rules`を書き込み、Codexが確認なしで`agboard`を実行できるようにします。ファイルがすでにあるときは書き込みません。
- `$CLAUDE_CONFIG_DIR`または`~/.claude`にあるClaude Codeの`settings.json`で、`permissions.additionalDirectories`にデータフォルダを追加します。

```sh
agboard setup --agent all --dry-run
agboard setup
```

`--dry-run`は予定の変更を表示するだけで、何も変更しません。`--json`は同じ結果を機械可読のJSONで表示します。ドライランの出力は次のようになります（`<home>`はホームディレクトリ、`X.Y.Z`は版を表します）。

```text
Dry run: nothing was installed, created, or changed.
Data directory: <home>/.agent-board
Shared folder: <home>/.agent-board/shared
Codex: planned
  plugin: install version X.Y.Z from https://github.com/FooQoo/agent-board.git at vX.Y.Z
  planned <home>/.codex/config.toml
    - add "<home>/.agent-board" to sandbox_workspace_write.writable_roots
  planned <home>/.codex/rules/agboard.rules
    - allow the agboard command (prefix_rule)
Claude Code: planned
  plugin: install version X.Y.Z from https://github.com/FooQoo/agent-board.git at vX.Y.Z
  planned <home>/.claude/settings.json
    - add "<home>/.agent-board" to permissions.additionalDirectories
```

setupは既存の設定をすべて残し、上の配列だけを変更します。既存の設定ファイルを変更する前に、そのファイルの隣へ`<file>.agboard-backup…`という名前でバックアップを書き込みます。バックアップには元の設定が入っているので、共有フォルダには置かないでください。もう一度実行しても何も変わらず、各ファイルは`unchanged`と表示されます。読めない、または形の誤った設定ファイルがあるときは、何も書き込まずにそのファイルを示します。

setupがCodexの`config.toml`を変更するのは、`sandbox_mode`が`"workspace-write"`で、権限プロファイル（`default_permissions`、`permissions`、`profile`、`profiles`）を設定していないときだけです。そうでないときは、ファイルをそのままにして、手作業の手順を表示します。プラグインは導入します。setupが`sandbox_mode`自体を変えることはありません。`sandbox_mode = "danger-full-access"`では、Codexはすでにすべてのフォルダを扱えるので、権限もルールファイルも書き込みません。

setupはあなたが実行する手順です。通常の作業中にエージェントへ実行させないでください。プロジェクトや管理者の設定でフォルダへのアクセスが制限されることもあるので、新しいセッションで確認してください。

## バックアップと復元

バックアップや復元の前に、`agboard stop`でサーバーを止め、エージェントとファイルへ書き込むエディターも止めてください。すべてのプロジェクトをワークスペースの管理情報とともに保存するには、`shared/`フォルダ全体をコピーします。1つのプロジェクトだけなら、`workspace --json`の`folder`の値を使って、そのフォルダ全体をコピーします。サーバーとエージェントを再起動する前に、コピーを同じ場所へ戻してください。

`shared/`をコピーしても`.internal/`は含まれないため、プロジェクトのバックアップには言語とカラーテーマが残りません。それらも残すには、`preferences.json`もあわせてコピーしてください。

## 次に読む

- [エージェントとの連携](../delegate/agents): エージェントをこのフォルダにつなぎます。
- [トラブルシューティング](./troubleshooting): プロジェクトやフォルダが見つからない。
