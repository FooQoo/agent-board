// The Japanese text of the first-run guide. Keys match locales/en/onboarding.ts.
export const onboardingJa = {
  onboarding: {
    welcome: {
      title: 'Agent Boardを体験しましょう',
      body: 'エージェントに依頼を送ると、計画づくりから質問、カードの完了までを任せられます。その流れを体験できます。',
      stepRequest: '「AI に依頼」で依頼を送る',
      stepAnswer: 'エージェントの質問に答える',
      stepWatch: 'エージェントが作業を進めるのを見る',
      simulated: 'このガイドではエージェントの動きを再現します。実際のAIとの接続は不要です。',
      skip: 'スキップ',
      start: 'ガイドを始める',
    },
    guide: {
      step: '使い方ガイド {{current}} / {{total}}',
      exit: 'ガイドを終了',
      next: '次へ',
      write: '「AI に依頼」を開く',
      requestHint: '「依頼する」を押すと進みます',
      readFirst: '説明を読んでから進められます',
      waitingHint: 'カードの回答を待っています',
      waitingBadge: '回答待ち',
    },
    steps: {
      request: {
        title: '「AI に依頼」でエージェントに頼みます',
        body: 'タスクは自分で追加しません。やりたいことを「AI に依頼」に書くと、エージェントが計画します。サンプルの依頼を用意しました。',
      },
      planned: {
        title: 'エージェントが計画を立てました',
        body: '依頼がエピックと、「バックログ」のカードになりました。カードはまだ着手されない計画で、それぞれに完了の目安となる完了条件が付いています。',
      },
      question: {
        title: 'エージェントが回答を待っています',
        body: '作業を始める前に、エージェントが質問します。選択肢を選んで「回答を送る」を押してください。',
      },
      started: {
        title: 'エージェントが計画を始めました',
        body: '計画を「未着手」へ送り、1枚目が「進行中」へ移りました。完了条件にチェックが入っていくので、カードで進み具合を追えます。',
      },
      done: {
        title: 'カードが「完了」になりました',
        body: 'カードの完了条件がすべてチェックされると、カードは自動で「完了」へ移ります。あなたがしたのは、依頼と回答だけです。',
      },
    },
    complete: {
      title: '使い方をひと巡りできました',
      body: '「AI に依頼」で頼み、必要なときに答え、あとは任せる。このボードで、最初の依頼を送ってみましょう。',
      pointRequest: '「AI に依頼」で依頼を送った',
      pointDecision: 'エージェントの質問に答えた',
      pointFlow: 'エージェントが計画して完了まで進めるのを見た',
      finish: '完了して始める',
    },
    mock: {
      emptyHint: '「AI に依頼」から、最初の依頼を送ってみましょう。',
    },
  },
};
