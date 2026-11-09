import type { Task } from '../../../shared/api/contracts.ts';

/**
 * The Japanese text of the sample boards (`boards.ts`), for a board that starts in Japanese: the
 * browser demo on a Japanese browser. The cards keep their IDs, lanes and states; only the words
 * change. Card text is keyed by card ID, history by its English reason, and choices and
 * conditions by their IDs, so the English fixture stays the one source of the board's shape.
 */

interface CardText {
  title: string;
  /** The description and the body of the card. */
  body: string;
}

const CARDS: Record<number, CardText> = {
  8: { title: 'ボードを初期化する', body: 'agboard init でボードの保存先を作る。' },
  9: {
    title: 'タスク一覧を JSON で返す',
    body: 'エージェントが読めるよう、タスクを JSON で出力する。',
  },
  11: { title: 'タスクの移動を実装する', body: 'タスクを別のレーンへ移し、その移動を記録する。' },
  12: { title: 'JSON からボードを復元する', body: '' },
  13: {
    title: 'ボードの表示を確認する',
    body: '1280、800、480 px の幅でレイアウトを確認する。\n横スクロールが出ないかを見る。',
  },
  14: { title: 'Windows 版をビルドする', body: 'Windows x64 向けに Agent Board をビルドする。' },
  15: { title: 'セットアップガイドを書く', body: '' },
  16: { title: '空のボードの見た目を整える', body: '' },
};

const HISTORY: Record<string, string> = {
  'Created task in Todo.': 'タスクをTodoに作成しました。',
  'Moved task from Todo to Doing.': 'タスクをTodoからDoingに移動しました。',
  'Moved task from Doing to Done.': 'タスクをDoingからDoneに移動しました。',
  'Working on this task': 'このタスクに取り組んでいます',
  'Waiting for confirmation on how to replace a board.':
    'ボードを置き換える方法の確認を待っています。',
};

const PENDING_REASONS: Record<number, string> = {
  11: 'タスクを移動する順番について、判断を待っています。',
  12: 'ボードを置き換える方法の確認を待っています。',
  13: 'どの画面を確認するか、確認を待っています。',
};

const CHOICES: Record<string, string> = {
  keep: 'データを残す',
  reset: '最初からやり直す',
  fifo: '移動した順のままにする',
  priority: '優先度で並べ替える',
  board: 'ボードの画面',
  archive: 'アーカイブの画面',
};

const CONDITIONS: Record<number, Record<string, string>> = {
  11: {
    'AC-1': 'タスクがレーン間を移動する',
    'AC-2': '移動するたびに状態の変更を確認する',
    'AC-3': '履歴に理由が残る',
    'AC-4': '待機中のタスクは idle に戻る',
  },
  12: {
    'AC-1': 'ボードに復元の結果が表示される',
    'AC-2': 'アーカイブがレーンを保つ',
  },
};

/** The name of the sample epic in Japanese. */
export const JA_EPIC_NAME = 'ファイル共有';

/** The title of the card with a long Markdown description. */
export const JA_LONG_MARKDOWN_TITLE = '長い Markdown の説明';

/** The long Markdown description in Japanese, with the same kinds of parts as the English one. */
export const JA_LONG_MARKDOWN = `ボードを用意するための計画です。1 行の改行は
そのまま改行として表示されます。

## 目的
\`agboard init\` でボードの保存先を作る。保存先がすでにあれば、何も変えない。

### メモ
H2 より下の見出しは、そのセクションの中に入る。

## 受入条件
- [x] 新しいデータ領域にボードを作れる
- [x] 既存のボードは変わらない
- [ ] 保存先に書き込めないときはエラーになる
  - [ ] メッセージにパスが含まれる

## 手順
1. 保存先があるかを確かめる
2. なければボードを作る
3. 結果を表示する

## 確認
| 場面 | 期待する結果 | AC |
|---|---|---|
| 初回の実行 | ボードが作られ、スクロールが必要なほど長い説明のメッセージを出してコマンドが終わる | AC-1 |
| 2 回目の実行 | 何も変わらない | AC-2 |

\`\`\`sh
AGBOARD_HOME=$(mktemp -d) agboard init --name a-very-long-board-name-that-does-not-wrap --description "long line"
\`\`\`

> レビューでのコメントの引用。

~~取り下げ~~ と **強調** の例。
`;

/** A sample card with its words in Japanese. Text with no translation is kept as it is. */
export function japaneseCard(task: Task): Task {
  const card = CARDS[task.id];
  const conditions = CONDITIONS[task.id];
  const pendingReason = PENDING_REASONS[task.id];
  return {
    ...task,
    ...(card ? { title: card.title, description: card.body } : {}),
    ...(card && !task.acceptanceError ? { body: card.body } : {}),
    history: task.history.map((entry) => ({
      ...entry,
      reason: HISTORY[entry.reason] ?? entry.reason,
    })),
    pendingReason: task.pendingReason && pendingReason ? pendingReason : task.pendingReason,
    pendingChoices: task.pendingChoices.map((choice) => ({
      ...choice,
      label: CHOICES[choice.id] ?? choice.label,
    })),
    acceptance: task.acceptance.map((condition) => ({
      ...condition,
      text: conditions?.[condition.id] ?? condition.text,
    })),
    epic: task.epic ? { ...task.epic, name: JA_EPIC_NAME } : task.epic,
  };
}
