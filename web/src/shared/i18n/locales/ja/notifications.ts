// The "Phone notifications" row of the settings dialog and the dialog it opens.
export const notificationsJa = {
  notifications: {
    title: 'スマホの通知',
    entryBody: 'ボードがスマホに知らせる内容を選びます。',
    entryAction: '通知の設定',
    intro:
      'ボードがスマホに知らせてよい内容を選びます。選択はこのコンピューターに保存され、スマホへの通知が届くようになった時点から反映されます。',
    loading: '保存済みの選択を読み込んでいます。',
    loadFailed: '保存済みの通知の選択を読み込めませんでした。',
    summaryInterval: {
      label: 'サマリーの間隔',
      hint: '成果のサマリーを記録する間隔',
      options: {
        0: 'しない',
        30: '30分ごと',
        60: '1時間ごと',
        120: '2時間ごと',
        240: '4時間ごと',
      },
    },
    kinds: {
      results: {
        label: '成果',
        hint: '途中の成果と最終成果',
      },
      questions: {
        label: '判断が必要な質問',
        hint: 'あなたの判断を待つ質問があるとき',
      },
      history: {
        label: '履歴の追加',
        hint: 'カードの履歴に項目が増えたとき',
      },
      summary: {
        label: '定期サマリー',
        hint: '直近の一定時間の成果をまとめたサマリーが記録されたとき',
      },
    },
  },
};
