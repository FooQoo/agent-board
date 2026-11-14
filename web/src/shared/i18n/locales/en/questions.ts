export const questionsEn = {
  questions: {
    band: {
      title: 'Unanswered questions',
      list: 'Unanswered questions of the project',
      hint: 'When the answers are in, the waiting AI goes on with its work',
      held: '{{count}} answered, not sent yet',
      answerAll: 'Answer them',
      resume: 'Continue answering',
      review: 'Review and send',
      scrollBack: 'Show the earlier questions',
      scrollOn: 'Show the later questions',
      item: '{{title}} ({{tasks}})',
      itemHeld: '{{title}} ({{tasks}}, answered, not sent)',
      noTask: 'No task',
      heldMark: 'Answered, not sent',
      emptyTitle: 'No unanswered questions',
      emptyBody: 'Questions from the AI appear here',
    },
    card: {
      waiting: 'Unanswered questions: {{count}}',
      waitingStart: 'Waiting for the start to be approved',
    },
  },
} as const;
