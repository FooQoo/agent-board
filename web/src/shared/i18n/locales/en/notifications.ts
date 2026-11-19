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
    kinds: {
      results: {
        label: 'Results',
        hint: 'Intermediate drafts and finals',
      },
      questions: {
        label: 'Questions that need my decision',
        hint: 'A decision request is waiting for you',
      },
      stateChanges: {
        label: 'Card state changes',
        hint: 'Pick which changes below',
      },
      history: {
        label: 'History additions',
        hint: "A new entry in a card's history",
      },
    },
    stateChangesGroup: 'State changes to notify',
    stateChanges: {
      started: 'Started',
      pending: 'Waiting for an answer',
      done: 'Done',
    },
    periodic: {
      label: 'Periodic status notification',
      hint: 'A summary at a regular interval, separate from the choices above',
      interval: 'Interval',
      intervals: {
        m30: '30 min',
        m60: '1 hour',
        m120: '2 hours',
        m240: '4 hours',
      },
    },
  },
};
