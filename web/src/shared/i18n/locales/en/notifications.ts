// The "Phone notifications" row of the settings dialog and the dialog it opens.
export const notificationsEn = {
  notifications: {
    title: 'Phone notifications',
    entryBody: 'Choose what the board tells your phone about.',
    entryAction: 'Notification settings',
    intro:
      'Choose what the board may tell your phone about. These choices are saved on this computer and apply once notifications are delivered to your phone.',
    loading: 'Loading the saved choices.',
    loadFailed: 'Could not read the saved notification choices.',
    summaryInterval: {
      label: 'Summary interval',
      hint: 'How often the board records a summary of the results',
      options: {
        0: 'Off',
        30: 'Every 30 minutes',
        60: 'Every hour',
        120: 'Every 2 hours',
        240: 'Every 4 hours',
      },
    },
    kinds: {
      results: {
        label: 'Results',
        hint: 'Intermediate drafts and finals',
      },
      questions: {
        label: 'Questions that need my decision',
        hint: 'A decision request is waiting for you',
      },
      history: {
        label: 'History additions',
        hint: "A new entry in a card's history",
      },
      summary: {
        label: 'Periodic summary',
        hint: 'A summary of the results of the last interval was recorded',
      },
    },
  },
};
