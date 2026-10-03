export const resources = {
  en: {
    translation: {
      language: {
        label: 'Language',
        english: 'English',
        japanese: '日本語',
      },
      column: {
        todo: 'Todo',
        doing: 'Doing',
        done: 'Done',
      },
      runState: {
        idle: 'Idle',
        running: 'Running',
        pending: 'Pending',
      },
      board: {
        loading: 'Loading…',
        loadError: 'Could not load the board.',
        retry: 'Retry',
        empty: 'No cards yet.',
        emptyHint: 'Agents add cards with "skan add <title>".',
      },
      card: {
        updated: 'Updated {{date}}',
      },
      detail: {
        title: 'Card details',
        selectPrompt: 'Select a card to see its details.',
        close: 'Close details',
        description: 'Description',
        noDescription: 'No description.',
      },
      delete: {
        buttonLabel: 'Delete card',
        confirm: 'Delete #{{id}} "{{title}}"? This cannot be undone.',
        submit: 'Delete',
        cancel: 'Cancel',
        error: 'Could not delete the card. Try again.',
      },
      history: {
        title: 'History',
        created: 'Created',
      },
      status: {
        cardCount_one: '{{count}} card',
        cardCount_other: '{{count}} cards',
        connecting: 'Connecting…',
        notConnected: 'Not connected',
        synced: 'Synced {{time}}',
        disconnected: 'Disconnected · Last synced {{time}}',
      },
    },
  },
  ja: {
    translation: {
      language: {
        label: '表示言語',
        english: 'English',
        japanese: '日本語',
      },
      column: {
        todo: '未着手',
        doing: '進行中',
        done: '完了',
      },
      runState: {
        idle: '未稼働',
        running: '稼働中',
        pending: '待機中',
      },
      board: {
        loading: '読み込み中…',
        loadError: 'ボードを読み込めませんでした。',
        retry: '再試行',
        empty: 'カードはまだありません。',
        emptyHint: 'エージェントは "skan add <title>" でカードを追加します。',
      },
      card: {
        updated: '更新 {{date}}',
      },
      detail: {
        title: 'カードの詳細',
        selectPrompt: 'カードを選択すると詳細を表示します。',
        close: '詳細を閉じる',
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
      history: {
        title: '履歴',
        created: '作成',
      },
      status: {
        cardCount_one: '{{count}}件',
        cardCount_other: '{{count}}件',
        connecting: '接続中…',
        notConnected: '接続できません',
        synced: '同期済み {{time}}',
        disconnected: '切断中 · 最終同期 {{time}}',
      },
    },
  },
} as const;
