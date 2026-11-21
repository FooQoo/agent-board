import { useTranslation } from 'react-i18next';

/** The strings this mock adds. The shared locale files stay untouched. */
const ja = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  backlogHint: '計画です。Todo へ送るまで着手されません',
  todoHint: '送られた仕事。AI が着手します',
  laneEmpty: 'カードはありません',
  planMark: '計画',
  waveLabel: (n: number) => `ウェーブ ${n}`,
  standalone: 'エピックなし',
  openQuestion: '未回答の質問',
  allAchieved: '受入条件がすべて達成済み',
  sentMark: '送ったばかり',
  editedMark: '修正済み',
  selectCard: (id: number) => `#${id} を選ぶ`,
  selectedCount: (n: number) => `${n} 枚を選択中`,
  sendSelected: (n: number) => `選んだ ${n} 枚を Todo へ送る`,
  sendEpic: (n: number) => `エピック全体（${n} 枚）を Todo へ送る`,
  sendCard: 'Todo へ送る',
  viewPlan: '計画を読む',
  clearSelection: '選択を外す',
  edit: '編集',
  backToBacklog: 'Backlog へ戻す',
  // detail
  detailBacklogTitle: 'Backlog の計画です',
  detailBacklogBody:
    '読む・直す・保存するだけでは実行されません。実行を渡すのは「Todo へ送る」だけです。',
  detailTickNote:
    '受入条件のチェックは「達成した」の記録です。チェックしても Todo へは送られません。',
  detailTodoBanner: 'Todo に送られました。担当の AI が着手します。',
  // epic plan
  planTitle: (id: string) => `${id} の計画`,
  planGoal: '目的',
  planOrder: 'タスクの順序と受入条件',
  planConditions: '受入条件',
  planProgress: (b: number, t: number) => `Backlog ${b} 枚 ・ Todo ${t} 枚`,
  planReadOnlyNote: '受入条件のチェックは詳細で付けます。ここは文言を読むための画面です。',
  // edit
  editTitle: (id: number) => `#${id} の計画を直す`,
  editing: '編集中',
  editingNote: 'AI はこのカードを書き換えません。保存してもカードは Backlog のままです。',
  editName: 'タイトル',
  editBody: '計画の本文',
  editConditions: '受入条件の文言',
  editConditionsNote:
    '文言だけを直します。達成の記録（チェック）は詳細で付けるので、ここには出しません。',
  save: '保存',
  saving: '保存しました',
  savedNote: '保存しました。カードは Backlog のままです。着手はされません。',
  cancel: 'キャンセル',
  close: '閉じる',
  // send
  sendTitle: 'Todo へ送る',
  sendScopeCards: (n: number) => `選んだ ${n} 枚だけ送ります。残りは Backlog に残ります。`,
  sendScopeEpic: (e: string, n: number) =>
    `${e} の Backlog にある ${n} 枚をすべて送ります。計画が足りなければ、着手した AI が質問します。`,
  sendScopeOne: 'このカード 1 枚だけを送ります。',
  sendTargets: '送るカード',
  sendBefore: '操作前',
  sendAfter: '操作後',
  laneCount: (n: number) => `${n} 枚`,
  warnQuestionTitle: '未回答の質問が残っています',
  warnQuestionBody:
    '送っても質問は残り、AI は回答が付くまで実行中にできません。それでも送りますか。',
  warnQuestionAck: '質問が残っていることを確認しました',
  warnWaveTitle: '前のウェーブが Backlog のままです',
  warnWaveBody: (ids: string) =>
    `${ids} が Backlog にあるため、送ったカードは前のウェーブが終わるまで待ち続けます。`,
  warnAchievedTitle: '受入条件がすべて達成済みです',
  warnAchievedBody: '送ると、すぐ自動で Done になる可能性があります。',
  sendConfirm: 'Todo へ送る',
  sendNeedAck: '警告を確認してから送ってください',
  // result
  resultSent: (n: number) => `${n} 枚を Todo へ送りました`,
  resultCounts: (b0: number, b1: number, t0: number, t1: number) =>
    `Backlog ${b0} → ${b1} ・ Todo ${t0} → ${t1}`,
  resultUndo: 'Backlog へ戻す',
  resultSaved: (id: number) => `#${id} を保存しました。Backlog のままです`,
  dismiss: '閉じる',
  openWaiting: '回答待ちの質問があるカードです',
};

const en: typeof ja = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  backlogHint: 'Plans. Nothing starts until you send it to Todo',
  todoHint: 'Sent work. The AI picks it up',
  laneEmpty: 'No cards',
  planMark: 'Plan',
  waveLabel: (n) => `Wave ${n}`,
  standalone: 'No epic',
  openQuestion: 'Open question',
  allAchieved: 'All conditions achieved',
  sentMark: 'Just sent',
  editedMark: 'Edited',
  selectCard: (id) => `Select #${id}`,
  selectedCount: (n) => `${n} selected`,
  sendSelected: (n) => `Send ${n} selected to Todo`,
  sendEpic: (n) => `Send the whole epic (${n}) to Todo`,
  sendCard: 'Send to Todo',
  viewPlan: 'Read the plan',
  clearSelection: 'Clear selection',
  edit: 'Edit',
  backToBacklog: 'Move back to Backlog',
  detailBacklogTitle: 'This is a plan in Backlog',
  detailBacklogBody:
    'Reading, editing and saving do not run it. Only "Send to Todo" hands it over for work.',
  detailTickNote: 'Ticking a condition records it as achieved. It does not send the card to Todo.',
  detailTodoBanner: 'Sent to Todo. The assigned AI will start it.',
  planTitle: (id) => `Plan of ${id}`,
  planGoal: 'Goal',
  planOrder: 'Task order and acceptance conditions',
  planConditions: 'Acceptance conditions',
  planProgress: (b, t) => `${b} in Backlog, ${t} in Todo`,
  planReadOnlyNote: 'Tick conditions in the card detail. This view is for reading the wording.',
  editTitle: (id) => `Edit the plan of #${id}`,
  editing: 'Editing',
  editingNote: 'The AI does not rewrite this card meanwhile. Saving keeps it in Backlog.',
  editName: 'Title',
  editBody: 'Plan text',
  editConditions: 'Acceptance condition wording',
  editConditionsNote:
    'You are only changing the wording. Marking a condition achieved is done in the detail, so it is not shown here.',
  save: 'Save',
  saving: 'Saved',
  savedNote: 'Saved. The card is still in Backlog and will not start.',
  cancel: 'Cancel',
  close: 'Close',
  sendTitle: 'Send to Todo',
  sendScopeCards: (n) => `Only the ${n} selected cards are sent. The rest stay in Backlog.`,
  sendScopeEpic: (e, n) =>
    `All ${n} Backlog cards of ${e} are sent. If a plan is thin, the AI asks when it starts.`,
  sendScopeOne: 'Only this one card is sent.',
  sendTargets: 'Cards to send',
  sendBefore: 'Before',
  sendAfter: 'After',
  laneCount: (n) => `${n}`,
  warnQuestionTitle: 'Open questions remain',
  warnQuestionBody:
    'The questions stay after sending, and the AI cannot start the card until they are answered. Send anyway?',
  warnQuestionAck: 'I know the questions are still open',
  warnWaveTitle: 'An earlier wave is still in Backlog',
  warnWaveBody: (ids) =>
    `${ids} is in Backlog, so the sent cards keep waiting until the earlier wave is done.`,
  warnAchievedTitle: 'All conditions are already achieved',
  warnAchievedBody: 'After sending, the card may become Done automatically at once.',
  sendConfirm: 'Send to Todo',
  sendNeedAck: 'Confirm the warning to send',
  resultSent: (n) => `Sent ${n} card${n === 1 ? '' : 's'} to Todo`,
  resultCounts: (b0, b1, t0, t1) => `Backlog ${b0} → ${b1}, Todo ${t0} → ${t1}`,
  resultUndo: 'Move back to Backlog',
  resultSaved: (id) => `Saved #${id}. It stays in Backlog`,
  dismiss: 'Dismiss',
  openWaiting: 'This card has an open question',
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
