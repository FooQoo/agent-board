// Strings of the data layer's monitor area (ja). Each later change adds its own keys here and
// nowhere else, so parallel work never edits the same dictionary file.
export const dataLayerMonitorJa = {
  dataLayerMonitor: {
    partial: 'データの問題 {{problems}} 件',
    projectError: {
      missing: {
        title: 'プロジェクトが指定されていません',
        body: 'アドレスに、表示するプロジェクトが含まれていません。',
      },
      invalid: {
        title: 'リンクが正しくありません',
        body: 'アドレスのプロジェクトを読み取れません。',
      },
      notFound: {
        title: 'プロジェクトが見つかりません',
        body: '削除されたか、見つからない可能性があります。',
      },
      guide: 'PCのモバイル接続の設定を開き、QRコードを読み取り直してください。',
    },
  },
} as const;
