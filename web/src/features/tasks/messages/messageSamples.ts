import type { Message } from '@/shared/data/api/contracts';
import type { MessageDetail, MessagesApi, PeriodicSummary } from './model/messages';

/**
 * Sample messages for the Stories and the guide: the open messages of the approved mock, in both
 * languages. The first question carries a picture, as the mock's does.
 */
export const SAMPLE_PROJECT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';

/** The image the sample questions and requests show: a synthetic file of the Storybook static folder. */
export const SAMPLE_ATTACHMENT_ID = '0123456789abcdef0123456789abcdef';

export function resolveSampleAttachment(_message: Message, id: string): string | null {
  return id === SAMPLE_ATTACHMENT_ID ? '/sample-question.png' : null;
}

interface SampleText {
  q12: string;
  q12Body: string;
  keep: string;
  drop: string;
  q13: string;
  q13Body: string;
  q13a: string;
  q13b: string;
  r14: string;
  r14Body: string;
  epic: string;
  q11: string;
  q11Body: string;
  q11a: string;
  q11Note: string;
}

const ja: SampleText = {
  q12: '既存のユーザーデータを残しますか',
  q12Body: `## 既存のユーザーデータの扱い

ログインの作り直しで、保存済みのパスワードのハッシュ形式が変わります。切り替え方を決めてください。

![いまの画面](attachment:${SAMPLE_ATTACHMENT_ID})

残す場合は、初回ログイン時に新しい形式へ変換します。消す場合は、全員にパスワードの再設定をお願いします。`,
  keep: '残す(初回ログイン時に変換)',
  drop: '消す(再設定をお願いする)',
  q13: 'ログインに使う認証方式はどれにしますか',
  q13Body: '## 認証方式\n\nメールとパスワードのほかに、外部アカウントでのログインも足しますか。',
  q13a: 'メールとパスワードだけ',
  q13b: '外部アカウントも足す',
  r14: 'ログイン画面に、パスワードを忘れたときの導線を足して。',
  r14Body: `ログイン画面に、パスワードを忘れたときの導線を足してください。

- ログインボタンの下に「パスワードを忘れた方」のリンク
- 押すとメールアドレスの入力画面へ

![いまの画面](attachment:${SAMPLE_ATTACHMENT_ID})`,
  epic: 'ログインの改善',
  q11: 'ログイン画面の文言を変えてよいですか',
  q11Body: '## ログイン画面の文言\n\nボタンの文言を「ログイン」から「続ける」に変えてよいですか。',
  q11a: '変えてよい',
  q11Note: 'ボタンの色はそのままで。',
};

const en: SampleText = {
  q12: 'Keep the existing user data?',
  q12Body: `## What to do with existing user data

Rebuilding the login changes the hash format of stored passwords. Decide how to switch over.

![Current screen](attachment:${SAMPLE_ATTACHMENT_ID})

If you keep it, each account is converted at its next login. If you drop it, everyone is asked to reset their password.`,
  keep: 'Keep (convert at next login)',
  drop: 'Drop (ask for a reset)',
  q13: 'Which sign-in method should the login use?',
  q13Body:
    '## Sign-in method\n\nBesides email and password, should the login also accept an outside account?',
  q13a: 'Email and password only',
  q13b: 'Add outside accounts too',
  r14: 'Add a way back to the login screen for people who forgot their password.',
  r14Body: `Please add a way back on the login screen for people who forgot their password.

- A "Forgot your password?" link under the login button
- It opens a screen to enter an email address

![Current screen](attachment:${SAMPLE_ATTACHMENT_ID})`,
  epic: 'Improve login',
  q11: 'May the login screen change its wording?',
  q11Body: '## Login screen wording\n\nMay the button say "Continue" instead of "Log in"?',
  q11a: 'Yes, change it',
  q11Note: 'Keep the button color as it is.',
};

const textOf = (language: string) => (language.startsWith('ja') ? ja : en);

/** The open messages the mock's board shows: two questions and a request nobody picked up. */
export function sampleMessages(language: string): Message[] {
  const s = textOf(language);
  return [
    {
      id: 'Q-13',
      type: 'question',
      from: 'ai',
      to: 'human',
      turn: 'human',
      title: s.q13,
      createdAt: '2026-11-17T08:20:00.000Z',
      tasks: [14],
      epicId: null,
    },
    {
      id: 'Q-12',
      type: 'question',
      from: 'ai',
      to: 'human',
      turn: 'human',
      title: s.q12,
      createdAt: '2026-11-17T08:40:00.000Z',
      tasks: [21, 22],
      epicId: 'LOGIN-1',
    },
    {
      id: 'Q-14',
      type: 'request',
      from: 'human',
      to: 'ai',
      turn: 'ai',
      title: s.r14,
      createdAt: '2026-11-17T08:55:00.000Z',
      tasks: [],
      epicId: null,
    },
  ];
}

/** A question the person answered that no agent took in yet: it stays listed until one does. */
export function answeredSample(language: string): Message {
  return {
    id: 'Q-11',
    type: 'question',
    from: 'ai',
    to: 'human',
    turn: 'ai',
    title: textOf(language).q11,
    createdAt: '2026-11-17T08:10:00.000Z',
    tasks: [21],
    epicId: 'LOGIN-1',
  };
}

/** The routes of the Stories: they read the samples, and answering or withdrawing does nothing. */
export function sampleMessagesApi(language: string, over: Partial<MessagesApi> = {}): MessagesApi {
  const s = textOf(language);
  return {
    read: async (_projectId, id): Promise<MessageDetail> => {
      if (id === 'Q-12')
        return {
          id,
          type: 'question',
          body: s.q12Body,
          choices: [
            { id: 'keep', label: s.keep },
            { id: 'drop', label: s.drop },
          ],
          recommendedChoiceId: 'keep',
          status: 'open',
          referencedBy: [21, 22],
        };
      if (id === 'Q-13')
        return {
          id,
          type: 'question',
          body: s.q13Body,
          choices: [
            { id: 'mail', label: s.q13a },
            { id: 'sso', label: s.q13b },
          ],
          recommendedChoiceId: null,
          status: 'open',
          referencedBy: [14],
        };
      if (id === 'Q-14')
        return {
          id,
          type: 'request',
          body: s.r14Body,
          choices: [],
          recommendedChoiceId: null,
          status: 'open',
          referencedBy: [],
        };
      if (id === 'Q-11')
        return {
          id,
          type: 'question',
          body: s.q11Body,
          choices: [{ id: 'yes', label: s.q11a }],
          recommendedChoiceId: 'yes',
          status: 'answered',
          referencedBy: [21],
          reply: { choiceLabel: s.q11a, text: s.q11Note, acceptedAt: null },
        };
      throw new Error(`No sample message ${id}.`);
    },
    answer: async () => undefined,
    withdraw: async () => undefined,
    ...over,
  };
}

const summaryTitles: Record<number, { ja: string; en: string }> = {
  548: {
    ja: '通知の許可ダイアログをやさしい文面にする',
    en: 'Soften the wording of the notification permission dialog',
  },
  549: {
    ja: 'プロジェクト切り替えの一覧を検索できるようにする',
    en: 'Make the project switcher list searchable',
  },
  551: {
    ja: '設定ダイアログのテーマ見本を見やすくする',
    en: 'Make the theme swatches in the settings dialog easier to read',
  },
  552: {
    ja: 'スマホのボードを引っ張って更新にする',
    en: 'Make the phone board refresh by pulling down',
  },
  556: {
    ja: '受け入れ条件の編集中に別の端末で更新があったときの警告を分かりやすくする',
    en: 'Make the warning clearer when another device updates acceptance conditions while you are editing them',
  },
};

/** Sample periodic summaries of the Stories, newest first: four windows, none dismissed. */
export function sampleSummaries(language: string): PeriodicSummary[] {
  const lang = language.startsWith('ja') ? 'ja' : 'en';
  const results = (ids: number[]) =>
    ids.map((taskId) => ({ taskId, title: summaryTitles[taskId]?.[lang] ?? '' }));
  return [
    {
      id: 's-20261120T010000Z',
      from: '2026-11-20T00:00:00Z',
      to: '2026-11-20T01:00:00Z',
      results: results([552, 556]),
    },
    {
      id: 's-20261119T230000Z',
      from: '2026-11-19T22:00:00Z',
      to: '2026-11-19T23:00:00Z',
      results: results([551]),
    },
    {
      id: 's-20261119T080000Z',
      from: '2026-11-19T07:00:00Z',
      to: '2026-11-19T08:00:00Z',
      results: results([549]),
    },
    {
      id: 's-20261119T060000Z',
      from: '2026-11-19T05:00:00Z',
      to: '2026-11-19T06:00:00Z',
      results: results([548]),
    },
  ];
}
