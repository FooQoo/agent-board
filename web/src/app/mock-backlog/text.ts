import { useTranslation } from 'react-i18next';

/** The strings this mock adds. The shared locale files stay untouched. */
const ja = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  laneEmpty: 'カードはありません',
  openQuestion: '未回答の質問',
  sentMark: '送ったばかり',
  // selection mode
  selectEnter: 'まとめて選んで Todo へ送る',
  selectExit: '選択をやめる',
  selectCard: (id: number) => `#${id} を選ぶ`,
  selectedCount: (n: number) => `${n} 枚を選択中`,
  selectAll: 'すべて選ぶ',
  selectHint: '選んだカードをつかんで Todo へ動かせます',
  dropHere: 'ここにドロップして Todo へ送る',
  dragCount: (n: number) => `${n} 枚`,
  // phone confirm variants
  barSend: (n: number) => `Todo へ送る (${n})`,
  barCancel: 'やめる',
  sheetTitle: '移動先を選ぶ',
  sheetNote: (n: number) => `選んだ ${n} 枚の移動先`,
  sheetOnlyTodo: 'Backlog から動かせるのは Todo だけです',
  tabDragChip: (n: number) => `${n} 枚をつかんで Todo タブへ`,
  tabDragHint: '上のタブの Todo へドラッグして離すと送られます',
  // confirm
  sendTitle: 'Todo へ送る',
  sendScope: (n: number) => `選んだ ${n} 枚を Todo へ送ります。`,
  sendTargets: '送るカード',
  sendBefore: '操作前',
  sendAfter: '操作後',
  laneCount: (n: number) => `${n} 枚`,
  warnQuestionTitle: '未回答の質問が残っているカードがあります',
  warnQuestionBody:
    '送っても質問は残り、AI は回答が付くまで実行中にできません。それでも送りますか。',
  warnQuestionAck: '質問が残っていることを確認しました',
  sendConfirm: 'Todo へ送る',
  sendNeedAck: '確認してから送ってください',
  cancel: 'キャンセル',
  close: '閉じる',
  // result
  resultSent: (n: number) => `${n} 枚を Todo へ送りました`,
  resultCounts: (b0: number, b1: number, t0: number, t1: number) =>
    `Backlog ${b0} → ${b1} ・ Todo ${t0} → ${t1}`,
  resultUndo: 'Backlog へ戻す',
  dismiss: '閉じる',
};

const en: typeof ja = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  laneEmpty: 'No cards',
  openQuestion: 'Open question',
  sentMark: 'Just sent',
  selectEnter: 'Select several and send to Todo',
  selectExit: 'Stop selecting',
  selectCard: (id) => `Select #${id}`,
  selectedCount: (n) => `${n} selected`,
  selectAll: 'Select all',
  selectHint: 'Grab a selected card to move them all to Todo',
  dropHere: 'Drop here to send to Todo',
  dragCount: (n) => `${n}`,
  barSend: (n) => `Send to Todo (${n})`,
  barCancel: 'Cancel',
  sheetTitle: 'Choose where to move',
  sheetNote: (n) => `Destination of the ${n} selected`,
  sheetOnlyTodo: 'Only Todo can be reached from Backlog',
  tabDragChip: (n) => `Hold ${n} and drag to the Todo tab`,
  tabDragHint: 'Drag onto the Todo tab above and release to send',
  sendTitle: 'Send to Todo',
  sendScope: (n) => `The ${n} selected cards will be sent to Todo.`,
  sendTargets: 'Cards to send',
  sendBefore: 'Before',
  sendAfter: 'After',
  laneCount: (n) => `${n}`,
  warnQuestionTitle: 'Some cards still have open questions',
  warnQuestionBody:
    'The questions stay after sending, and the AI cannot start the card until they are answered. Send anyway?',
  warnQuestionAck: 'I know the questions are still open',
  sendConfirm: 'Send to Todo',
  sendNeedAck: 'Confirm to send',
  cancel: 'Cancel',
  close: 'Close',
  resultSent: (n) => `Sent ${n} card${n === 1 ? '' : 's'} to Todo`,
  resultCounts: (b0, b1, t0, t1) => `Backlog ${b0} → ${b1}, Todo ${t0} → ${t1}`,
  resultUndo: 'Move back to Backlog',
  dismiss: 'Dismiss',
};

export type MockText = typeof ja;

/** The mock's strings for the language of the Story. */
export function useMockText(): MockText {
  const { i18n } = useTranslation();
  return i18n.language.startsWith('ja') ? ja : en;
}

/** The language of the Story, for fixture text that differs by language. */
export function useIsJa(): boolean {
  const { i18n } = useTranslation();
  return i18n.language.startsWith('ja');
}
