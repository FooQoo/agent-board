# エージェント連携

エージェント連携は、作業手順を定める**スキル**、進行表を渡す**Hook**、変更や回答を待つコマンドで構成されます。このページでは、それぞれの役割と、`agboard setup`がこれらをAgent Boardプラグインとして導入する仕組みを説明します。利用者向けの作業の流れは[エージェントとの連携](../../guide/delegate/agents.md)、エージェントが受け取るJSONは[Hook・進行表・waitの出力](../reference/agent-output.md)にあります。

## 各部分の関係

| 部分 | 場所 | 役割 |
| --- | --- | --- |
| スキル`agent-board` | `src/skills/agent-board.md`と`src/skills/topics/`。`agboard skills`が出力する。プラグインの`SKILL.md`はそのコマンドを実行するだけ | 判断。作業の選び方、進捗の報告、質問の出し方、下書きとDoneのタスクの扱い。 |
| スキル`remote` | `plugins/agent-board/skills/remote/SKILL.md` | `agboard --project "<名前>" show remote --json`のスマホ用アドレスと合言葉をユーザーに渡す。何も起動しない。 |
| スキル`wait` | `plugins/agent-board/skills/wait/SKILL.md` | セッションをボードに張り付かせる。`agboard skills resident`に従い、タイムアウトの既定は3600秒で、`idle_timeout`のあとは待ち直す。 |
| Hook |（`src/agent/hook.rs`） | 取得と整形。ツールの呼び出しの後に、現在の進行表をエージェントのコンテキストに添える。 |
| 進行表 | `src/progress.rs` | 進められるタスクの一覧。`agboard progress`とHookが共有する。 |
| `wait` | `src/agent/wait.rs`、`src/agent/task_wait.rs` | プロジェクトが変わるか、次のタスクが用意できるまで待つ。 |
| `message ask`、`message wait` | `src/cli/commands/message/`、`src/agent/message_wait.rs` | ユーザーに質問し、開いている質問がなくなるまで待つ。 |

スキルの名前は`agent-board`、実行ファイルは`agboard`です。典型的な流れは次のとおりです。Hookが進行表を見せる → エージェントは必要な`EPIC.md`と`TASK.md`だけを読む → タイトルが分かりにくければ原依頼を保持して`agboard edit --title`で整理する → タスクをDoingとRunningにする → `history add`で進捗を記録する → ユーザーの判断が必要になったら`message ask`で質問して回答を待つ → 条件を満たしていき、自動Doneがタスクを完了させる。タイトル整理は、通常の作業の流れとリッスンに共通するスキルの指示であり、サーバーによる自動要約機能ではありません。

エージェントは、開始・意味のある進捗・判断・検証・中断・再開のときに、項目ごとの承認なしで進捗を追加し、操作時に自動で記録された履歴は重複して追加しません。本文には計画と簡潔な検証結果を記録します。見た目の確認が有用な場合は画像を添付できます。

スキルでは、`BUG`と`ENHANCEMENT`を継続的な分類用エピックとし、本文を固定する例外を設けます。正本の本文は、`agboard skills`のトピック`bug-epic-template`と`enhancement-epic-template`です。ボードの言語で一度だけ初期設定し、その後の通常の作業とリッスンでは、計画と結果を各タスクだけに記録します。空でない本文の置き換えにはユーザーの明示的な依頼を必要とし、有用な旧本文は関連するタスクの本文に残します。優先順のfrontmatterは引き続き変更できます。サーバー側の編集禁止機能ではありません。

## 進行表とHook

進行表は、人の判断待ちではないTodoとDoingのタスクを、エピックごとに`priority`の順で並べた一覧です。各タスクのID・タイトル・担当・状態・完了条件の件数と、`EPIC.md`と`TASK.md`のパスを含み、本文や履歴は含みません。`nextTasks`（`src/progress.rs`の`next_tasks`）は、今すぐ着手できるAI担当のタスクを最大3件示し、実行中のタスクや人のタスクに紛れて準備の整った作業が見落とされないようにします。IdleのDoingタスク（`resume`）が先、次にIdleのTodoタスク（`next_in_epic`）で、順序は`ordered_tasks`に従います。依存関係は`EPIC.md`の文章で書かれるため評価しません。優先するタスクが判断待ちでも、後続のタスクは進められます。質問に回答があり、まだ完了していないタスクは一覧に戻ります。`pending`節の`question`は、IDが最も小さい未回答の質問の先頭200文字です。

`src/progress.rs`は、`Include`に応じて任意の`pending`節と`done`節を作ります。`agboard progress`と`agboard hook`が`--include-pending`と`--include-done`から`Include`を作ります。既定の`Include`は何も追加しないため、既定の表は変わりません。オプションは[エピックと進行表](../../guide/watch/epics.md#進行表を読む)を参照してください。

Hookは、入力の`cwd`（なければプロセスのcwd）に最も近い登録済みの祖先からプロジェクトを識別します。セッションIDは使わず、登録がないときに全プロジェクトを選ぶことも、最も近い登録が壊れているときに親へ戻ることもありません。保存した言語が英語以外のときは、返答の言語の手がかりとして、`preferences.json`から直接読んだ値（`src/server/preferences/`の`saved_locale`）を、一覧の最上位の`locale`に載せます。一覧は`hookSpecificOutput.additionalContext`に`AGBOARD_PROGRESS`のJSONとして返し、失敗したときは`bound_project_missing`などの`AGBOARD_ERROR`を返します。登録がまったくないフォルダはエラーではありません。[Hookのスキップとエラー](#hookのスキップとエラー)を参照してください。

- **Claude Code。** プラグインの`hooks/claude.json`が、プロジェクト名を固定せずに`agboard hook --agent claude`をSessionStart（`startup`、`resume`、`clear`、`compact`）、PostToolUse、PostToolUseFailure、Stopに登録します。汎用スキルのfrontmatterのHookは使いません。
- **Codex。** プラグインの`hooks/codex.json`が、`agboard hook --agent codex`をSessionStart、PostToolUse、Stopに登録します。Codexはプラグインのhookを、信頼されたものだけ実行します。信頼の設定は`agboard setup`と`agboard update`が行います（[setupとupdate](#setupとupdate)を参照）。
- **上限。** 一覧は256 KiB、一回の実行は10秒が上限です。Codexの`additionalContextLimit`は0にし、Hookが自分の上限を守ります。超えたら`context_too_large`を報告し、切り詰めて成功として報告することはありません。一覧を作れない、または入力を読めないときは、Hookがそれを伝え、元のツールの結果を保ちます。
- **入力。** Hookは、大きさにかかわらず入力を最後まで読み、使うのは`hook_event_name`と`cwd`（Stopでは加えて`stop_hook_active`、`last_assistant_message`、`transcript_path`）だけです。エージェントはPostToolUseのたびにツールの結果をまるごと送るので、画像を読んだあとや長いコマンドの出力のあとは入力が大きくなります。ツールの入力と結果は読み飛ばし、残したり渡したりしません。
- **Stop。** ターンの終わりに、Hookが、ターン終了時に当てはまる忘れごとの登録簿のルールを実行し（`src/nudge/`、[忘れごとのルール](#nudge-rules)を参照）、リマインダーが出たときは、チェックリストを理由にしてターンを1回だけブロックします（`{"decision":"block","reason":"..."}`。コードは`src/agent/stop/`です）。リマインダーは、Hookが確かめた違反である**確定**（Definite）か、引き金が引かれたのでエージェントが判断する**確認**（Check）のどちらかです。理由は短い見出しで始まり、確定のリマインダーを`- NG: ...`で並べた`Found:`の節、確認を`- [ ] ...`で並べた`Check:`の節が続きます。空の節は出さず、リマインダーがなければ、ターンはそのまま終わります。ルールが見るのは、Stopの入力、トランスクリプトから読んだターン（最後の返信とツール呼び出しのコマンド文）、バインドされたプロジェクトの進行表（プロセス内で計算）です。`stop_hook_active`がtrueのとき（ブロックは最大1回です）、フォルダがどのプロジェクトにも結び付いていないとき、ルールに必要なデータが読めないとき、エラーのときは、何もしません。ターンの開始は、Claude Codeでは直近の本物のユーザーメッセージ、Codexでは、注入されたコンテキストもユーザーメッセージとして記録されるので、入力の`turn_id`の`task_started`イベント（なければ最後のもの）です。トランスクリプトは末尾8 MiBを読み、Codexの`function_call`、`local_shell_call`、`custom_tool_call`をツール呼び出しとして数えます（`src/nudge/turn.rs`）。返信は`last_assistant_message`から、なければトランスクリプトから取ります。トランスクリプトはターンより遅れて書かれることがあり、ターン末尾の`agboard`呼び出しを一度見逃すと、ブロックでターンが1回増えます。
- **安全性。** コマンドは固定で、タスクのテキストや`tool_input`から何も組み立てません。Hookがエージェントのツールを呼ぶことも、自分自身を起動することも、ボードのファイルを変えることもありません。進行表を加えるとき、サーバーが動いていなければ、待たずに裏で起動します。`agboard stop`で止めた後と`AGBOARD_AUTOSTART=0`のときは起動しません（[サーバーと画面](./server-and-ui.md#コマンドがサーバーを起動する手順)を参照）。エージェントがファイルを編集するだけでも、自動Doneが働くようにするためです。こうして起動したサーバーは、そのプロジェクトのボードをブラウザーで一度だけ開きます（[ボードを開く](./server-and-ui.md#opening-the-board)を参照）。パスはローカルのCLIとHookの出力にだけ現れ、リモート向けのJSONには出しません。

エージェントは、一覧を読めるまでボードに依存する変更をせず、コンテキスト圧縮後には一覧を新しく読みます。

スキルでは、質問をすべて、選択肢つきのプロジェクトの質問として`message ask`でボードに置きます。会話の最中は同じ質問を、選択肢のidとラベル、おすすめ付きの文章としてチャットにも書き、エージェント自身の質問ツールは開きません。開いたままのツール呼び出しはエージェントを止めてしまい、ボードでの回答に気づけなくなります。また、閉じられたツール呼び出しは拒否と受け取られかねないためです。チャットの答えは、ユーザーの言葉のまま`message answer --actor human --via chat`で書き戻し、そのあと待機コマンドが`answered`で終わっても二重に記録しません。ボードにすでに回答があれば`question_answered`がそれを返し、エージェントはその回答で続け、どちらが記録されたかをユーザーに伝えます。同じ質問をもう一方の場所で尋ね直すことはありません。スキルは、ボードの内容と同じく、チャットの返信もユーザーが話している言語で書くよう指示します。質問を登録してすぐに戻るようユーザーから明示された場合（とボードが起動したセッション。後述）だけ`--no-wait`を使い、ボードに接続できないときもチャットだけで質問することはしません。

複数のタスクにまたがる依頼は、仮の計画にします。先にエピックとタスクを登録し、計画に必要な質問があれば`message ask`で出して、答えに合わせて計画を直します。エージェントが作るエピックとタスクはAIの下書きなので、開始されるまで`wait --until task`や作業の流れに拾われません（[下書き](./tasks-and-states.md#下書き)を参照）。質問への回答がそろい計画を清書すると、エージェントが`agboard epic start <EPIC-ID> --actor ai`（1件のタスクなら`agboard start <id> --actor ai`）で自分で計画を開始します。そのタスク（エピックならそのAIの下書き）に紐づく未回答の質問があるあいだは、開始は`start_blocked_by_questions`で断られます。開始後は、エピックの順に進め、意図が分からないとき、好みで決まるとき、取り返しがつかないとき、範囲が広がるときだけユーザーを呼びます。これはスキルの指示で、導かれた待機中の状態を除き、CLIやサーバーが強制するものではありません。ユーザーから見た動きは[依頼をタスクに分ける](../../guide/delegate/agents.md#依頼をタスクに分ける)を参照してください。

人が起動したセッションでは、待ち方はどのエージェントでも同じです。`message ask`を最後の行まで動かし続け、`timeout`のあとは`message wait <question-id>`で待ち直します。Claude Codeはコマンドを裏で動かし、終わったときに知らされます。質問を見せたあとは発言を終えるので、ボードでの回答がエージェントを起こします。Codexはこの形で起こせないため、手前で動かし、出力を区切って読みます。1回のコマンドに時間の上限はなく、ユーザーはボードで答えるか、エージェントを中断してチャットで返信します。既定の待ち時間600秒は、Claude Codeの1回のツール呼び出しの上限10分に合わせたものです。こうしたセッションに答えを送り込む仕組みはありません。ボードは答えを保存するだけで、待っているコマンドが答えを返します。例外はボードが起動したセッションで、`--no-wait`で質問し、答えはボードから押し込まれます（[pushモード](#push-mode)を参照）。

### 忘れごとのルール {#nudge-rules}

忘れごとのルール（nudge）は、エージェントが忘れやすいことを思い出させます。登録簿は1つ、`src/nudge/rules.rs`の`RULES`で、エージェントに知らせる2つの場面に使われます。作業中は[進行表](../reference/agent-output.md#進行表)の`reminders`、ターンの終わりはStopフックのチェックリストです。ルールは、次のフィールドを持つ1つの項目です。

| フィールド | 値 |
| --- | --- |
| `id` | 変わらないケバブケースの名前。ルールが出すすべてのリマインダーの`rule`になります。 |
| `area` | ルールが扱う領域。`Question`、`Record`、`Acceptance`、`RunState`、`Epic`のいずれかです。 |
| `source` | `State`は進行表だけを読みます。`Turn`はターン（返信とツール呼び出し）も読みます。`State`のルールはターンを見ないので、進行表でもHookでも同じ結果になります。 |
| `when` | `Working`は進行表、`TurnEnd`はStopのチェックリスト、`Both`は両方に出します。作業中に出せるのは`State`のルールだけです。 |
| `kind` | ルールが確かめた違反は`Definite`、エージェントが判断する引き金は`Check`です。 |
| `check` | `Facts`（進行表、あればターン、返信、時計）を受け取り、0個以上の`Finding`を返す関数。`Finding`は本文と、当てはまるときの`task_id`、`message_id`、`epic_id`です。 |

ルールは次のとおりです。

  - **`question`**（Turn、TurnEnd、Check）。返信の最後の空でない行が`?`か`？`で終わり（閉じ括弧、引用符、Markdownの強調は無視します）、ターン中に`agboard ... message ask`または`message answer`を実行したツール呼び出しがないときに引き金が引かれます。リマインダーを2つ出します。質問がユーザーの回答を待つものか（そうなら`message ask`でボードに出し、チャットにも示す）、見た目に関するものか（そうなら画像を添付する）です。
  - **`question-images`**（Turn、TurnEnd、Check）。ターン中に画像を作り（`result-artifact`と同じ判定）、`agboard ... message ask`を実行したのに、質問に画像がない場合に引かれます。質問のJSONに`images`がなく、本文に`attachment:`の参照がなく、ターン中に`agboard attachment add`もありません。見た目に関する質問なら画像を添付するよう求めます。
  - **`question-in-chat`**（Turn、TurnEnd、Definite）。ターン中に実際の`message ask`（`--help`ではない）を実行したのに、最後の返信に`Q-<n>`の参照がない場合です。質問をQ-idつきでチャットにも示すよう求めます。返信を読めないときは何も言いません。
  - **`question-wait`**（Turn、TurnEnd、Definite）。ターン中に`message ask ... --no-wait`を実行し、その後に`agboard message wait`がない場合です。`agboard message wait <Q-id>`をバックグラウンドで実行して回答を待つか、待たない理由を説明するよう求めます。
  - **`final-result`**（State、Both、Definite）。`finalResultMissing`にあるタスクごとに、そのタスクを示して`result add <id> --final`を求めます。
  - **`answer`**（State、Both、Definite）。`answers`の各項目について、`message show`で読み、対応して、`message accept`を実行するよう求めます。
  - **`request`**（State、Both、Definite）。`requests`の各項目について、`message show`で読み、`message accept`で受け付けて、計画するよう求めます。
  - **`conditions`**（State、Both、Check）。Doingの AI タスクに`--final`の成果が記録されているのに、完了済みの完了条件が総数に満たない場合に、確認結果を記録して`TASK.md`の完了条件を完了にするよう求めます。
  - **`epic-close`**（State、Both、Definite）。`epicsToClose`の各項目（`BUG`と`ENHANCEMENT`以外で、タスクが1つ以上あり、すべて Done で、`EPIC.md`の本文に未チェックの`- [ ]`が残るエピック）について、参照条件を確認して結果を記録するよう求めます。
  - **`stale-running`**（State、Both、Check）。AI タスクが Running で、最新の履歴（履歴がなければ最後の実行状態の変更）が30分より前の場合に（`src/nudge/state_rules.rs`の`STALE_RUNNING_MINUTES`）、作業が止まっているなら`state`で idle に戻し、続いているなら`history add`で進捗を記録するよう求めます。
  - **`next-task`**（State、Both、Check）。`nextTasks`が空でなく、Running の AI タスクがない場合に、先頭の次のタスクに着手するよう求めます。
  - **`draft-moved`**（State、Both、Definite）。AI の下書きが Doing にある（人が移した）場合に、`start <id> --actor ai`で開始するよう求めます。
  - **`drafts`**（State、Both、Check）。未回答の質問がない AI の下書き（質問がある下書きは待機中で一覧に出ません）ごとに、ID、題名、レーンを示して1件ずつ求めます。下書きは計画が固まっていないことを意味します。計画が固まっているなら開始し（順序はエピックの priority に、依存関係は`EPIC.md`に書き、待たせるために下書きのまま残さない）、固まっていないなら固めるための質問をします。
  - **`result-pr`**（Turn、TurnEnd、Definite）。プロジェクトにDoingかつRunningのAIタスクがあり、ターン中に`agboard ... result add`がなく、`gh pr create`があったとき。プルリクエストを作ったのに成果がありません。
  - **`result-artifact`**（Turn、TurnEnd、Check）。同じ条件で`gh pr create`がなく、`git push`か画像の書き出し（拡張子が`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`の画像、またはスクリーンショット）があったとき。見せられるものなら`result add`で記録するよう求めます。
  - **`history`**（Turn、TurnEnd、Check）。プロジェクトにDoingかつRunningのAIタスクがあり、ターン中にコミット、テスト実行（`cargo test`、`pnpm ... test`、`npm test`、`vitest`、`playwright test`など）、プッシュ、プルリクエストの作成のいずれかがあり、`agboard ... history add`、`state`、`mv`、`result add`のどれもなかったとき。意味のある進捗を`history add`で記録するよう求めます。
  - **`conditions-after-merge`**（Turn、TurnEnd、Check）。ターン中に`gh pr merge`があり、Doingの AI タスクに未達の完了条件があるとき。該当するタスクごとに、マージで確認できたなら検証内容をタスク本文に記録して完了条件を済みにするよう求めます（プルリクエストとタスクは結び付いていないため、どのタスクかはエージェントが判断します）。
  - **`start-task`**（Turn、TurnEnd、Definite）。ターン中にファイルを編集（パス付きのEditかWrite、`apply_patch`、`git commit`）し、DoingかつRunningのAIタスクがないとき。`/tmp`とAgent Boardのデータフォルダだけの編集は無視します。タスクの着手（`agboard mv <id> doing`、`agboard state <id> running`）か新規作成を求めます。

#### ルールを足す

1. `src/nudge/rules.rs`に、`fn(&Facts) -> Vec<Finding>`の関数と、上のフィールドを持つ`RULES`の項目を足します。リマインダーを出したい順に並べます。
2. `src/nudge/cases.rs`にケースを足します。ルールが引き金を引くケースと引かないケースを、それぞれ1つ以上です。どちらかがないと`every_rule_has_cases`が失敗し、`every_case_gives_the_expected_result`が全ケースを実行します。
3. 上の一覧にルールを足します。このページと英語のページの両方です。どちらかにルールのIDがないと、テストが失敗します。
4. ルールがコマンドや進行表のフィールドに結び付くときは、`src/nudge/coverage.rs`のその`NoRule`を`Rules(&["your-rule"])`に置き換えます。

`State`のルールは、ほかに変更はいりません。リマインダーは、進行表（したがってHookが渡す文脈）とStopのチェックリストに、自然に出ます。ターンの新しい事実が要る`Turn`のルールは、2つのトランスクリプト形式を読む`src/nudge/turn.rs`を拡張します。

#### 機能を足すとき

`agboard`のすべてのコマンドと、進行表のすべてのトップレベルのフィールドは、`src/nudge/coverage.rs`に載っていて、それが作るものを見張るルール、または`NoRule("理由")`に対応付けられています。テストは両方の一覧をコード（clapのコマンド定義と、シリアライズした進行表）から導くので、コマンドやフィールドを足すと、判断するまでテストが失敗します。新しい機能は、エージェントが忘れうるもの（出すべき質問、書くべき記録、整えるべき状態）を作るでしょうか。作るなら、上のとおりルールを足します。作らないなら、理由つきで`NoRule`を記録します。`planned: #NNN`の形の理由は、ルールを足すタスクを示します。

## 変更を待つ

`agboard wait --after <cursor>`は、プロジェクトが変わるまで待ちます。

1. 同じデータ領域の`serve.json`から`pid`と`port`を読み、`GET /api/events`に接続します。応えるサーバーがなければ、先に起動して応えるまで待ちます（[サーバーと画面](./server-and-ui.md#コマンドがサーバーを起動する手順)を参照）。`serve.json`を読んだ後に接続が失敗したときは、もう一度だけ起動します。
2. プロジェクト名をcursorと照合して、ProjectIdを固定します。別のプロジェクトや旧形式のcursorは`cursor_invalid`です。
3. `ready`の後に、プロジェクトの現在のversionとcursorを比べます。違えばすぐに返します。これにより、初回取得から購読開始までに起きた変更も検知できます。
4. 同じなら`changed`を待ちます。読み直してもversionが同じ（ほかのプロジェクトが変わった）なら、待ち続けます。

- `changed`・`ready`・接続維持のコメントは区別します。名前変更では同じプロジェクトのスナップショットを返し、削除では`project_not_found`を返して、作り直したプロジェクトへは移りません。
- 接続の上限は3秒で、待機そのものは既定で無期限です。任意の`--timeout`を付けると、最後にversionをもう一度確かめ、変わっていなければ`wait_timeout`を返します。待機中の切断は`board_unavailable`で、そのときにサーバーを起動し直すことはしません。自動で短い再試行を繰り返すことも、定期的にポーリングすることもありません。
- 変更待機は、cursorと異なるファイルを1回読んだだけでは信用しません。エディターが上書き保存するとき、ファイルはいったん切り詰められてから書き込まれるため、その途中を読んでしまうことがあるからです。待機は250ミリ秒後に、期限を超えない範囲でもう一度読み、変更がまだ残っている場合だけ返します。同じ内容に戻る保存では待機は終わらず、実際の変更は約250ミリ秒遅れて返ります。
- 切断・時間切れ・Ctrl+Cでタスクや履歴が変わることはなく、「変更なし」として扱うことも、終了したエージェントを起動し直すこともありません。
- CLIの通知はベストエフォートなので、通知を取りこぼした場合は、次の接続、実際の`changed`、または時間切れ時の最終読み込みで変更を検知します。

### 回答を待つ

`message ask`は質問を保存し、`serve`へ通知してから、同じSSEのストリームで回答を待ちます（`wait_engine`の上の`src/agent/message_wait.rs`）。保存前にサーバーを確認し、動いていなければ起動します（[サーバーと画面](./server-and-ui.md#コマンドがサーバーを起動する手順)を参照）。起動できないときは何も保存せず`board_unavailable`で失敗します。`message wait <question-id> [<question-id>...]`は、保存済みの質問を待ち直します。質問を出し直すことはありません。

出力は、`--json`ではJSON Lines、なしでは同じイベントを英語の文で出します。最初の行は`registered`、最後の行は`answered`（終了コード0）、`timeout`（5）、`withdrawn`（6）、`error`のどれかです。その間、`--heartbeat`秒ごと（既定60、10〜600）に`waiting`を出します。この間隔はタイマーで、ボードは読みません。ボードを読むのは、サーバーが変更を伝えたときだけです。`answered`は、全問に回答が揃ったときだけ出します。開いている質問がなくなり、取り下げられたものがあるときは、代わりに`withdrawn`で終わります。待つ時間は既定で600秒で、`--timeout`は1〜86,400秒、または期限なしの`none`を受け付けます。時間切れ・中断・接続断の後も、質問は未回答のまま残ります。`--no-wait`は保存と通知の後に`registered`を出して終わり、サーバーを必要としません。

質問するとRunningのタスクはIdleに戻ります。回答が揃ったら、エージェントは回答と履歴を読み、理由を添えて明示的にRunningへ戻します。イベントの項目は[エージェントへの出力](../reference/agent-output.md#messageのイベント)、利用手順は[判断依頼](../../guide/delegate/decisions.md)を参照してください。

### 次のタスクを待つ

`agboard --project <name> wait --until task --idle-timeout <seconds> --json`も、同じイベント駆動の待機エンジンを使います。購読前に対象タスクを読み、SSEの`ready`後と各`changed`イベントの後にも確認します。初回の読み込みで対象がなかったとき、単調時計に基づく期限を一度だけ設定します。無関係なプロジェクトの変更や接続維持コメントでは期限を延長しません。期限に達すると最後に一度読み直し、境界時刻までに到着したタスクがあれば返します。なければ終了コード0で`idle_timeout`を返します。

対象の順序には進行表と同じ`ordered_tasks`を使います。エピックID順に、各エピックの保存済み優先順とタスクID、最後に未所属タスクのID順です。返すのはAI担当でTodoまたはDoing、かつ表示上の稼働状態がIdle（人の判断待ちのタスクはPendingと表示され、返りません）で、下書きでもアーカイブでもないタスク一件です。開始前の初回読み込みで、リッスン前に作成されたタスクも対象になります。タスクより先に、AIがまだ受け取っていない回答と未処理の依頼を返します（下記）。結果には、そのsnapshotのcursor、タスク、ローカルの`TASK.md`パス、エピックに所属する場合は`EPIC.md`のパスが含まれます。取得は読み取りだけでタスクを占有しないため、操作を始める前に最新状態を読み直します。リッスン手順では全体snapshotを確認し、既存AIタスクの`running`または`pending`を先に解決します。DoingのタスクもIdleなら再開候補です。対象なしでの期限到達は正常な結果ですが、読取不備・サーバー停止・プロジェクト削除はエラーです。

人の回答もエージェントの質問に対して、同じ三つの場所に`answers`配列・`answers`結果として届きます（[Hook・進行表・waitの出力](../reference/agent-output.md#進行表)を参照）。回答は、エージェントが`message accept`で受け取るまで残り、受け取ると返信の`acceptedAt`が記録されます。`message ask`と`message wait`は、返した回答を自分で受け取ります。エージェントがチャットから記録した回答は、書かれた時点で受け付け済みです。したがって明示の`message accept`が必要なのは、Hook・進行表・`wait --until task`で見た回答だけです。受け取り待ちの回答があってもタスクはPendingになりません。waitは回答、依頼、タスクの順に返します。

人からの依頼がエージェントに届く場所は三つあります。進行表の`requests`配列、Hookが出す同じ進行表、そして`wait --until task`の`requests`結果です。依頼は、エージェントが`message accept`で引き受けるか、人が取り下げるまで未処理です。依頼が新しく届く、受理される、取り下げられると、プロジェクトの`messages`リソースが変わるので、待ち受け中のエージェントは新しいタスクと同じ`changed`イベントで起きます。waitはタスクより先に未処理の依頼を返し、どれかが受理されるまで同じ依頼を返し続けます。受理は明示の操作なので、waitが返しただけで依頼が引き受けられることはありません。未処理の依頼があってもタスクはPendingになりません。Pendingになるのは、未回答の質問か、読めないメッセージファイルがあるときだけです。

一つのセッションで続けて作業する手順として、タスク情報の補完、計画の確認、回答待ち、直列処理、中断後の復帰をリッスン手順（`agboard skills listening`、元は`src/skills/topics/listening.md`）に定めています。未回答の質問は、回答されるか取り下げられるまでそのセッションを止めます。次のタスクへ飛ばず、待ち時間も対象なし時間として扱いません。

常駐セッションは、代わりに`agboard skills resident`（`src/skills/topics/resident.md`）に従います。常駐セッションには2種類あります。

- **ボードが起動したセッション**はpushモードで動き、`wait`を実行しません。サーバーがボードを見張り、セッションに仕事を送ります（[pushモード](#push-mode)を参照）。起動したセッションへの最初の指示（`src/server/resident/cli.rs`の`prompt`）は、`agboard skills resident`を実行すること、`agboard wait`を実行しないこと、ターンを終えてボードからのメッセージを待つこと、質問はボードだけで行うこと、ボードに止められたときだけ止まることを伝えます。単体テストがプロンプトにこれらの語句を、スキルのテストがトピックの語句を保ちます。
- **人がボードに張り付くよう指示したセッション**は、プル型のままです。同じ`wait --until task`を繰り返し、回答、依頼、タスクをリッスン手順と同じように処理しますが、`idle_timeout`では終わりません。レジストリは閉じたイベントストリームを30秒だけ数え続けるため、それより間が空くと別のセッションが起動しうるので、タイムアウトや対象なしで返った待機は数秒以内にやり直します。Claude Codeは、ハーネスが長いフォアグラウンドコマンドを止めるため、待機をバックグラウンドで実行します。Codexはフォアグラウンドで待ちます。

ボードが起動したセッションは自動承認でヘッドレスに動くので、人への質問はボードの`message ask --no-wait`だけで行い、ターンを終えます。回答は`answers`メッセージとして押し込まれます。

`wait --until task`は、どのセッションが待っているかもサーバーに伝えます。ボードに張り付いているセッションを数えるためです。これを行うのは外部のセッションだけです。ボードが起動したセッションは待たないので、サーバーが自分で数に加えます（[pushモード](#push-mode)を参照）。イベントストリームのリクエストに、セッションのキー、ツール、起動元、プロジェクトのIDを`X-Agboard-Session*`ヘッダーで付けます（[張り付いたセッション](../reference/web-api.md#張り付いたセッション)を参照）。出力するJSONは変わりません。コマンドは自分の環境変数からこれらを読み、環境からはそれ以外を送りません。

- 起動元: `AGBOARD_RESIDENT_ID`が設定されていれば（ボードの起動処理が設定します）`board`、なければ`external`です。
- ツール: `AGBOARD_SESSION_TOOL`（`claude-code`または`codex`。ボードの起動処理が設定します）があれば、それが優先されます。なければ`CLAUDECODE`または`CLAUDE_CODE_SESSION_ID`があれば`claude-code`、`CODEX_THREAD_ID`、`CODEX_SANDBOX`、`CODEX_SANDBOX_NETWORK_DISABLED`のいずれかがあれば`codex`、どれもなければ`unknown`です。`CODEX_COMPANION_SESSION_ID`はClaude Codeのプラグインの変数でCodexのものではないため、使いません。
- キー: `AGBOARD_RESIDENT_ID`、`CLAUDE_CODE_SESSION_ID`、`CODEX_THREAD_ID`のうち最初に設定されているもの、どれもなければ親プロセスIDです。送るキーは、接頭辞（`resident`、`claude`、`codex`、`ppid`）と、値のSHA-256の先頭16桁（16進数）で、値そのものは送りません。コマンドごとに新しいシェルを起動し、これらのどれも設定しないエージェントでは、親プロセスIDがコマンドごとに変わるため、短いセッションが何本も見えます。ボードはこれを隠しません。

サーバーは、ストリームが開いている間と、閉じてから30秒の猶予の間、セッションを数えます。待機を繰り返すセッションは、1つのセッションのままです。登録はサーバーのメモリ（`src/server/sessions/`）にあり、保存しません。Codexの変数はCodexがコマンド向けに公開しているものですが、この変更を書いた時点では、動作中のCodexで確認していません。

### 張り付くセッションの起動

ボードのサーバーは、プロジェクトに結び付けたフォルダで、画面を持たないClaude CodeまたはCodexのセッションを起動できます。起動したセッションは、自分で起動したセッションと同じようにボードを待ちます。起動処理（`src/server/resident/`）は、これらのCLIに対するAgent Boardの唯一の依存先です。`claude`や`codex`の名前、フラグ、出力を知っているのはここだけです。ルートは[セッションの起動](../reference/web-api.md#セッションの起動)にあります。**起動したセッションは、無人で自動承認のまま動きます。** 先に[ボードが起動するセッション](./security.md#ボードが起動するセッション)を読んでください。

起動処理がすること:

- **確認。** CLIがサーバーの`PATH`にあり（なければ`agent_cli_missing`）、ログイン済みであること（`agent_cli_logged_out`）を確かめます。Claude Codeは`claude auth status`の`loggedIn`、Codexは`codex login status`が終了コード0で終わるかどうかです。これらの呼び出しとモデルの一覧は、リクエストが長く待たされないよう、それぞれ20秒を上限とします。ログインの確認が時間切れになると`session_launch_failed`です。`AGBOARD_CLAUDE_BIN`と`AGBOARD_CODEX_BIN`は、`PATH`を探す代わりに実行ファイルを指定します。テストはこれに偽のスクリプトを指定します。
- **モデル。** Claude Codeにはモデルを一覧するコマンドがないので、固定の別名`opus`、`sonnet`、`haiku`、`fable`を示します。Codexは`codex debug models`で一覧し、`visibility`が`list`のモデルだけを示します。一覧を読めないとき（コマンドがない、失敗した、20秒を超えた、期待するJSONではない）は、`reason`付きの空の一覧を返し、モデルを指定しない起動ではツール自身の既定のモデルを使います。示していないモデルと、フラグに読めてしまう名前は、`invalid_value`で拒否します。
- **承認。** Claude Codeは`--permission-mode auto --permission-prompts none`で動きます。レビュアーが各操作を確認し、確認が必要になる操作は、拒否されたツールの結果として返るので、人を待つことはありません。Codexは`codex app-server`として動き、スレッドはworkspace-writeのサンドボックス、`approvalPolicy`の`on-request`、`approvalsReviewer`の`auto_review`（自動レビュー。以前の1方向の起動での`--approve-for-me`に当たります）、`sandbox_workspace_write.writable_roots`のデータ領域で始まるので、セッションの`agboard`の書き込みがサンドボックスに阻まれません。`cwd`はプロジェクトのフォルダです。これらの設定を書いてあるのはここだけです。
- **起動。** ツールやプロジェクトによらず、全体で1つです。この起動処理にすでに生きている子プロセスがあるとき（セッションが動き出す前の隙間を塞ぎます）、再起動が待っているとき、または、登録にどちらかのツールのボード起動のセッションが数えられているときは、枠を持っているツールを示す理由付きで`session_launch_refused`として拒否します。自分で起動した外部のセッションには上限がありません。子プロセスは、プロジェクトに結び付けたフォルダで起動し、出力は`<データ領域>/resident/<ツール>.log`に書きます。最初の指示はスキルを使ってターンを終えることを伝え、以後の仕事はボードが送ります。
- **ドライバー。** 起動処理は、CLIの通信形式を直接は扱いません。`AgentDriver`（`src/server/resident/driver/mod.rs`）を起動し、セッションごとに1つのスレッドで`DriverEvent`を読みます。監督、健全性の確認、監視は、この出来事だけを見ます。トレイトの操作は、`start`（作業フォルダ、モデル、最初の指示、書き込める先、環境、ログ）、`next_event`、`is_idle`、`send_user_message`、`answer_permission`（`Allow`または`Deny { reason }`）、`interrupt`、`stop`、`pid`です。出来事は、`Started { session_id, tool_version }`、`Activity`、`PermissionRequest { id, kind, summary }`、`TurnEnded`（`Completed`、`Interrupted`、`Failed`）、`Unknown`、`Exited { code, signal }`です。**セッションを終わらせるのは`Exited`だけです。** ターンが終わってもセッションは終わりません。Claude Codeは、バックグラウンドのコマンドが終わると自分で次のターンを始めるからです。`is_idle`はセッションがターンの合間かどうかを返し、`send_user_message`はいつでも呼べます（ターンの実行中、Claude CodeはCLIが待たせ、Codexは実行中のターンに差し込みます）。許可の問い合わせは`decide_permission`という1つの関数で決め、いまはすべて許可します。`Launcher::with_factory`でドライバーを差し替えられ、単体テストでは`MockDriver`を使います。`AgentDriver`の台本どおりに動く実装で、受けた呼び出しを記録するので、テストがあとから確かめられます。
- **Claude Code。** `ClaudeDriver`は`claude -p --input-format stream-json --output-format stream-json --verbose --permission-mode auto --permission-prompts none`（と`--model`）で動かすので、許可の扱いは以前と同じです。最初の指示は、標準入力へstream-jsonの`user`メッセージとして送り、入力はセッションの間ずっと開いたままにします。閉じるとセッションが終わるためです。出力は1行ずつJSONとして読み、必要なフィールドだけを使います（知らないメッセージは`Unknown`の出来事、8 MiBを超える行は読み飛ばします）。エラー出力は常にログへ流します。`system/init`のツールのバージョンはログに書きます。autoモードではCLIは通常、許可の問い合わせを送りません。送られてきた`can_use_tool`には`control_response`で答え（許可は入力を`updatedInput`として返し、拒否は理由を添えます）、知らない種類の制御要求にはエラーの応答を返します。
- **Codex。** `CodexDriver`（`codex.rs`）は`codex app-server`を動かします。標準入出力は改行区切りのJSON-RPCで、`jsonrpc`フィールドはありません。`initialize`（クライアント名は`agboard`）と`initialized`を送り、続けて`thread/start`を送ります。パラメータは`cwd`、`model`（選んだときだけ）、`approvalPolicy: on-request`、`approvalsReviewer: auto_review`、`sandbox: workspace-write`、`config.sandbox_workspace_write.writable_roots`です。最初の指示が最初の`turn/start`です。この指示でエージェントはSkillを読み、`agboard wait`を実行せずにターンを終えます。仕事はそのあと、ボードが次のターンとして1つずつ送ります（[pushモード](#push-mode)を参照）。`Started`にはスレッドIDと、`initialize`の結果の`userAgent`から取ったバージョンを入れ、バージョンはログにも書きます。`send_user_message`は、待機中なら新しいターンを始め、ターンの実行中は`turn/steer`を使います。サーバーに断られた差し込みや、ターンがまだ分からないうちに届いたメッセージは待たせ、`turn/completed`のあとの次の`turn/start`で送ります。`interrupt`は`turn/interrupt`で、`is_idle`は`turn/started`と`turn/completed`に従います。`turn/completed`の状態が`failed`なら、エラーメッセージ付きの`TurnEnded(Failed)`です。サーバーを終わらせる要求はないので、`stop`は入力を閉じ、そのあとはClaude Codeと同じSIGTERMとSIGKILLの手順です。やり取りはプロセスを持たない状態機械（`codex_parse.rs`、`codex_inbound.rs`）で、こちらが送る要求のidとサーバーの要求のidを分けて持ち、`itemId`からitemへの対応表も持ちます。ファイル変更のパスは`item/started`にしか出ないからです。読むのは必要なフィールドだけで、`hook/*`、`mcpServer/*`、`account/*`、トークン使用量などは無視します。8 MiBを超える行は読み飛ばし、トレースの文字列であるエラーストリームはログに流します。
- **Codexの承認。** ボードに届く承認の問い合わせ（`item/commandExecution/requestApproval`、`item/fileChange/requestApproval`）は`PermissionRequest`になり、`decide_permission`で答えます。`Allow`は`accept`、`Deny`は`decline`で、答えに理由の欄はないので理由は落ちます。サーバーからのそれ以外の要求にはJSON-RPCのエラー`-32601`を返します。答えないとターンが止まるからです。ふつうは自動レビューが先に答えます。codex-cli 0.170.0の実機では、サーバーが`auto_review`を受け付けて`thread/start`の結果にも反映し、ボードへの承認の問い合わせは来ませんでした。
- **環境。** 子プロセスには、サーバーの環境から`CLAUDECODE`、`CLAUDE_CODE_*`、`CODEX_*`、`AGBOARD_RESIDENT_ID`を除いたものを渡します。サーバー自身のエージェントのセッションが、子プロセスを別のツールに見せないためです。`CODEX_HOME`、`CODEX_API_KEY`、`CLAUDE_CODE_OAUTH_TOKEN`は、CLIの設定やサインインに使うので残します。そのうえで`AGBOARD_RESIDENT_ID`（ランダムな起動ID）、`AGBOARD_SESSION_TOOL`、`AGBOARD_SESSION_ORIGIN=board`を設定します。これにより、子プロセスの`agboard`コマンドが外部のセッションと区別されます。`message ask`は、保存する各質問に`AGBOARD_RESIDENT_ID`を`askedBy`として記録し、これらの変数を付けて実行した`wait`は起動元`board`を報告します。
- **停止。** 子プロセスは、自分のプロセスグループの先頭です。停止はドライバーに終了を頼みます。ドライバーは子プロセスの標準入力を閉じ、短い猶予（1.5秒）を置いてからグループへSIGTERMを送り、5秒後にSIGKILLを送ります。子プロセスが先に終了しても、その子が起動したコマンドがグループに残っているとき（SIGTERMを無視するものなど）は、それにもSIGKILLを送ります。そのうえで、そのセッションの登録をすぐに外します。すでにいないセッションの30秒の猶予のために、次の起動が拒否されることはありません。子プロセスが自分で終了したときも同じで、すべての子プロセスをスレッドが待つので、ゾンビは残りません。停止、起動、再起動は1つずつ順に実行します。停止は、その前に用意された自動起動や再起動も取り消すので、どれもセッションを復活させません。サーバーが終了するときは、起動したすべての子プロセスを止めます。強制終了されたサーバーは、これを行えず、子プロセスが動いたまま残ります。
- **健全性と再起動。** 人が起動すると、ボードはそのセッションを動かし続けます。誰も止めていない子プロセスが終了すると、監視が同じプロジェクト、ツール、モデルでもう一度起動します。待ち時間は2秒から始まり、失敗のたびに倍になります（上限は60秒）。10分以内に5回失敗すると再起動をやめ、健全性は理由付きの`failed`になり、人が起動し直すまでそのままです。10分動き続けたセッションは、数え直しになります。プロセスの起動に失敗したときも失敗として数えます。コマンドがない、ログインしていない、プロジェクトがなくなったときは、再試行しても直らないので、すぐに`failed`にします。人が止めると、その記録が消えるので、再起動にはならず、待っている再起動や表示中の失敗も消えます。
- **不健全な子プロセス。** 生きていても一度も動き出さない子プロセスは入れ替えます。ドライバーが最初の`Started`または`TurnEnded`を報告した子プロセスは、張り付いたものとみなし、監視は1秒ごとに確認します。新しい子プロセスが張り付くまでの猶予は3分で、張り付かなければ、停止と同じ方法で終了し、理由（`never started`）を記録します。この終了も、ほかの終了と同じく失敗として数えます。一度張り付いた子プロセスは、プロセスの終了だけで終わりとみなします。タスクのターンはどんな上限よりずっと長くかかることがあるためです。健全性は`waiting`（セッションが張り付いていて、ターンの合間にいる）を返すので、画面は動作中のセッションを作業中として表示できます。ボードが起動したセッションの健全性に、レジストリは関わりません。
- **自動起動。** サーバーと一緒に起動するセッションの選択は、ツール、プロジェクト、モデルの組で、最大1つです。[`.internal/resident-autostart.json`](../reference/files.md#セッションの自動起動)に保存します。サーバーが起動すると、バックグラウンドのスレッドがそれを起動します。そのため、CLIの確認より前にサーバーは待ち受けています。起動に失敗してもサーバーは止まらず、理由付きの`failed`として表示します。プロセスの起動の失敗は、クラッシュと同じように再試行します。自動起動を切っても、動いているセッションは止まりません。セッションのレスポンスには、そのセッションの[健全性](../reference/web-api.md#セッションの健全性)が入ります。

### pushモード {#push-mode}

ボードが起動したセッションは、ボードを待ちません。待つのはサーバーです。起動した子プロセスごとに、起動処理がpusherスレッド（`src/server/resident/push/`）を動かし、`AgentDriver::send_user_message`で仕事を送ります。人がターミナルで開いたセッションはプル型のままで、影響を受けません。

pusherが見るとき。ボードが変わったとき（サーバーが変更フィードを`Launcher::nudge`に渡します）、ターンが終わったとき（イベントを読むスレッドが`TurnEnded`を見ます）、そして念のため少なくとも`push_poll`（10秒）ごとに起きます。ドライバーが`is_idle()`でなければ何もしないので、ターンの実行中には送らず、ターンが終わるのを待ってもう一度見ます。Claude Codeにはstream-jsonの`user`メッセージとして、Codexには通常の`turn/start`として指示を送ります。待機中のセッションには差し込む先のターンがないためです。

送るもの。`wait --until task`と同じ順序で、一度に1つの指示です。

1. 誰も受領していない回答のうち、`askedBy`を持つ質問へのもの。`message ask`は`AGBOARD_RESIDENT_ID`をそこに記録するので、ボードが起動したセッションの質問と、外部のセッションが出した質問（`askedBy`がありません）を区別できます。ボードが起動したセッションは同時に1つまでなので、`askedBy`を持つ質問は、いまのセッションか以前の実行が出したもので、どちらでも伝える相手はこのセッションです。外部のセッションの質問への回答は、そのセッション自身の`wait`や`message wait`に任せます。
2. 未処理の依頼。pusherは送る直前にボードを読むので、外部のセッションがすでに受領した依頼（`message accept`が成功するのは最初の1回だけです）は送りません。
3. 次の着手可能なタスク。`wait --until task`と同じ基準で選びます。AIのタスクで、TodoまたはDoingにあり、Idleで、下書きでもアーカイブ済みでもないものです。すでに誰かが作業しているタスクはRunningなので送りません。同じタスクを外部のセッションが同時に取った場合の競合は、外部のセッション同士と同じです。最初に開始した側が勝ち、もう一方は読み直して次へ進みます。

文面は、スキルの「Work the board pushes」の部分に従い`wait`を実行しないよう伝える1文と、同じ項目に対して`wait --until task --json`が返すはずのJSON（`kind`、`projectId`、`cursor`、そして`answers`、`requests`、`task`のいずれか）です。

失敗したターン。pusherは、送ったものを項目ごと（`answer:Q-3`、`request:Q-5`、`task:12`）に記録します。項目が与えたターンのあともボードに残っているときは、`push_backoff_base`（30秒）から始まり`push_backoff_max`（5分）まで倍になる待ち時間を置いてからでないと再送せず、再送は合計で最大`push_max_attempts`（3）回です。それを超えた項目は飛ばされ、健全性の`pushStalled`に、種類、ID、押し込んだ回数、直前の失敗したターンのメッセージとともに載ります。ほかの項目は続けて送るので、失敗する項目1つがボードを止めることはありません。ボードから消えた項目（受領、取り下げ、着手可能でなくなった）は、記録と一覧から消えます。人がなお処理したい項目が止まっているときは、判断が要ります。セッションを止めて起動し直すか、その項目を手で片付けます。

数と健全性。レジストリはセッションを開いた`wait`ストリームで数えるので、起動したセッションはそこに現れません。`GET /api/projects/{id}/sessions`が、これを一覧に加えます。`SessionList::with_session`が、`Launcher::board_session`の作るエントリ（`origin: board`、ツール、`resident:`に起動IDを続けた`id`）を合流させて数え直します。子プロセスが最初のイベントを報告すると現れ、ターンの合間は`connected`、作業中は`grace`です。外部のセッションはこれまでどおり一覧に載り、数えられます。健全性の`waiting`は、セッションが張り付いていてターンの合間にいる間`true`です。健全性の確認、再起動、クラッシュの繰り返しの上限は、起動したセッションにだけ適用され、レジストリではなくドライバーの出来事（`Started`、`TurnEnded`、`Exited`）を読みます。

テスト。`src/server/resident/tests/push.rs`は、一時フォルダの実際のボードを相手に、`MockDriver`で起動処理を動かします。依頼、回答、タスクが待機中のセッションに送られること、ターンの最中や受領済みの依頼では送られないこと、起動したセッションの質問への回答だけが送られること、失敗し続ける項目が3回の送信で止まり止まっていると表示されることを確かめます。`tests/resident_e2e.rs`は、`wait`を実行しない偽のスクリプトとして両方のCLIを動かし、外部の`wait`が起動したセッションと並んで数えられることを確かめます。

## 自動Done

規則は[データモデル](./history-and-decisions.md#完了条件と自動done)で定めています。評価は次のように行います。

- FileStoreのプロジェクトロックの中で、最新の`TASK.md`とタスクの項目を読み直し、共通の判定を一つ適用します。
- `serve`は起動時、最初のスナップショットを公開する前に既存のタスクを評価します。稼働中は、FileStoreの保存の後と、監視が捉えた原子的なファイル更新の後に評価します。自分の通知で再び評価が始まることはなく、同じタスクを評価し直しても履歴は重複しません。
- エピックも変えるCLIの編集は、すべての変更を適用した後に評価します。AI向けのCLIとFileStoreの入口は、Doneの制限を適用します。
- 人の判断待ちのタスクは飛ばし、回答の後に評価し直します。Doneのタスクが自動で再開することはありません。
- 自動Doneには動いているサーバーが必要です。Hookがサーバーを起動し、監視が捉えたファイルの変更も「使われている」に数えるので、エージェントが編集を続ける間に自動のサーバーが止まることはありません。
- エージェントは、検証を履歴に記録し、簡潔な結果を本文に書いてから、最後の条件を`done: true`にします。
- 新しい版の`serve`を起動すると、条件を満たした既存のタスクが完了します。通常の利用に導入する前に、対象のタスクを一覧にしてバックアップを取ってください。

この制限は、ルールに従うエージェントの誤操作を防ぐためのものです。ファイルの直接編集やactorの偽装を防ぐ認証機能ではありません。

## 初回案内のサンプルカード

以前のリリースは、初回の案内のためにサンプルカードを2枚作り、それぞれに`onboardingSample`の識別（実行IDと順番（1または2））を付けていました。今の案内はWeb UIの中で進み、カードは作りません。ただし、進行表、Hook、`wait --until task`は、この識別のあるカードを、レーンや稼働状態に関係なく今も除外します。そのため、エージェントがこのカードを扱うことはありません。サーバーは、古い案内のファイルを見つけたときに、このカードを一度だけアーカイブします（[保存と復旧](./saving-and-recovery.md#初回案内の状態)を参照）。

識別は案内だけが書き込みます。作成と編集の要求には識別のフィールドがなく、移動・履歴の更新・アーカイブ・復元のあいだも識別は保たれます。ボードにはカードが表示されます。利用者から見た動きは[始める前に](../../guide/quickstart.md#before-you-start-the-first-run-guide)を参照してください。

## プラグイン

SkillとHookは、このリポジトリのマーケットプレイスから、1つのプラグイン`agent-board`として配布します。どちらのエージェントも自分のプラグインのコマンドで導入するので、agboardはHookやマニフェストのファイルの写しを埋め込みません。例外はSkillの本文で、バイナリが埋め込みます（[バイナリから出すSkill](#バイナリから出すskill)）。プラグインのSkillは、`agboard`に本文を尋ねる入口だけです。

| パス | 内容 |
| --- | --- |
| `.agents/plugins/marketplace.json` | Codexのマーケットプレイスのカタログ。名前は`agent-board`。 |
| `.claude-plugin/marketplace.json` | Claude Codeのマーケットプレイスのカタログ。名前は`agent-board`。 |
| `plugins/agent-board/.codex-plugin/plugin.json`<br>`plugins/agent-board/.claude-plugin/plugin.json` | プラグインのマニフェスト。 |
| `plugins/agent-board/skills/agent-board/` | Skillの薄い入口。`SKILL.md`のみ。 |
| `plugins/agent-board/skills/remote/` | `remote` Skill。`SKILL.md`のみ。 |
| `plugins/agent-board/skills/wait/` | `wait` Skill。`SKILL.md`のみ。 |
| `plugins/agent-board/hooks/codex.json`<br>`plugins/agent-board/hooks/claude.json` | 各エージェントのHook。 |

両方のマニフェストのプラグインの版はクレートの版と同じで、Hookのコマンドは版を持たず、`agboard hook --agent <agent>`そのものです。`tests/plugin_layout.rs`と`scripts/release/check-version.py`がこれを確かめるので、リリースのタグには、常にバイナリと同じ版のプラグインが入っています。

## Hookのスキップとエラー

Hookは、`FileStore::resolve_binding`でプロジェクトを解決します。これは`ResolvedBinding`（プロジェクトと登録済みのフォルダ）を返します。`project_for_folder`はこれを呼ぶので、通常のコマンドの`folder_unbound`エラーは変わりません。

| 入力・状態 | 動作 |
| --- | --- |
| `cwd`が登録済みのフォルダ、そのサブフォルダ、またはより近い入れ子の登録済みフォルダの中 | 最も近いプロジェクトだけを、`AGBOARD_PROGRESS`として返します。 |
| フォルダの登録情報が正常で、`cwd`が読め、一致する登録がない | stdoutにもstderrにも出力せず、終了コード0。ボードは読みません。 |
| 最も近い登録のプロジェクトが存在しない | `bound_project_missing`。親へ戻りません。 |
| フォルダの登録情報が壊れている、または読めない | 原因を付けた`AGBOARD_ERROR`。未登録とは扱いません。 |
| 入力がJSONでない、型が違う、大きすぎる | これまでどおり`invalid_hook_input`。 |
| `cwd`がない、`null`、空 | プロセスの作業フォルダを使います。 |
| `cwd`が文字列でない、または相対パス | `invalid_hook_input`。 |
| `cwd`が存在しない、または読めない | `hook_cwd_unavailable`。スキップにはしません。 |
| 明示した`--project` | 指定したプロジェクトを優先します。見つからなければ`project_not_found`。 |

一覧256 KiB、10秒の制限、イベントの許可リスト、固定コマンドは変わりません。Hookは、ネットワークの利用も設定の書き込みもしません。Hookが起こす変化は、サーバーの起動と、プラグインが違うときにバックグラウンドで始める[プラグインの自動更新](#プラグインの自動更新)です。出す通知は、その更新がセッション開始時に出すものだけです。古いプラグインは、いまもHookを`--plugin-version <version>`付きで実行します。このオプションは受け付けて無視します。

## バイナリから出すSkill

`agent-board` Skillの本文は、ビルド時に`agboard`へ埋め込むので、実行するバイナリと常に一致します。`agboard skills`は本文（`src/skills/agent-board.md`、frontmatterなし）を出力します。`agboard skills <topic>`は、参照や雛形を1つ出力します。トピックは`project`、`language`、`files`、`requests`、`work-loop`、`questions`、`waiting`、`file-format`、`listening`、`resident`、`planning`、`fixed-epic-bodies`、`drafts`、`phone`、`results`、`task-template`、`epic-template`、`bug-epic-template`、`enhancement-epic-template`です（`src/skills/topics/`）。本文には、エージェントが毎回守る規則だけを置き、各節から、手順、コマンドの使い方、例を載せたトピックを案内します。Claude Codeは`!`コマンドの出力を約30,000文字までしか取り込まず（超えるとプレビューに切り詰めます）、単体テストが本文と各トピックを28,000文字以下に保ちます。増えたときは、状況に応じた節をトピックへ移します。トピックにない名前は、トピックの一覧を出力します。このコマンドは何も読み書きせず、ロックを取らず、サーバーを起動せず、ネットワークを使わず、常に終了コード0で終わります。データ領域を解決できなくても同じです。

プラグインの`SKILL.md`は、`name`、`description`、`compatibility`を残し、`allowed-tools: Bash(agboard *)`を加え、本文は`` !`agboard skills` ``の1行です。Claude Codeは、Skillを呼び出すときにこの行をコマンドの出力に置き換えます。`allowed-tools`の規則により、このコマンドと、そのあとのエージェントの`agboard`コマンドは確認なしで実行できます。置き換えが働くのは単純なコマンドだけで、`$(...)`や複合コマンドは置き換わりません。コマンドの埋め込みがないエージェント（Codex）は、その次の文を読み、自分で`agboard skills`を実行します。`remote`と`wait`のSkillは、これまでどおりプラグイン内の静的なファイルです。プロジェクトの`.claude/skills/agent-board`はプラグインのSkillフォルダへのシンボリックリンクなので、このリポジトリ自身のClaude Codeのセッションも、同じ入口と`PATH`の`agboard`を使います。

## プラグインの自動更新

どちらのエージェントも、プラグインは、導入したタグのマーケットプレイスの写しとして持ちます。そのため新しい`agboard`にしても、古いプラグインはそのまま残ります。ビルドスクリプト（`build.rs`）は`plugins/agent-board/`のすべてのファイル（`.DS_Store`を除く）をハッシュし、ファイルの一覧とハッシュを埋め込みます（`src/plugin_hash.rs`、`src/setup/auto_update.rs`）。ハッシュは、各ファイルの相対パスと内容に対するFNV-1aです。マニフェストにはクレートの版が入っているので、リリースごとにハッシュが変わります。

SessionStartで、Hookは進行表を出したあと、エージェントが設定するルートの環境変数から導入済みのプラグインを見つけます（Claude Codeは`CLAUDE_PLUGIN_ROOT`、Codexは`PLUGIN_ROOT`で、なければ`CLAUDE_PLUGIN_ROOT`）。そこにある同じ相対パスのファイルをハッシュして比べます（エージェントが加えたファイルは無視し、足りないファイルは違いとみなします）。一致する、環境変数がない・空、ほかのHookイベント、`AGBOARD_NO_PLUGIN_AUTO_UPDATE`が`0`以外に設定されている、のいずれでも何もしません。違うときは`agboard update --agent <agent> --yes --background`を、切り離したプロセス（`setsid`、入出力なし）として始めるので、Hookは制限時間内に戻ります。そして`AGBOARD_NOTICE`を加えます。プラグインを`agboard`の版へ更新中で、次のセッションから有効になる、という内容です。フォルダが未登録のときは、この通知が出力のすべてになります。

バックグラウンドの実行は、そのエージェントについて`agboard update`と同じことをします。違いは次のとおりです。

- **ロック。** `<data>/plugin-update/<agent>.lock`を排他的に作ります（15分より古いロックは古いものとして置き換えます）。同時に開いたセッションは、有効なロックを見て何もしないので、プラグインの入れ直しは一度だけです。
- **記録。** `<data>/plugin-update/<agent>.json`（`hash`、`ok`、`at`、`version`）を、始めに`ok: false`で、終わりにもう一度書きます。同じハッシュについて、失敗または未完了の試行は6時間繰り返しません。そのあいだHookは、自動更新が完了しなかったので`agboard update`を実行するよう伝えます。終わったのにまだ違うプラグインが残る場合（チェックアウトからのビルド）は、24時間繰り返さず、何も言いません。
- **信頼。** Codexは信頼をhookの定義に結び付けており、定義はリリースをまたいで変わりません。入れ直しのあと、バックグラウンドの実行は`plugin list --json`でCodexがプラグインを入れたフォルダを調べ、導入済みの`hooks/codex.json`がこのバイナリに埋め込んだ定義とバイト単位で同一のときだけ、`agboard update --yes`と同じやり方（`trust.rs`）でAgent Boardのhookを信頼済みにします。導入先のフォルダが分からない、定義が違う（たとえば`--plugin-version`付きのhookからの一度きりの移行）、信頼に失敗した、のいずれでも何も信頼せず、試行を失敗として記録します。`agboard setup`で得た同意は、Agent Board自身のhookを信頼することを含みます。変わった定義や未知の定義は信頼せず、利用者が代わりに`agboard update`を実行します。通知がこれを伝えるのは、定義が変わったときだけです。
- **導入済みの写しだけ。** Hookが動くのは、プラグインのルートが`plugins/cache`フォルダの中にあるときだけです。エージェントはマーケットプレイスから入れたものをそこに置きます。チェックアウトや`--plugin-dir`の写しには何もしません。
- **タグの確認。** 既定の取得元では、エージェントのコマンドより前に`git ls-remote --exit-code --tags <repo> refs/tags/v<version>`を実行し（制限時間15秒）、終了コード0のときだけ続けます。タグがない（終了コード2。最後のリリースより進んだ開発ビルド）、ネットワークエラー、タイムアウト、`git`がない、のいずれでも止めて失敗として記録します。追加し直せないマーケットプレイスを消さないためです。次にいつ試すかは、再試行の間隔が決めます。
- **無言。** 何も出力せず、Hookは終わりを待ちません。

`AGBOARD_PLUGIN_MARKETPLACE`は、`agboard update`と同じく取得元を置き換えます。テストはこれと`tests/support/fake_agents.rs`の偽のエージェントを使います。利用者から見た動きは、[プラグインを更新する](../../guide/delegate/agents.md#update-the-plugin)を参照してください。

## setupとupdate

`agboard setup`と`agboard update`は`src/setup/`を共有し、`src/cli/commands/setup.rs`が両方を扱います。通常のストアの処理より前に分岐し、プロジェクトを必要とせず、共通のパス解決でデータ領域を一度だけ解決します。利用者から見た動きは、[エージェントを設定する](../../guide/delegate/agents.md#set-up-your-agents)と[setupとupdate](../../guide/reference/cli.md#setup-and-update)を参照してください。

実行は2つの段階に分かれます。

1. **準備（読み取りのみ）。** `prepare.rs`が、各エージェントのコマンドを`PATH`から探し、導入済みのプラグインを`plugin list --json`で読み（版と、一覧が導入先のフォルダを示すときは、そのファイルが同梱のプラグインと同じハッシュになるか）、`setup`のときは設定ファイルを読んで変更を計画します。コマンドがないエージェントは、理由を付けて飛ばします。`update`は、プラグインがないエージェントを飛ばします。使えない設定ファイルがあれば、何も書く前に実行全体を止めます。dry runはこの段階で終わるので、同じ検証を使います。`setup`は、プラグインがない、またはファイルが同梱のものと違うときに導入を計画し、そうでなければ飛ばします（フォルダが分からないときは版で判断します）。`update`は常に入れ直します。
2. **実行。** 利用者が同意したら、`execute.rs`が共有フォルダを作り、設定ファイルをすべて書くか、1つも書きません。続いて各エージェントのプラグインのコマンドを実行し、Codexではhookを信頼します。この段階での失敗は、そのエージェントだけを止めます。書き終えたファイルはそれだけで正しく、コマンドを実行し直せるので、そのまま残します。

各部分の役割は次のとおりです。

- **エージェントのコマンド。** `agent_cli.rs`は、`codex`と`claude`をシェルを使わずに`PATH`から探し、入力なしで時間制限を付けて実行し、出力を受け取ります。テストは偽のコマンドを`PATH`の先頭に置くので（`tests/support/fake_agents.rs`）、本物のエージェントやネットワークに触れることはありません。
- **プラグインの導入。** `plugin.rs`は、`https://github.com/FooQoo/agent-board.git`のタグ`v<version>`でマーケットプレイスを追加し、`codex plugin add agent-board@agent-board`、または`claude plugin install`と`claude plugin update`を実行します。マーケットプレイスがすでに別の取得元から追加されているとき（Codexは別の取得元から追加済みであることを、Claude Codeは失敗コード`declared`を報告します）は、マーケットプレイスを削除して追加し直します。どちらのエージェントでも、これがマーケットプレイスを新しいタグへ移す方法です。開発では、`AGBOARD_PLUGIN_MARKETPLACE`で取得元をローカルのチェックアウトなど別の場所に差し替えられます。
- **設定ファイル。** `plan.rs`、`codex.rs`、`claude.rs`が各ファイルの新しい内容を求めます。CodexのTOMLは`toml_edit`で編集し、コメント・ほかのキー・配列を保ちます。Claude CodeのJSONは未知のキーを保ちます。Codexには`sandbox_workspace_write.writable_roots`へのデータフォルダの追加と、ルールファイル`$CODEX_HOME/rules/agboard.rules`を、Claude Codeには`permissions.additionalDirectories`へのデータフォルダの追加を行います。`update`は設定ファイルを変えません。
- **書き込み。** `apply.rs`と`apply/files.rs`は、既存の各ファイルを同じフォルダの`<file>.agboard-backup…`に退避し、一時ファイルと名前の変更で置き換え、後の書き込みが失敗したときは、その実行が書いたものを戻します。計画の後に変わったファイルは上書きしません。シンボリックリンクは解決して実体のファイルを編集します。
- **hookの信頼。** `trust.rs`は`codex app-server`を起動し、`hooks/list`でhookの一覧を受け取り、Agent Boardの各hookの現在のハッシュを`config/value/write`で`hooks.state`に保存します。触れるのはこのプラグインのhookだけです。Codexは信頼をプラグインの内容に結び付けるので、導入や更新のたびにhookを信頼し直します。
- **報告。** `report.rs`が、各エージェントの結果を`updated`、`unchanged`、`planned`、`skipped`、`failed`のいずれかとして、テキストかJSONで示します。終了コードは、失敗したエージェントがあるとき、または`setup`が1つのエージェントも設定できなかったときに1です。

setupは、許可モードや管理設定を切り替えません。付与するアクセス権の範囲は、[セキュリティモデル](./security.md#エージェントのアクセス設定)の一部です。
