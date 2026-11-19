// The "Phone notifications" section of the settings dialog.
export const notificationsJa = {
  notifications: {
    title: 'スマホの通知',
    intro:
      'ボードがスマホに知らせてよい内容を選びます。選択はこのコンピューターに保存され、スマホへの通知が届くようになった時点から反映されます。',
    loading: '保存済みの選択を読み込んでいます。',
    loadFailed: '保存済みの通知の選択を読み込めませんでした。',
    kinds: {
      results: {
        label: '成果',
        hint: '途中の成果と最終成果',
      },
      questions: {
        label: '判断が必要な質問',
        hint: 'あなたの判断を待つ質問があるとき',
      },
      stateChanges: {
        label: 'カードの状態変化',
        hint: '通知する変化を下で選びます',
      },
      history: {
        label: '履歴の追加',
        hint: 'カードの履歴に項目が増えたとき',
      },
    },
    stateChangesGroup: '通知する状態変化',
    stateChanges: {
      started: '着手',
      pending: '回答待ち',
      done: '完了',
    },
    periodic: {
      label: '定期的な状況通知',
      hint: '上の選択とは別に、一定の間隔で状況をまとめて知らせます',
      interval: '間隔',
      intervals: {
        m30: '30分',
        m60: '1時間',
        m120: '2時間',
        m240: '4時間',
      },
    },
  },
};
