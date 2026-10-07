export const detailJa = {
  detail: {
    title: 'カードの詳細',
    selectPrompt: 'カードを選択すると詳細を表示します。',
    selectPromptState: 'カードを選択すると詳細が表示されます。',
    close: '詳細を閉じる',
    resize: 'カードの詳細の幅を変更',
    description: '説明',
    noDescription: '説明はありません。',
  },
  delete: {
    buttonLabel: 'カードを削除',
    confirm: '#{{id}}「{{title}}」を削除しますか？ この操作は元に戻せません。',
    submit: '削除',
    cancel: 'キャンセル',
    error: 'カードを削除できませんでした。もう一度お試しください。',
  },
  markdown: {
    noImage: 'No image',
  },
  history: {
    title: '履歴',
    created: '作成',
  },
} as const;
