// Strings of the data layer's monitor area (en). Each later change adds its own keys here and
// nowhere else, so parallel work never edits the same dictionary file.
export const dataLayerMonitorEn = {
  dataLayerMonitor: {
    partial: '{{problems}} data issues',
    projectError: {
      missing: {
        title: 'This link has no project',
        body: 'The address does not say which project to show.',
      },
      invalid: {
        title: 'This link is not valid',
        body: 'The address names a project that cannot be read.',
      },
      notFound: {
        title: 'This project is no longer available',
        body: 'It may have been deleted or renamed.',
      },
      guide: 'On the PC, open the mobile connection settings and scan the QR code again.',
    },
  },
} as const;
