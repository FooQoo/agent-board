// The English source text of the first-run guide. The Japanese file keeps the same keys.
export const onboardingEn = {
  onboarding: {
    welcome: {
      title: 'Try Agent Board',
      body: 'Follow two sample tasks to see how AI makes progress and asks for your decisions.',
      stepWatch: 'Watch a sample card move on its own',
      stepAnswer: 'Answer a question from AI',
      archiveNote: 'The two sample cards are archived when you finish the guide.',
      simulated: 'This guide simulates AI progress. No AI agent is needed.',
      skip: 'Skip',
      start: 'Start guide',
    },
    guide: {
      step: 'Guide {{current}} / {{total}}',
      exit: 'End guide',
      retry: 'Retry',
      next: 'Next',
      watch: 'Watch it move',
      readFirst: 'Read the note, then continue.',
      waitingHint: 'Waiting for your answer on the card',
      waitingBadge: 'Waiting for you',
    },
    steps: {
      samples: {
        title: 'Two sample cards are ready',
        body: 'Start with the first card. When AI starts work, the card moves to In progress.',
      },
      running: {
        title: 'AI is making progress',
        body: 'Running means AI is working on this card. When the work ends, the card moves to Done.',
      },
      pending: {
        title: 'AI needs your decision',
        body: 'Choose an option and press Send. When your answer arrives, AI resumes the work.',
      },
      resumed: {
        title: 'Your answer arrived and AI resumed',
        body: "Your answer stays in the card's history. When the second card's work ends, it moves to Done.",
      },
    },
    complete: {
      title: 'You have completed the guide',
      body: 'Let AI do the work and decide when it needs you. Start your own work on this board.',
      pointFlow: 'You saw how AI makes progress',
      pointDecision: 'You answered a decision',
      archiveNote: 'Finishing archives the two sample cards.',
      finish: 'Finish and get started',
    },
    archived: 'The two sample tasks have been archived.',
    mock: {
      emptyHint: 'Add your first task to get started.',
    },
    sample: {
      follow: 'Sample: follow a task',
      guideStyle: 'Sample: choose the guide style',
      question: 'Which explanation is easier to read?',
      brief: 'Keep it brief',
      detailed: 'Include more context',
    },
  },
};
