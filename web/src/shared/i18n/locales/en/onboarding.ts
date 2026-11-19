// The English source text of the first-run guide. The Japanese file keeps the same keys.
export const onboardingEn = {
  onboarding: {
    welcome: {
      title: 'Try Agent Board',
      body: 'Send a request to the agent and watch it plan the work, ask you a question, and finish the cards.',
      stepRequest: 'Send a request with Ask AI',
      stepAnswer: "Answer the agent's question",
      stepWatch: 'Watch the agent do the work',
      simulated: 'This guide simulates the agent. No AI agent is needed.',
      skip: 'Skip',
      start: 'Start guide',
    },
    guide: {
      step: 'Guide {{current}} / {{total}}',
      exit: 'End guide',
      next: 'Next',
      write: 'Open Ask AI',
      requestHint: 'Press Send request to continue.',
      readFirst: 'Read the note, then continue.',
      waitingHint: 'Waiting for your answer on the card',
      waitingBadge: 'Waiting for you',
    },
    steps: {
      request: {
        title: 'Ask the agent with Ask AI',
        body: 'You do not add tasks yourself. Describe what you want in Ask AI and the agent plans it. A sample request is ready for you.',
      },
      planned: {
        title: 'The agent made a plan',
        body: 'The request became an epic and cards in To do. The cards are AI drafts, and each has acceptance conditions that say when it is done.',
      },
      question: {
        title: 'The agent needs your answer',
        body: 'Before it starts, the agent asks a question. Choose an option and press Send answer.',
      },
      started: {
        title: 'The agent started the plan',
        body: 'The drafts became real cards and the first one moved to In progress. As the agent checks its acceptance conditions, you can follow the progress on the card.',
      },
      done: {
        title: 'The cards moved to Done',
        body: 'When all the acceptance conditions of a card are checked, the card moves to Done by itself. You only had to ask and answer.',
      },
    },
    complete: {
      title: 'You have completed the guide',
      body: 'Ask AI, answer when the agent needs you, and let it do the rest. Send your first request on this board.',
      pointRequest: 'You sent a request with Ask AI',
      pointDecision: "You answered the agent's question",
      pointFlow: 'You saw the agent plan and finish the work',
      finish: 'Finish and get started',
    },
    mock: {
      emptyHint: 'Press Ask AI to send your first request.',
    },
  },
};
