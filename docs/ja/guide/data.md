---
title: データとバックアップ
---

# データとバックアップ

## データの保存先

既定のデータフォルダは、OSのアプリケーションデータフォルダの下の`agboard/`です。

| OS | 既定のフォルダ |
| --- | --- |
| macOS | `~/Library/Application Support/agboard/` |
| Windows | `%APPDATA%\agboard\` |

別のデータフォルダを使うには`AGBOARD_HOME`を設定します。ボードを共有するには、CLI、サーバー、フックが同じフォルダを使う必要があります。

```text
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

## バックアップと復元

バックアップや復元の前に、`agboard serve`、エージェント、ファイルへ書き込むエディタを止めてください。すべてのプロジェクトとワークスペースの形式を保つには、`shared/`フォルダ全体をコピーします。1つのプロジェクトだけなら、`workspace --json`の`folder`の値を使って、そのフォルダ全体をコピーします。サーバーとエージェントを再起動する前に、コピーを同じ場所へ戻してください。

## フォルダの登録

フォルダの登録は、データ領域の`bindings.json`に別に保存され、マシン固有のパスを含みます。同じマシンでのバックアップには、必要に応じてこのファイルも残してください。別のマシンでは`project bind`で正しいフォルダを登録します。このファイルをコミットしたり、共有のプロジェクトファイルの中に置いたりしないでください。
