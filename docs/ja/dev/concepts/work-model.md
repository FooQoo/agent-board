# 仕事のモデルと実装

[仕事のモデル](../../guide/work-model.md)は、エージェントが次に何をするか、いつ終わりか、いつ止まって尋ねるかを決める規則の集まりです。このページでは、それぞれの規則がコードのどこで守られ、どのテストが確かめているかを示します。あわせて、モデルが守らず、エージェントの協力に頼っている箇所も示します。規則を変えるときは、先にこのページで、一緒に動くコードとテストを確認してください。

パスはすべてリポジトリのルートからの相対パスです。規則は、プロジェクトの書き込みロックの中で動く`FileStore`の操作で守られます。CLI、Webサーバー、ウォッチャーのどれも、同じ検査を通ります。利用者向けの言葉での規則は[Agent Boardが保証すること](../../guide/work-model.md#agent-boardが保証すること)を、周辺の仕組みは[タスクと状態](./tasks-and-states.md)、[履歴と判断依頼](./history-and-decisions.md)、[保存と復旧](./saving-and-recovery.md)、[エージェント連携](./agents.md)を参照してください。

## 規則が守られる流れ

書き込みは一つの経路を通ります。操作はプロジェクトのロック（`src/file_store/ops/mod.rs`の`lock_project`）を取り、タスクを厳密に読み（`src/file_store/reader/task.rs`の`read_task_strict`）、規則を検査し、タスクと履歴をまとめて保存します。エージェントのスキルの規約でしかない規則は、この経路にありません。それらは後ろの2つ目の表にまとめています。

タスクが待っているかどうかは保存されません。`src/file_store/qa/store.rs`の`QaIndex::is_waiting`が、タスクの参照する質問から導きます。`src/file_store/ops/qa/mod.rs`の`task_waits`は、ロックの中で最新のファイルを読んで、これを呼びます。Pendingの状態、Runningにできないこと、Doneにできないことは、すべてこの一つの導出から来ます。

## Agent Boardが保証すること

各行は、ガイドの規則一つに当たります。「テスト」の列には、その規則を直接確かめるテストを挙げます。直接のテストがない規則は、そう書いています。

| 規則 | 守っている場所 | 確かめるテスト |
| --- | --- | --- |
| タスクの所有者は変わらない。 | 所有者を決めるのは`src/file_store/ops/task/create.rs`の`create_task`だけです。`src/file_store/ops/task/edit.rs`の編集操作は所有者を受け取りません。 | 直接のテストはありません。所有者の引数がないこと自体が歯止めです。 |
| 有効な状態だけが存在する。 | `src/domain/mod.rs`の`check_work_state`を、`src/file_store/ops/agent.rs`の`set_agent_status`が呼びます。`InvalidStateForAssignee`を返します。 | `tests/domain_work.rs`の`run_states_follow_the_table_for_each_owner_and_column`。`tests/file_store_agent.rs`の`running_on_a_human_task_in_doing_is_refused`と`running_on_a_done_task_is_refused_by_the_state_table`。 |
| Pendingは手で設定できない。 | `src/file_store/ops/agent.rs`の`set_agent_status`が、タスクを読む前に`Pending`を拒みます。 | `tests/server.rs`で、agent-statusのルートへの`pending`の要求が422で拒まれます。ファイルストアのテストはありません。 |
| 質問が開いている間、エージェントは待つ。 | `set_agent_status`は、`task_waits`が真のとき、`Running`を`QuestionsUnanswered`で拒みます。 | `tests/file_store_agent.rs`の`running_is_refused_while_a_referenced_question_is_open`。 |
| 質問すると、RunningのタスクはIdleに戻る。 | `src/file_store/ops/qa/ask.rs`の質問の操作が、依頼を保存する同じバッチでIdleにし、履歴を足します。 | `tests/file_store_qa.rs`の`one_request_holds_several_questions_with_their_own_numbers_and_tasks`が、PendingになりIdleに戻ることを確かめます。 |
| 計画のタスクは、開始が承認されるまでPendingのまま。 | `QaIndex::is_waiting`。取り下げられていない計画の質問を参照するタスクは、承認された開始の承認（`src/file_store/qa/model.rs`の`is_given_approval`）を参照するまで待ちます。承認されなかった承認も止めます（`is_rejected_approval`）。 | `tests/file_store_qa.rs`の`an_answered_plan_question_keeps_the_task_waiting_until_an_approval_is_given`、`a_refused_approval_keeps_a_plan_task_waiting`、`a_rejected_start_approval_keeps_the_task_waiting_until_it_is_unlinked`、`a_withdrawn_plan_question_does_not_hold_the_task`。 |
| 回答は一度だけ記録され、履歴と一緒に保存される。 | `src/file_store/ops/qa/answer.rs`の`answer_questions`は、回答済みの質問を拒みます。依頼と、参照するタスクの履歴は、`src/file_store/transaction/batch.rs`の`save_batch_locked`で保存します。質問と取り下げも同じバッチを使います。 | `tests/file_store_qa.rs`の`the_first_answer_is_kept_and_a_conflicting_batch_writes_nothing`。対の保存とバッチの保存は`tests/file_store_transaction.rs`。 |
| AIのタスクは、完了条件が満たされたときだけDoneになる。 | `src/file_store/ops/completion.rs`の`auto_complete_project`は、条件が1件以上あり、すべて済み、待っておらず、下書きでもアーカイブでもなく、TodoかDoingにあることを求めます。移す前にロックの中でファイルを読み直し、理由つきのレーンの履歴を残します。 | `src/file_store/ops/completion/tests.rs`の`only_valid_nonempty_fully_done_ai_conditions_are_eligible`、`completed_ai_todo_moves_once_and_records_a_reasoned_lane_event`、`pending_is_left_alone_then_answered_task_is_reconsidered`。 |
| エージェントが手でDoneにするときも、すべての条件の達成と、待ちがないことが要る。条件のないタスクは通る（2つ目の表を参照）。 | `src/file_store/ops/agent.rs`の`move_task`が、エージェントのDoneへの移動で`ensure_acceptance_met`と`task_waits`を呼びます。`AcceptanceUnmet`か`QuestionsUnanswered`を返します。 | `tests/acceptance_cli.rs`の`an_agent_cannot_move_a_task_to_done_while_a_condition_is_unmet`。手での移動で、開いた質問があるときの拒否には直接のテストがありません。 |
| 終わった仕事は終わったまま。 | `src/file_store/ops/mod.rs`の`ensure_ai_task_not_done`が、DoneのタスクへのAIの操作を拒みます。`auto_complete_project`はTodoとDoingだけを見るので、条件のチェックを外してもDoneは戻りません。 | `tests/file_store_agent.rs`の`done_tasks_reject_agent_edits_but_a_person_can_reopen_them`。`src/file_store/ops/completion/tests.rs`の`direct_task_file_updates_are_rechecked_and_existing_done_is_not_reopened`。 |
| 下書きにはエージェントが触れない。 | `TaskIsDraft`は、`src/file_store/ops/agent.rs`の移動と状態の処理、`src/file_store/ops/task/edit.rs`、`src/file_store/ops/qa/ask.rs`と`link.rs`が返します。 | `tests/file_store_agent.rs`の`a_draft_task_refuses_agent_moves_and_accepts_user_moves`。`tests/file_store_task.rs`の`a_draft_refuses_agent_edits_and_its_files_stay_unchanged`。`tests/cli_agent_board.rs`の`a_draft_refuses_edit_mv_and_state_and_changes_and_announces_nothing`。 |
| アーカイブしたタスクには誰も書き込めない。 | 書き込みの操作は、最初に`TaskArchived`を返します。`src/file_store/ops/agent.rs`、`src/file_store/ops/task/edit.rs`、`src/file_store/ops/task/acceptance.rs`、`src/file_store/ops/task.rs`、`src/file_store/ops/qa/ask.rs`、`link.rs`です。 | 拒否は、編集を`tests/file_store_task.rs`、条件の切り替えを`tests/acceptance_toggle.rs`、エピックの変更を`tests/file_store_epic.rs`で確かめます。すべての操作を覆うテストはありません。 |
| 変更は理由つきで履歴に残る。 | `src/file_store/ops/history_event.rs`の`transition_event`が、レーン・状態・下書き・エピック・アーカイブ・条件の変更の項目を作ります。質問と回答の項目は`src/file_store/ops/qa/`で作ります。 | `tests/file_store_agent.rs`の`a_running_and_idle_task_in_doing_keeps_its_lane_and_records_each_reason`。`tests/history_cli.rs`。 |
| 番号は使い回されない。 | `project.json`の`nextTaskId`は、タスクのフォルダを書く前に確保します（`create_task`）。質問の番号は`src/file_store/ops/qa/ask.rs`の`next_question_id`から取ります。 | `tests/file_store_task.rs`の`task_numbers_are_not_reused_after_a_delete`。質問の番号には直接のテストがありません。 |
| 壊れた記録は推測しない。 | `src/file_store/reader/task.rs`の`read_task_strict`と`src/file_store/history.rs`の`compose_task`が、時刻と理由だけではない履歴の項目に`FileInvalid`を返します。 | `tests/file_store_history.rs`の`stored_history_requires_only_valid_at_and_nonblank_reason`と`invalid_history_field_types_and_timestamps_have_precise_paths`。`tests/file_store_task.rs`の`writing_to_a_task_with_a_broken_task_file_is_refused`。`tests/history_edit.rs`の`cli_edit_refuses_invalid_history_without_rewriting_task_markdown`。 |
| 計画を書き換えても、履歴とリンクは残る。 | `src/file_store/ops/text.rs`の`write_text`は、本文と条件だけを置き換え、保存済みの`history`と`questions`を保ちます。入力に書いた`history`と`questions`は無視します。 | `tests/cli_qa.rs`の`edit_with_desc_file_keeps_question_refs_and_the_task_stays_pending`。`tests/history_edit.rs`の`cli_file_replacement_without_history_keeps_current_history`。 |

## まだエージェント頼みのところ

各行は、その項目を通してしまう経路です。利用者が何を想定すればよいかは[ガイド](../../guide/work-model.md#relies-on-agent)にあります。この表は、コードがなぜそれを止めないかを説明します。

| 項目 | 守られていない理由 | 場所 |
| --- | --- | --- |
| 計画を質問に結び付ける前。 | タスクはTodoのIdleで作られ、質問を参照しないあいだ`is_waiting`は偽です。計画の質問は別の手順で結び付けるので、その間に別のエージェントがタスクを取れます。 | `src/file_store/ops/task/create.rs`の`create_task`。`src/file_store/qa/store.rs`の`QaIndex::is_waiting`。 |
| 新しい計画で再利用したタスク。 | `is_waiting`は、タスクに結び付いた承認済みの開始の承認を、どれでも受け入れます。前の計画の承認を参照したままのタスクはこれを満たすので、新しい計画の質問に答えた時点で、新しい計画が承認されていなくても待ちが解けます。 | `src/file_store/qa/store.rs`の`QaIndex::is_waiting`。`src/file_store/qa/model.rs`の`is_given_approval`。 |
| 質問の取り下げ。 | `withdraw_request`は`Actor`を受け取りますが使いません（引数は`_actor`）。CLIは両方の操作者を受け付けます。エージェントも依頼を取り下げて、待ちを解けます。 | `src/file_store/ops/qa/withdraw.rs`。`src/cli/args/qa.rs`の`QaWithdrawArgs`。 |
| 条件のないタスク。 | `ensure_acceptance_met`は条件が空でも通すので、エージェントはそのタスクを手でDoneにできます。自動のDoneは条件が1件以上あることを求めます。 | `src/file_store/ops/agent.rs`の`ensure_acceptance_met`。`src/file_store/ops/completion.rs`の`auto_complete_project`。 |
| 誰が答えたか。 | `answer_questions`は回答と経路（`--via`）を記録しますが、`--actor human`は信用して受け取ります。チャットの返事を書き戻すエージェントは、ユーザーに代わって書き込みます。 | `src/file_store/ops/qa/answer.rs`。`src/cli/args/qa.rs`の`HumanActorArg`。 |
| ファイルの直接編集。 | 検査は`FileStore`の操作の中にあり、ほかのプログラムによる`TASK.md`への書き込みは通りません。ウォッチャーはファイルを読み直し、自動のDoneを動かすことはありますが、その編集の履歴は足さず、下書き・Done・アーカイブのタスクも拒みません。 | `src/file_store/watch.rs`。[保存と復旧](./saving-and-recovery.md#ファイルに不備があるとき)。 |
| Running。 | `Running`は申告のとおりに保存されます。期限で戻すことも、エージェントの生存を確かめることもしません。 | `src/file_store/ops/agent.rs`の`set_agent_status`。 |
| 自動のDoneにはサーバーが要る。 | `auto_complete_project`は、ファイルのウォッチャーとサーバーの起動時から動き、CLIからは動きません。サーバーが動いていない間に条件が揃ったタスクは、次の起動まで待ちます。 | `src/file_store/watch.rs`。`src/file_store/ops/completion.rs`の`auto_complete_all`。 |
| 自分のタスク。 | 人のタスクはIdleだけで、自動のDoneは対象にしません。Doneへの移動と条件のチェックは記録されるだけで、確かめられません。`ensure_acceptance_met`は、エージェントの移動でしか呼ばれません。 | `src/domain/mod.rs`の`check_work_state`。`src/file_store/ops/agent.rs`の`move_task`。 |
| エピック。 | エピックには、管理される完了条件も完了の状態もありません。完了の条件は`EPIC.md`のMarkdownにあります。 | [タスクと状態](./tasks-and-states.md#エピックと進行順)。 |

## エージェント側の決まりの置き場所

これらの規則のうちエージェント側のものは、コードではなくスキルにあります。たとえば、質問を結び付ける前に計画を登録すること、ユーザーを呼ぶのは4つの場合だけであること、履歴を残すことです。[エージェント連携](./agents.md)を参照してください。規則をスキルからコードへ移す変更は上の1つ目の表に、スキルへ規則を足す変更は2つ目の表に反映します。
