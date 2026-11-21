# トラブルシューティング

当てはまる症状を探し、原因と対処を確認してください。エラーコードは[エラーコード](./reference/errors.md)に一覧があります。

## コマンドが失敗する

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `database_busy` | ほかのコマンドかサーバーが、プロジェクトの書き込みロックを5秒を超えて保持した。 | コマンドをもう一度実行します。続くなら、ロックを保持しているプロセスを探します。[保存と復旧](./concepts/saving-and-recovery.md#ロック)を参照。 |
| `task_is_draft` | タスクが人の下書きで、エージェントは変更できず、送信も断られる。 | 人にWeb画面で下書きを確定してもらい、その間はほかのタスクを進めます。`TASK.md`は編集しません。 |
| `task_in_backlog` | タスクがバックログにあり、エージェントは動かすことも実行することもできない。 | そのままにします。未着手へ送れるのは人だけです（`agboard send <id> --actor human`）。ほかのタスクを進めます。 |
| `send_with_open_questions` | 計画に未回答の質問があるため、人の送信を断った。 | 示された質問に答えるか、`--force`（CLI）または`ack: true`（API）で確認して送ります。 |
| `epic_is_draft` | エピックが下書きで、CLIはその詳細や作業順序を変更できない。 | 人が保存か破棄をするまで待つか、確定を頼みます。`epic attachment`と所属の変更は使えます。`EPIC.md`は編集しません。 |
| `task_is_done` | タスクがDoneで、エージェントは変更できない。 | 人に再開してもらいます。 |
| `acceptance_unmet` | 完了条件が未達成、またはfrontmatterが不正なタスクを、エージェントがDoneへ移そうとした。 | 条件を検証して`done: true`にするか（サーバーが自動で移します）、frontmatterを直します。 |
| `questions_unanswered` | 人の判断待ちのタスクを、エージェントがRunningにしようとした、またはDoneへ移そうとした。 | `message wait <question-id>`で回答を待つか、人にボードで回答してもらいます。 |
| `question_answered`・`question_withdrawn` | 質問にすでに回答がある、または取り下げられた。最初の回答が確定です。 | 質問を読み直し（`message show <question-id>`）、記録済みの回答に従います。 |
| `start_blocked_by_questions` | 互換性のために残しているコード。`send`はもう返しません。 | 上の`send_with_open_questions`を使います。 |
| `folder_unbound`・`bound_project_missing` | 作業フォルダがプロジェクトに紐付いていない、またはプロジェクトが削除された。 | `--project`でプロジェクトを明示するか、利用者にフォルダの紐付けを頼みます。 |
| `confirmation_required` | 削除に、端末での人のy/Nが必要。 | 人に実行してもらいます。確認を省くオプションはありません。 |

## ボードの表示が想定と違う

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| タスクがボードになく、`problems`に`task.json`が載る | ファイルが壊れている、`formatVersion`が1でない、または未知の項目がある。 | `problems`の項目を読みます。ファイル・項目・理由が書かれています。ファイルを手で直してください。Agent Boardによる自動修正は行いません。[ファイルに不備があるとき](./concepts/saving-and-recovery.md#ファイルに不備があるとき)を参照。 |
| 本文に警告が出て、条件が空になる | `TASK.md`のfrontmatterが正しいYAMLでない。 | frontmatterを直します。その間も本文は表示されます。 |
| CLIで変更しても画面が更新されない | `serve`が動いていない、通知が失われた、または共有領域がネットワークドライブにある。 | ページを再読み込みします。変更はOSのイベントでも検知しますが、ネットワークドライブではイベントが届かないことがあります。[変更の通知](./concepts/notifications.md)を参照。 |
| エージェントが異常終了した後もタスクがRunningのまま | Runningは自己申告で、自動で戻すものはない。 | タスクを移動するか、`state`で状態を自分で設定します。 |
| ボードに「切断」と出る | SSEの接続が切れた。 | ブラウザが自動で再接続し、ボードを読み直します。 |

## サーバーと待機

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `already_serving` | 同じデータ領域で別の`serve`が動いている。 | そちらを使うか、先に止めます。自動で起動したサーバーなら、`agboard serve -d`で動かし続けられます。 |
| `port_in_use` | `serve`に指定したポートが使われている。理由に、別のAgent Boardのサーバーか別のプログラムかが出る。 | `--port`でほかのポートを選びます。7420は通常の利用のために空けておき、テストでは別のポートかポート0を使います。 |
| `local_network_denied` | OSやサンドボックスが、`agboard`に`127.0.0.1`を使わせない。 | Codexでは`agboard setup`を実行します。それ以外では、サンドボックスの外でコマンドを実行します。 |
| `wait`・`message ask`・`message wait`・Hookの`board_unavailable` | 自動起動が無効、サーバーを起動できない、`serve.json`のサーバーが応えない、接続に失敗した、のどれか。技術的な失敗で、回答ではない。 | 理由を読みます。`serve.log`が示されていればそのファイルを、pidが示されていれば`agboard stop`を実行します。そのうえで`wait`を実行し直します。保存済みの質問は`message wait <question-id>`で待ち直します。 |
| テストが7420でサーバーを起動する | テストが`AGBOARD_AUTOSTART=0`を付けずに`agboard`を実行している。 | `AGBOARD_AUTOSTART=0`を付けます。自動起動そのものの試験では`AGBOARD_AUTOSTART_PORT=0`を付けます。 |
| テストがブラウザーのウィンドウを開く | 自動起動を有効にしたまま、`AGBOARD_OPEN_BROWSER=0`を付けずに`agboard`を実行している。 | `AGBOARD_OPEN_BROWSER=0`を付けます。開く処理の試験では、代わりに`AGBOARD_BROWSER_OPENER`をアドレスを記録するスクリプトに向けます。 |
| 自動のサーバーがボードを開かなかった | 待つ時間のうちにボードのページがつながった、または開く処理が無効になっている。 | `serve.log`を読みます。`Opened …`、理由つきの`Did not open …`、`Could not open …`のどれかが書かれています。[ボードを開く](./concepts/server-and-ui.md#opening-the-board)を参照。 |
| 常駐エージェントが止まったが理由がわからない | 人の停止、再起動、モデルの変更、サーバーの終了、一度もつながらなかったセッションをボードが終わらせた、クラッシュのどれか。 | `serve.log`を読みます（バックグラウンドのサーバーの場合。フォアグラウンドのサーバーは同じ行を端末に表示します）。起動・停止の要求・終了ごとに、時刻（UTC）、ツール、起動ID、理由が1行で残っています。`exited abnormally`はクラッシュで、`ended after a stop`は直前の`stop requested`の行に続きます。直近5回の起動分のエージェントの出力は`resident/<ツール>.log`と`resident/<ツール>.1.log`〜`.4.log`にあります。 |
| `cursor_invalid` | cursorの形式が誤っている、または別のプロジェクトのもの。 | 同じプロジェクトの`snapshot`から新しい`cursor`を取ります。 |
| `wait_timeout` | `wait --after`の任意の`--timeout`が経過しても変更がなかった。 | もう一度待ちます。 |
| `message ask`や`message wait`が終了コード5で終わる | すべての質問に回答が付く前に`--timeout`が過ぎた。質問は未回答のまま残る。 | `message wait <question-id>`をもう一度実行します。 |

## Hook

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `context_too_large`の`AGBOARD_ERROR` | 進行表が256 KiBを超える。 | 完了したタスクを整理したり作業を分割したりして、進行表のサイズを減らします。有効な表を取得できるまで、ボードに依存する変更はしません。 |
| `folder_unbound`の`AGBOARD_ERROR` | フォルダが紐付いていない。 | フォルダをプロジェクトに紐付けるか、プロジェクトを明示します。 |
| Hookが動かない | Hookが登録されていない、または`agboard`が`PATH`にない。 | [エージェントを設定する](../guide/delegate/agents.md#set-up-your-agents)を見て、`command -v agboard`を確かめます。 |

## ビルドとテスト

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `cargo build`が`Run "pnpm --dir web build" first.`で止まる | RustのビルドはWeb画面を埋め込むが、画面がビルドされていない。 | `pnpm --dir web install`と`pnpm --dir web build`を実行してから、もう一度ビルドします。 |
| 変更がHook経由で反映されない | Hookは作業ツリーではなく、インストール済みの`agboard`を実行する。 | `cargo install --path . --locked --force`で入れ直します。[開発環境のセットアップ](./getting-started/setup.md#ソースからインストール)を参照。 |
| テストがポート7420を使った、または自分のボードに触れた | テストが既定のポートやデータ領域を使った。 | テストは`AGBOARD_HOME`を一時ディレクトリにし、空いているポートかポート0を使います。 |
| テストの時刻がマシンごとに違う | タイムゾーンが固定されていない。 | `TZ=UTC`でテストを実行します。 |
| `pnpm --dir docs build`がリンク切れを報告する | ページが移動した、または見出しが変わった。 | リンクを直します。リンク切れがあるとビルドは失敗します。 |
