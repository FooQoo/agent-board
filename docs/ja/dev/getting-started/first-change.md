# 最初の変更を追う

このチュートリアルでは、既存のルールがどこに実装されているかを、CLI・ファイル保存・テストの順にたどります。題材は、**AIエージェントは、受入条件が一つでも未達成のタスクをDoneに移せない**というルールです。

動くビルドが必要です。まだビルドしていなければ、[開発環境のセットアップ](./setup.md)から始めてください。

## 1. 規則が働く様子を見る

自分のボードに触れないよう、一時的なボードを使います。

```sh
export AGBOARD_HOME="$(mktemp -d)"
cargo run -- project create demo
cat > /tmp/demo-task.md <<'EOF'
---
acceptance:
  - id: AC-1
    text: The list is returned as JSON.
    done: false
history: []
---

Return the list as JSON.
EOF
cargo run -- --project demo add "List as JSON" --assignee ai --actor ai --desc-file /tmp/demo-task.md
cargo run -- --project demo mv 1 doing --actor ai
cargo run -- --project demo mv 1 done --actor ai
```

最後のコマンドは`acceptance_unmet`で失敗し、未達成の条件を示します。`--actor human`でもう一度実行すると成功します。この制限はAIエージェントに適用され、人による操作には適用されません。

## 2. コマンドを探す

コマンドはすべて`src/cli/commands/`にあります。`mv.rs`を開きます。プロジェクトを解決し、`ChangeContext`（actorと理由）を作り、`files.move_work_task(...)`を呼びます。CLI側では、この操作のルールを検証しません。検証は共通の下位層が担うため、Webサーバーにも同じルールが適用されます。

## 3. 規則を探す

`move_work_task`は`src/file_store/ops/agent.rs`にあります。関数を順に読みます。

1. プロジェクトの書き込みロック（`lock_project`）を取ります。以降の処理を最新のファイルに対して行うためです。
2. タスクを厳密に読みます（`read_task_strict`）。ファイルに不備のあるタスクは、ここで拒否されます。
3. アーカイブ済みのタスクと、AIによるDoneのタスクへの変更を拒否します。
4. **ここが規則です**: actorが`Ai`、移動先が`Done`、タスクがまだDoneでないときに、`ensure_acceptance_met`を呼びます。この関数が、未達成の条件を付けて`AcceptanceUnmet`を返します。
5. 続いて履歴を追加し、タスクの各フィールドを更新して、`save_task`を呼びます。`save_task`は`task.json`と`TASK.md`を一組で確定します（[保存と復旧](../concepts/saving-and-recovery.md)を参照）。

この層では、画面やCLIの表示文言、JSON出力は組み立てません。エラーはコード（`acceptance_unmet`）を持ち、`src/error.rs`がメッセージ・終了コード・HTTPステータスに変えます。[エラーコード](../reference/errors.md)を参照してください。

## 4. テストを探す

CLIの振る舞いは`tests/acceptance_cli.rs`で試験しています。`an_agent_cannot_move_a_task_to_done_while_a_condition_is_unmet`を探してください。テストは、一時的な`AGBOARD_HOME`に対して本物の実行ファイルを動かすので、自分のボードには触れません。

このテストファイルだけを実行するには、次のコマンドを使います。

```sh
TZ=UTC cargo test --test acceptance_cli
```

## 5. テストを先に書いて、規則を変える

例として、人が未達成の条件を持つタスクをDoneへ移す場合にも、確認を求める仕様に変えるとします。実際の変更は、次の順で進めます。

1. `tests/acceptance_cli.rs`に失敗するテストを書きます（人がタスクを移すテストをコピーして、期待を変えます）。
2. `move_work_task`の条件を変えます。Webサーバーが同じ関数を呼ぶので、一か所の変更がCLIとWeb APIの両方に反映されます。
3. `TZ=UTC cargo test --test acceptance_cli`を実行し、続けて全体を実行します。
4. 規則を説明しているページを更新します。この規則は[履歴と判断依頼](../concepts/history-and-decisions.md#受入条件と自動done)にあり、日本語訳は`docs/ja/dev/`にあります。

この変更を実際に行う必要はありません。ここでは、変更箇所をたどる順序を把握してください。**コマンド → `file_store`の共通の規則 → エラーコード → テスト → ドキュメント。** Agent Boardのほとんどの変更は、この順に進みます。

## 次に読む

- 規則の背後のモデルは[タスクと状態](../concepts/tasks-and-states.md)。
- 終える前に行う確認は[検証とプルリクエスト](./pull-request.md)。
