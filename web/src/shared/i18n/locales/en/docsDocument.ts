export const docsDocumentEn = {
  docsDocument: {
    kind: 'Markdown',
    loading: 'Loading the file…',
    loadErrorTitle: 'Could not load the file',
    loadErrorBody: 'Try again.',
    reload: 'Reload',
    readOnly: 'This file is read-only. You cannot edit or save it.',
    frontmatter: 'Front matter',
    frontmatterCount_one: '{{count}} item',
    frontmatterCount_other: '{{count}} items',
    saveFailed: 'Could not save. Your input is kept.',
    conflictTitle: 'Could not save. The file was changed outside this screen',
    conflictBody:
      'What you edited is still on this screen. Choose whether to load the latest content or overwrite it with yours.',
    conflictReload: 'Reload the latest',
    conflictOverwrite: 'Overwrite with mine',
    conflictOverwriting: 'Overwriting…',
    reloadConfirmTitle: 'Discard your edits and reload?',
    reloadConfirmBody:
      'Your unsaved edits are lost and the latest content of the file is shown instead.',
    reloadConfirm: 'Discard and reload',
    reloadCancel: 'Keep editing',
  },
} as const;
