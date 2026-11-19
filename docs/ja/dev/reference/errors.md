# エラーコード

すべてのエラーには、機械可読で安定した識別子`code`、一行の説明`message`、対処方法を示す`reason`があります。CLIはこれらを表示し（`--json`では`{"error": {...}}`）、対応する終了コードを返します。Web APIはHTTPステータス付きで返します。コードは`src/error.rs`で定義しています。

よくあるものの原因と対処は、[トラブルシューティング](../troubleshooting.md)にあります。

## タスクと状態

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `task_not_found` | タスクIDがプロジェクトにない。 | 3 | 404 |
| `task_archived` | アーカイブ済みのタスクへの書き込み。 | 1 | 409 |
| `task_not_archived` | アーカイブされていないタスクの削除や復元。 | 1 | 409 |
| `epic_is_draft` | CLIの`epic edit`、または`epic edit --priority`が人の下書きのエピックを対象にした。または、人の下書きのエピックを開始しようとした。 | 1 | 409 |
| `task_is_draft` | AIの`edit`・`history add`が人の下書き（`human`）を対象にした。またはAIの`mv`・`state`が下書きを対象にした。`reason`は、人の下書きでは「ユーザーが確定するのを待つ」、AIの下書きでは`agboard start`を案内します。 | 1 | 409 |
| `ai_draft_needs_start` | AIの下書きのタスクやエピックに、確定または`draft: null`を求めた。下書きを外せるのは開始だけ。 | 1 | 409 |
| `human_only` | エージェントが依頼を取り下げようとした。これを行えるのは人だけ。 | 1 | 403 |
| `task_not_draft` | 下書きでないタスクへのWebの編集。 | 1 | 409 |
| `task_is_done` | DoneのタスクへのAIの変更。 | 1 | 409 |
| `acceptance_unmet` | 条件が未達成、またはfrontmatterが不正なタスクを、AIがDoneへ移そうとした。 | 2 | なし |
| `invalid_state_for_column` | そのレーンで無効な稼働状態（例: TodoでRunning）。 | 1 | 422 |
| `invalid_state_for_assignee` | 人のタスクにIdle以外の稼働状態を設定した。 | 2 | 422 |
| `invalid_state_for_draft` | 稼働中のタスクを下書きにした。 | 1 | 409 |
| `archive_targets_changed` | 確認を開いた後に、一括アーカイブの対象が移動または削除された。 | 1 | 409 |

## 質問と回答

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `questions_unanswered` | 人の判断待ちのタスクを、エージェントがRunningにしようとした、またはDoneへ移そうとした。 | 1 | 409 |
| `question_answered` | 回答が、すでに回答済みの質問を指している。何も保存せず、記録済みの質問を出力に含める。 | 1 | 409 |
| `start_blocked_by_questions` | `start`または`epic start`を、返事のない質問が付いたタスク（エピックの開始では、そのエピックのAIの下書きのタスク）を開始しようとした。何も保存せず、メッセージに質問のIDを示す。 | 1 | 409 |
| `question_withdrawn` | 回答が、取り下げられた質問を指している。何も保存しない。 | 1 | 409 |
| `message_not_found` | 質問または依頼のIDがプロジェクトにない。 | 3 | 404 |
| `message_closed` | 取り下げようとしたものが、すでに回答のある質問、または受け付け済みの依頼である。 | 1 | 409 |
| `message_type_mismatch` | 一方の種類のためのコマンドやリクエストが、もう一方を指している。例: 依頼のIDに`answer`。 | 2 | 422 |
| `request_accepted` | 受け付けようとした依頼が、すでに受け付け済み。 | 1 | 409 |
| `answer_accepted` | 受け付けようとした質問の回答を、エージェントがすでに受け取っている。 | 1 | 409 |
| `question_open` | 受け付けようとした質問に、まだ回答がない。 | 1 | 409 |
| `request_withdrawn` | 受け付け、または2回目の取り下げが、取り下げ済みの依頼を指している。取り下げ済みの質問の受け付けは`question_withdrawn`。 | 1 | 409 |
| `ai_only` | 人が質問の取り下げ、質問の作成、依頼や回答の受け付けをしようとした。これらを行えるのはAIだけ。 | 1 | 403 |
| `choice_unknown` | 回答が、質問にない選択肢を指している。 | 2 | 422 |
| `task_status_changed` | 移動が元の状態（`fromStatus`）を指定したが、タスクがもうその状態にいない。何も書かず、本文に`currentStatus`を加える。 | 1 | 409 |

## プロジェクト・エピック・添付

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `project_not_found` | 名前やIDに合うプロジェクトがない。 | 4 | 404 |
| `project_name_exists` | 同じ名前のプロジェクトがある。 | 2 | 409 |
| `folder_unbound` | 作業フォルダがプロジェクトに紐付いていない。 | 4 | なし |
| `bound_project_missing` | フォルダに紐付いたプロジェクトがもうない。 | 4 | なし |
| `folder_bound_elsewhere` | フォルダがすでに別のプロジェクトのものになっている。 | 2 | なし |
| `epic_not_found` | EPIC-IDがない。 | 1 | 404 |
| `epic_id_taken` | 同じEPIC-IDのエピックがある。 | 1 | 409 |
| `epic_in_use` | まだタスクがエピックを参照している。 | 1 | 409 |
| `attachment_not_found` | 画像のIDがない。 | 1 | 404 |
| `attachment_limit_exceeded` | 画像が大きすぎる、または添付先の画像件数や合計サイズが上限を超える。 | 1 | 422 |

## 入力とファイル

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `invalid_argument` | コマンドの引数がない、または形式が誤っている（例: `message answer`での`--text`と`--text-file`の併用）。 | 2 | 422 |
| `invalid_value` | 値が規則（長さ、形式など）に違反している。 | 2 | 422 |
| `confirmation_required` | 削除に、端末での人のy/Nが必要。 | 1 | なし |
| `file_invalid` | 共有ファイルが壊れている、または形式に違反している。 | 1 | 422 |
| `format_unsupported` | 共有ファイルの`formatVersion`が1ではない。 | 1 | 500 |
| `file_unreadable` | 共有ファイルを読めない。 | 1 | 500 |
| `file_error` | 共有ファイルを書けない、またはジャーナルを復旧できない。 | 1 | 500 |
| `database_busy` | プロジェクトの書き込みロックが5秒以内に空かなかった。 | 1 | 503 |
| `database_error` | 読み書き中の予期しない失敗。 | 1 | 500 |

## サーバーと待機

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `already_serving` | このデータ領域で、すでに別の`serve`が動いている。自動で起動したサーバーなら、理由には動かし続けるための`agboard serve -d`を示す。 | 1 | なし |
| `port_in_use` | `serve`に指定したポートが使われている。理由には使っているものを示す。データ領域の違う別のAgent Boardのサーバー（pidつき）か、別のプログラム。自動のサーバーは代わりに別のポートを使う。 | 1 | なし |
| `local_network_denied` | OSやサンドボックスが、`agboard`が`127.0.0.1`で待ち受けることや接続することを拒んだ（`EACCES`か`EPERM`）。Codexでは`agboard setup`で`agboard`をサンドボックスの外で動かせるようにする。 | 1 | なし |
| `board_unavailable` | 回答を待つ`message ask`、`message wait`、`wait`、`open`、Hookがサーバーに届かない。自動起動が無効（`AGBOARD_AUTOSTART=0`）、サーバーを起動できない（理由に`serve.log`を示す）、`serve.json`のサーバーが応えない、接続に失敗した、のどれか。回答を待つ`message ask`は保存前にサーバーを確認するため、利用できない場合は質問を保存しない。`--no-wait`ならサーバーは不要。 | 1 | なし |
| `remote_unavailable` | `remote`が報告できる、準備のできたngrok接続がない。サーバーが動いていないか、接続が`ready`ではない（無効、開始中、再接続中、失敗など）。理由にどちらかを示し、接続が失敗したときは失敗コードも示す。何も起動せず、アドレスと合言葉は出力しない。 | 1 | なし |
| `browser_open_failed` | `open`が、ブラウザーを開くプログラム（`open`、`xdg-open`、`AGBOARD_BROWSER_OPENER`）を起動できなかった。理由に、手で開くアドレスを示す。ブラウザーを開いてはいけないとき（`AGBOARD_OPEN_BROWSER=0`、SSH、画面がない）はエラーではない。 | 1 | なし |
| `agent_cli_missing` | `claude`または`codex`がサーバーの`PATH`にない（または`AGBOARD_CLAUDE_BIN`・`AGBOARD_CODEX_BIN`がファイルを指していない）ため、ボードがセッションを起動できない。 | 1 | 409 |
| `agent_cli_logged_out` | エージェントのCLIはあるが、ログインしていない（`claude auth status`の`loggedIn`がfalse、または`codex login status`が失敗）。理由に、ターミナルでログインするよう示す。 | 1 | 409 |
| `session_launch_refused` | どちらかのツールのセッションをボードがすでに起動していて、動いている、再起動を待っている、または張り付いている。ボードが起動するセッションは、2つのツールと全プロジェクトを通して全体で1つまで。理由に、そのツールを示し、先に止めるよう示す。 | 1 | 409 |
| `session_launch_failed` | エージェントのCLIを起動できなかった、ログファイルに書けなかった、またはログインの確認が20秒以内に終わらなかった。 | 1 | 500 |
| `project_has_no_folder` | プロジェクトに、存在する結び付いたフォルダがないため、セッションを起動できない。`agboard project bind`で結び付ける。 | 1 | 409 |
| `cursor_invalid` | cursorの形式が誤っている、または別のプロジェクトのもの。 | 1 | なし |
| `wait_timeout` | 変更待ち（`wait --after`）が、変更のないまま任意の`--timeout`に達した。`message ask`や`message wait`が`--timeout`に達するのはエラーではなく、`timeout`イベントを出して終了コード5で終わる。 | 1 | なし |
| `hook_cwd_unavailable` | Hookの入力の`cwd`が、存在しない、または読めない絶対パス。`AGBOARD_ERROR`として返す。確認できないフォルダを未登録とは扱わない。 | なし（Hookの出力） | なし |
| `invalid_hook_input` | Hookの入力がJSONでない、大きすぎる、または`cwd`が文字列でない、絶対パスでない。`AGBOARD_ERROR`として返す。 | なし（Hookの出力） | なし |
| `forbidden` | Webの書き込みが保護に失敗した（Host・Origin・`Sec-Fetch-Site`・トークン）。 | なし | 403 |
| `invalid_sections` | Detail経路の`sections`クエリが`document`・`history`・`document,history`のいずれでもない。[Web API](./web-api.md#summaryとdetail)を参照。 | なし | 400 |
| `not_implemented` | SummaryまたはDetailの経路はあるが、ハンドラーがまだ書かれていない。 | なし | 501 |

## リモート接続

`/api/monitor-connections`の経路（[Web API](./web-api.md#リモート接続)を参照）が返すコードです。秘密の値は含みません。

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `revision_conflict` | ページが読んだあとに設定が変わった。 | なし | 409 |
| `save_failed` | 設定を保存できなかった。何も変わらず、何も開始していない。 | なし | 500 |
| `token_required` | 開始したが、要求・環境変数・安全な保管場所のいずれにもトークンがなかった。 | なし | 422 |
| `keychain_unavailable` | トークンの保存か削除を求められたが、このPCの安全な保管場所では行えない。何も保存・変更していない。 | なし | 409 |
| `settings_unreadable` | 保存した設定ファイルを読めないまま開始した。先に設定を保存し直す。 | なし | 409 |
| `start_failed` | 内部の理由で接続を開始できなかった。 | なし | 500 |
| `device_not_found` | 登録解除する端末のidが登録されていない（すでに削除されたなど）。 | なし | 404 |
| `invalid_domain` | 設定のドメインがホスト名だけではない（スキーム、パス、ポート、ワイルドカードが含まれる）。何も保存していない。 | なし | 422 |
| `invalid_value` | トークン・本文が規則に反する（例: トークンなしの`save`、未知のフィールド）。 | なし | 422 |

コマンドラインでは、`serve --monitor ngrok`のオプションが足りない、または不正な場合は`invalid_argument`で終了コード2、接続を開始できない場合は終了コード1です。状態の`failure`のコードは[Web API](./web-api.md#リモート接続)に一覧があります。

ngrokの入口では、Hostの確認に失敗した要求は理由`not available`の403 `forbidden`、sessionがない・期限切れなら401 `session_required`、公開Origin・同一オリジンのメタデータ・CSRFトークンのない書き込みは403 `forbidden`です。`POST /api/remote/unlock`は、間違った合言葉に403 `unlock_failed`を返し、連続5回間違えたあとはすべての試行に429 `unlock_locked`を返します。どちらも残りの回数は示しません。

## プロジェクトのドキュメント

`/api/projects/{projectId}/docs/…`のルートが返します（[Web API](./web-api.md#プロジェクトのドキュメント)を参照）。CLIのエラーではないため、終了コードはありません。

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `docs_path_invalid` | パスが空、絶対パス、長すぎる（全体で1,024バイト、1つの要素で255バイト）、17要素より深い、または空の要素・ドットで始まる要素（`..`など）・バックスラッシュ・制御文字を含む。あるいは、途中のファイルやフォルダがシンボリックリンク。どれに当たるかは`reason`に出る。 | なし | 400 |
| `docs_not_found` | `docs/`の下にそのファイルがない、またはパスがフォルダを指す。 | なし | 404 |
| `docs_not_markdown` | ファイルのルートに、`.md`または`.mdx`で終わらない名前を渡した。 | なし | 415 |
| `docs_asset_type` | 画像のルートに、PNG・JPEG・WebP・GIF・AVIF・SVG以外を渡した。 | なし | 415 |
| `docs_open_failed` | 開くルートが`docs/`またはファイルを開けなかった。フォルダがない、またはプログラムを起動できない。どちらかは`reason`に出る。 | なし | 500 |
| `docs_too_large` | 2 MiBを超えるファイル、または10 MiBを超える画像。 | なし | 413 |
| `docs_not_utf8` | ファイルが正しいUTF-8のテキストでない。ファイルは変更しない。 | なし | 422 |

## 表示設定

`/api/preferences`の経路が返します（[Web API](./web-api.md#表示設定)を参照）。CLIのエラーではないため、終了コードはありません。読めないファイルはエラーにならず、既定値を使います。

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `invalid_preferences` | 本文に未知の項目、許可されない値、`locale`も`theme`もないものがある。何も保存しない。 | なし | 422 |
| `preferences_unavailable` | 表示設定のファイルに書けなかった。保存済みの値は変わらない。 | なし | 500 |


## 終了コード

| 終了コード | 意味 |
| --- | --- |
| 0 | 成功。 |
| 1 | 今の状態では操作が許されない、または何かが失敗した。 |
| 2 | 入力が誤っている。 |
| 3 | タスク・質問・依頼が見つからない。 |
| 4 | プロジェクトが見つからない、またはフォルダが紐付いていない。 |
| 5 | `message ask`や`message wait`が、すべての質問に回答が付く前に`--timeout`に達した。質問は未回答のまま残る。 |
| 6 | `message ask`や`message wait`がまだ待っていた質問が、すべて取り下げられた。 |

そのほかのHTTPステータス: 壊れたJSONは400、1 MiBを超える本文は413です。保護は対象を探す前に行うので、拒否された要求から何が存在するかは分かりません。

`setup`と`update`は、結果を自分で表示し、独自の終了コードを使います。成功、何もすることがない、取り消しが0、失敗したエージェントがある、または`setup`が1つのエージェントも設定できなかったが1、コマンドラインが不正、またはターミナルがない（か`--json`を付けた）のに必要な`--agent`、`--yes`、`--dry-run`がないが2です。グローバルの`--json`を付けると、結果は各エージェントの`status`と`reason`を持つJSONになります。エージェントの失敗の理由は、たとえば`The codex command was not found on PATH`のような文で、飛ばしたエージェントの理由も同じ項目に入ります。読めるフォルダに紐付けがないHookは、エラーではありません。何も出力せず、終了コード0で終わります。[setupとupdate](../concepts/agents.md#setupとupdate)を参照してください。

タスク待ちモード（`wait --until task --idle-timeout <seconds>`）では、idle期限まで対象タスクが現れないと、成功結果の`kind: "idle_timeout"`を出力して終了コード0を返します。対象タスクを取得した場合も終了コード0です。引数誤りは2、プロジェクトがない場合は4、起動できないサーバー・不整合な応答・不正なボードデータ・ストリーム障害は`board_unavailable`で1です。これらは対象なしの正常終了ではありません。idle秒数は必須で1〜86,400です。
