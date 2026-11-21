import { useTranslation } from 'react-i18next';

/** The strings this mock adds. The shared locale files stay untouched. */
const ja = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  backlogHint: '確定した計画。Todo へ送るまで着手されません',
  todoHint: '送られた仕事。AI が着手します',
  laneEmpty: 'カードはありません',
  waveLabel: (n: number) => `ウェーブ ${n}`,
  standalone: 'エピックなし',
  openQuestion: '未回答の質問',
  allAchieved: '受入条件がすべて達成済み',
  sentMark: '送ったばかり',
  selectCard: (id: number) => `#${id} を選ぶ`,
  selectedCount: (n: number) => `${n} 枚を選択中`,
  sendSelected: (n: number) => `選んだ ${n} 枚を Todo へ送る`,
  sendEpic: (n: number) => `エピック全体（${n} 枚）を Todo へ送る`,
  sendCard: 'Todo へ送る',
  clearSelection: '選択を外す',
  backToBacklog: 'Backlog へ戻す',
  // detail
  notStartedMark: '着手前',
  detailBacklogTitle: '着手前の計画です',
  detailBacklogBody:
    '人が「Todo へ送る」まで着手されません。直したい点はチャットや依頼で AI に伝えます。',
  detailTodoBanner: 'Todo に送られました。担当の AI が着手します。',
  // epic plan
  // edit
  editConditionsNote:
    '文言だけを直します。達成の記録（チェック）は詳細で付けるので、ここには出しません。',
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
  dismiss: '閉じる',
  openWaiting: '回答待ちの質問があるカードです',
};

const en: typeof ja = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  backlogHint: 'Settled plans. Nothing starts until you send them to Todo',
  todoHint: 'Sent work. The AI picks it up',
  laneEmpty: 'No cards',
  waveLabel: (n) => `Wave ${n}`,
  standalone: 'No epic',
  openQuestion: 'Open question',
  allAchieved: 'All conditions achieved',
  sentMark: 'Just sent',
  selectCard: (id) => `Select #${id}`,
  selectedCount: (n) => `${n} selected`,
  sendSelected: (n) => `Send ${n} selected to Todo`,
  sendEpic: (n) => `Send the whole epic (${n}) to Todo`,
  sendCard: 'Send to Todo',
  clearSelection: 'Clear selection',
  backToBacklog: 'Move back to Backlog',
  notStartedMark: 'Not started',
  detailBacklogTitle: 'A settled plan, not started',
  detailBacklogBody:
    'Nothing starts until a person sends it to Todo. To change it, tell the AI in chat or in a request.',
  detailTodoBanner: 'Sent to Todo. The assigned AI will start it.',
  editConditionsNote:
    'You are only changing the wording. Marking a condition achieved is done in the detail, so it is not shown here.',
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
