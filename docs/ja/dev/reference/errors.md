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
| `attachment_not_found`・`evidence_not_found` | 画像や証跡のIDがない。 | 1 | 404 |
| `attachment_limit_exceeded` | 画像が大きすぎる、または添付先の画像件数や合計サイズが上限を超える。 | 1 | 422 |
| `attachment_request_conflict` | 要求IDが別の内容で再利用された。 | 1 | 409 |

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
| `wait_timeout` | 任意の`--timeout`に達しても変更がなかった。 | 1 | なし |
| `forbidden` | Webの書き込みが保護に失敗した（Host・Origin・`Sec-Fetch-Site`・トークン）。 | なし | 403 |

## 終了コード

| 終了コード | 意味 |
| --- | --- |
| 0 | 成功。 |
| 1 | 今の状態では操作が許されない、または何かが失敗した。 |
| 2 | 入力が誤っている。 |
| 3 | タスクが見つからない。 |
| 4 | プロジェクトが見つからない、またはフォルダが紐付いていない。 |

そのほかのHTTPステータス: 壊れたJSONは400、1 MiBを超える本文は413です。保護は対象を探す前に行うので、拒否された要求から何が存在するかは分かりません。
