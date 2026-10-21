// The Japanese text of the first-run guide. Keys match locales/en/onboarding.ts.
export const onboardingJa = {
  onboarding: {
    welcome: {
      title: 'Agent Boardを体験しましょう',
      body: '2枚のサンプルカードで、AIの作業と、あなたに判断が戻ってくる流れを体験できます。',
      stepWatch: 'サンプルカードの自動進行を見る',
      stepAnswer: 'AIからの質問に答えてみる',
      archiveNote: 'ガイドで作るサンプル2枚は、完了時にアーカイブします。',
      simulated: 'このガイドではAIの進行を再現します。実際のAIとの接続は不要です。',
      skip: 'スキップ',
      start: 'ガイドを始める',
    },
    guide: {
      step: '使い方ガイド {{current}} / {{total}}',
      exit: 'ガイドを終了',
      retry: '再試行',
      next: '次へ',
      watch: '動きを見る',
      readFirst: '説明を読んでから進められます',
      waitingHint: 'カードの回答を待っています',
      waitingBadge: '回答待ち',
    },
    steps: {
      samples: {
        title: '2枚のサンプルを用意しました',
        body: 'まずは、1枚目のカードを追ってみましょう。AIが作業を始めると、カードが「進行中」へ移動します。',
      },
      running: {
        title: 'AIが作業を進めています',
        body: '「稼働中」は、AIが作業している印です。作業が終わると、このカードは「完了」へ移動します。',
      },
      pending: {
        title: 'あなたの判断が必要になりました',
        body: '選択肢を選んで「送信」を押してください。回答が届くと、AIがその内容に沿って作業を再開します。',
      },
      resumed: {
        title: '回答が届き、AIが再開しました',
        body: 'あなたの回答はカードの履歴に残ります。2枚目も作業が終わると「完了」へ移動します。',
      },
    },
    complete: {
      title: '使い方をひと巡りできました',
      body: 'AIに任せ、必要なときに判断する。このボードで、あなたの作業を始めてみましょう。',
      pointFlow: 'AIの進み方が分かった',
      pointDecision: '判断への回答を体験した',
      archiveNote: '完了すると、サンプル2枚をアーカイブします。',
      finish: '完了して始める',
    },
    archived: 'サンプル2枚をアーカイブしました。',
    sample: {
      follow: 'サンプル：使い方を確認する',
      guideStyle: 'サンプル：案内の見せ方を選ぶ',
      question: '案内の文章は、どちらが読みやすいですか？',
      brief: '短く、要点だけ',
      detailed: '背景も含めて詳しく',
    },
  },
};
