# エラーコード

すべてのエラーには、機械可読で安定した識別子`code`、一行の説明`message`、対処方法を示す`reason`があります。CLIはこれらを表示し（`--json`では`{"error": {...}}`）、対応する終了コードを返します。Web APIはHTTPステータス付きで返します。コードは`src/error.rs`で定義しています。

よくあるものの原因と対処は、[トラブルシューティング](../troubleshooting.md)にあります。

## タスクと状態

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `task_not_found` | タスクIDがプロジェクトにない。 | 3 | 404 |
| `task_archived` | アーカイブ済みのタスクへの書き込み。 | 1 | 409 |
| `task_not_archived` | アーカイブされていないタスクの削除や復元。 | 1 | 409 |
| `task_is_draft` | 下書きへのAIの書き込み（`edit`・`mv`・`state`・`history add`）。 | 1 | 409 |
| `task_not_draft` | 下書きでないタスクへのWebの編集。 | 1 | 409 |
| `task_is_done` | DoneのタスクへのAIの変更。 | 1 | 409 |
| `acceptance_unmet` | 条件が未達成、またはfrontmatterが不正なタスクを、AIがDoneへ移そうとした。 | 2 | なし |
| `invalid_state_for_column` | そのレーンで無効な稼働状態（例: TodoでRunning）。 | 1 | 422 |
| `invalid_state_for_assignee` | 人のタスクにIdle以外の稼働状態を設定した。 | 2 | 422 |
| `invalid_state_for_draft` | 稼働中のタスクを下書きにした。 | 1 | 409 |
| `archive_targets_changed` | 確認を開いた後に、一括アーカイブの対象が移動または削除された。 | 1 | 409 |

## 判断依頼

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `request_changed` | 回答対象の依頼が、すでに現在の依頼ではない。 | 1 | 409 |
| `request_choice_unknown` | 回答が、依頼にない選択肢を指している。 | 2 | 422 |

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
| `invalid_argument` | コマンドの引数がない、または形式が誤っている。 | 2 | 422 |
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
| `already_serving` | このデータ領域で、すでに別の`serve`が動いている。 | 1 | なし |
| `port_in_use` | ポートが使われている。 | 1 | なし |
| `board_unavailable` | `wait`やHookがサーバーに届かない。 | 1 | なし |
| `cursor_invalid` | cursorの形式が誤っている、または別のプロジェクトのもの。 | 1 | なし |
| `wait_timeout` | 変更待ちモード（`wait --after`）で任意の`--timeout`に達しても変更がなかった。Pendingへの回答ではない。 | 1 | なし |
| `forbidden` | Webの書き込みが保護に失敗した（Host・Origin・`Sec-Fetch-Site`・トークン）。 | なし | 403 |

## モバイル接続

`/api/monitor-connections`の経路（[Web API](./web-api.md#モバイル接続)を参照）が返すコードです。秘密の値は含みません。

| コード | 発生する場面 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `revision_conflict` | ページが読んだあとに設定が変わった。 | なし | 409 |
| `save_failed` | 設定を保存できなかった。何も変わらず、何も開始していない。 | なし | 500 |
| `token_required` | 開始したが、要求・環境変数・安全な保管場所のいずれにもトークンがなかった。 | なし | 422 |
| `keychain_unavailable` | トークンの保存か削除を求められたが、このPCの安全な保管場所では行えない。何も保存・変更していない。 | なし | 409 |
| `settings_unreadable` | 保存した設定ファイルを読めないまま開始した。先に設定を保存し直す。 | なし | 409 |
| `start_failed` | 内部の理由で接続を開始できなかった。 | なし | 500 |
| `invalid_value` | トークン・本文が規則に反する（例: トークンなしの`save`、未知のフィールド）。 | なし | 422 |

コマンドラインでは、`serve --monitor ngrok`のオプションが足りない、または不正な場合は`invalid_argument`で終了コード2、接続を開始できない場合は終了コード1です。状態の`failure`のコードは[Web API](./web-api.md#モバイル接続)に一覧があります。

モニターの入口では、Hostの確認に失敗した要求は理由`not available`の403 `forbidden`、sessionがない・期限切れなら401 `session_required`、公開Origin・同一オリジンのメタデータ・CSRFトークンのない書き込みは403 `forbidden`です。`POST /monitor/api/unlock`は、間違った合言葉に403 `unlock_failed`を返し、連続5回間違えたあとはすべての試行に429 `unlock_locked`を返します。どちらも残りの回数は示しません。

## 表示設定

`/api/preferences`と`/monitor/api/preferences`の経路が返します（[Web API](./web-api.md#表示設定)を参照）。CLIのエラーではないため、終了コードはありません。読めないファイルはエラーにならず、既定値を使います。

| コード | 発生条件 | 終了コード | HTTP |
| --- | --- | --- | --- |
| `invalid_preferences` | 本文に未知の項目、許可されない値、`locale`も`theme`もないものがある。何も保存しない。 | なし | 422 |
| `preferences_unavailable` | 表示設定のファイルに書けなかった。保存済みの値は変わらない。 | なし | 500 |

## 初回の案内

- `onboarding_conflict`（409）: タブが読んだあとに案内が変わった、ほかのタブがリースを持っている、または run が現在の run でない。状態を読み直し、現在のリビジョンで手順をやり直す。
- `onboarding_invalid`（422）: 手順が現在の段階に続かない。回答が保存される前に再開する場合など。

## 終了コード

| 終了コード | 意味 |
| --- | --- |
| 0 | 成功。 |
| 1 | 今の状態では操作が許されない、または何かが失敗した。 |
| 2 | 入力が誤っている。 |
| 3 | タスクが見つからない。 |
| 4 | プロジェクトが見つからない、またはフォルダが紐付いていない。 |

そのほかのHTTPステータス: 壊れたJSONは400、1 MiBを超える本文は413です。保護は対象を探す前に行うので、拒否された要求から何が存在するかは分かりません。

タスク待ちモード（`wait --until task --idle-timeout <seconds>`）では、idle期限まで対象タスクが現れないと、成功結果の`kind: "idle_timeout"`を出力して終了コード0を返します。対象タスクを取得した場合も終了コード0です。引数誤りは2、プロジェクトがない場合は4、サーバー停止・不整合な応答・不正なボードデータ・ストリーム障害は`board_unavailable`で1です。これらは対象なしの正常終了ではありません。idle秒数は必須で1〜86,400です。
