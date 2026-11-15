export const questionsJa = {
  questions: {
    band: {
      title: '未回答の質問',
      list: 'プロジェクトの未回答の質問',
      hint: '答えが揃うと、待っている AI が作業を進めます',
      held: '{{count}} 件に回答済み・まだ送っていません',
      answerAll: 'まとめて答える',
      resume: '続きから答える',
      review: '確認して送る',
      scrollBack: '前の質問を表示',
      scrollOn: '次の質問を表示',
      item: '{{title}}（{{tasks}}）',
      itemHeld: '{{title}}（{{tasks}}・回答済み・未送信）',
      noTask: 'タスクなし',
      heldMark: '回答済み・未送信',
      show: '未回答の質問を表示する（{{count}} 件）',
      hide: '未回答の質問を隠す（{{count}} 件）',
    },
    card: {
      waiting: '未回答の質問 {{count}} 件',
      waitingStart: '開始の承認待ち',
    },
  },
} as const;
