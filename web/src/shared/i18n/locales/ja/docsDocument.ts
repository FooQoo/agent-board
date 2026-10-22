export const docsDocumentJa = {
  docsDocument: {
    kind: 'Markdown',
    loading: 'ファイルを読み込み中…',
    loadErrorTitle: 'ファイルを読み込めませんでした',
    loadErrorBody: 'もう一度お試しください。',
    reload: '再読み込み',
    readOnly: 'このファイルは読み取り専用です。編集と保存はできません。',
    frontmatter: 'フロントマター',
    frontmatterCount_one: '{{count}}項目',
    frontmatterCount_other: '{{count}}項目',
    saveFailed: '保存できませんでした。入力は残っています',
    conflictTitle: '保存できませんでした。ファイルが外部で変更されています',
    conflictBody:
      '編集した内容はこの画面に残っています。最新の内容を読み込み直すか、自分の内容で上書きするかを選んでください。',
    conflictReload: '最新を再読み込み',
    conflictOverwrite: '自分の内容で上書き',
    conflictOverwriting: '上書き中…',
    reloadConfirmTitle: '編集中の内容を破棄して再読み込みしますか？',
    reloadConfirmBody: '保存されていない編集は失われ、ファイルの最新の内容が表示されます。',
    reloadConfirm: '破棄して再読み込み',
    reloadCancel: '編集を続ける',
  },
} as const;
