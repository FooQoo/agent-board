import type { AcceptanceItem, EpicRef, TaskSummary } from '../../shared/api/contracts';

/** The four lanes of the proposed board. Backlog is a stored lane before Todo (SPEC 19_BACKLOG 3.2). */
export type Lane = 'backlog' | 'todo' | 'doing' | 'done';
export const LANES: readonly Lane[] = ['backlog', 'todo', 'doing', 'done'];

export const PROJECT_ID = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const NOW = '2026-11-21T09:00:00.000Z';

export interface MockCard {
  id: number;
  title: string;
  epicId: string | null;
  wave: number;
  lane: Lane;
  body: string;
  conditions: AcceptanceItem[];
  /** The text of an open question, if the card waits on one. */
  question: string | null;
  edited?: boolean;
  /** Sent to Todo in the last operation. */
  sent?: boolean;
}

export interface Fixture {
  epics: EpicRef[];
  /** The goal text of each epic. */
  epicBody: Record<string, string>;
  cards: MockCard[];
}

const cond = (id: string, text: string, done = false): AcceptanceItem => ({ id, text, done });

export function buildFixture(ja: boolean): Fixture {
  const epic: EpicRef = {
    id: 'LOGIN-1',
    name: ja ? 'ログインの見直し' : 'Rework sign-in',
    color: '#3b82f6',
  };
  const search: EpicRef = {
    id: 'SEARCH-2',
    name: ja ? '検索の改善' : 'Improve search',
    color: '#10b981',
  };
  const goal = ja
    ? '社内ツールのログインを、利用者が迷わず入れる形にそろえる。\n\n- 方式を一つに決め、画面と手順を作る\n- 古い利用者が困らない移行手順を用意する'
    : 'Make sign-in for the internal tool one that people can get through without help.\n\n- Pick one method, then build the screen and the steps\n- Prepare a move that does not strand existing users';
  const cards: MockCard[] = [
    {
      id: 41,
      title: ja ? '現行のログイン処理を調べる' : 'Survey the current sign-in flow',
      epicId: 'LOGIN-1',
      wave: 1,
      lane: 'backlog',
      body: ja
        ? '現行の処理を読み、どこで失敗が起きるかを一覧にする。\n\n## 進め方\n\n1. ログの失敗理由を集計する\n2. 画面の分岐を図にする'
        : 'Read the current flow and list where it fails.\n\n## Steps\n\n1. Count the failure reasons in the logs\n2. Draw the screen branches',
      conditions: [
        cond(
          'AC-1',
          ja ? '失敗理由が件数つきで一覧になっている' : 'Failure reasons are listed with counts',
          true,
        ),
        cond('AC-2', ja ? '画面の分岐が図で示されている' : 'The screen branches are drawn', true),
      ],
      question: null,
    },
    {
      id: 42,
      title: ja ? '認証方式の候補を比べる' : 'Compare sign-in methods',
      epicId: 'LOGIN-1',
      wave: 1,
      lane: 'backlog',
      body: ja
        ? 'パスワード、メールリンク、SSO の三つを、運用の手間と利用者の負担で比べる。'
        : 'Compare password, email link and SSO by upkeep and by effort for users.',
      conditions: [
        cond(
          'AC-1',
          ja
            ? '三つの方式が同じ観点で比べられている'
            : 'The three methods are compared on the same points',
        ),
        cond(
          'AC-2',
          ja
            ? '推す方式とその理由が一文で書かれている'
            : 'One method is recommended in one sentence',
        ),
      ],
      question: ja ? 'SSO は今回の対象に含めますか？' : 'Is SSO in scope this time?',
    },
    {
      id: 43,
      title: ja ? '選んだ方式でログイン画面を作る' : 'Build the sign-in screen',
      epicId: 'LOGIN-1',
      wave: 2,
      lane: 'backlog',
      body: ja
        ? '決まった方式で画面を作る。エラー文言は日英で用意する。'
        : 'Build the screen for the chosen method, with error messages in both languages.',
      conditions: [
        cond('AC-1', ja ? '成功と失敗の両方の画面が動く' : 'Both success and failure screens work'),
        cond(
          'AC-2',
          ja ? 'エラー文言が日本語と英語である' : 'Error messages exist in Japanese and English',
        ),
        cond('AC-3', ja ? 'スマホ幅でも崩れない' : 'The layout holds at phone width'),
      ],
      question: null,
    },
    {
      id: 44,
      title: ja ? '既存利用者の移行手順を書く' : 'Write the migration steps',
      epicId: 'LOGIN-1',
      wave: 3,
      lane: 'backlog',
      body: ja
        ? '切り替え当日までの手順と、戻し方を書く。'
        : 'Write the steps up to the switch and how to roll back.',
      conditions: [
        cond(
          'AC-1',
          ja ? '切り替えの手順が時系列で書かれている' : 'The switch steps are in time order',
        ),
        cond('AC-2', ja ? '戻し方が書かれている' : 'The rollback is described'),
      ],
      question: null,
    },
    {
      id: 50,
      title: ja ? 'ヘルプ文面の言い回しをそろえる' : 'Unify the wording of the help text',
      epicId: null,
      wave: 1,
      lane: 'backlog',
      body: ja ? 'ヘルプに出る文面の用語をそろえる。' : 'Unify the terms used in the help text.',
      conditions: [cond('AC-1', ja ? '用語の表が作られている' : 'A term table exists')],
      question: null,
    },
    {
      id: 31,
      title: ja ? '検索結果の並び順を直す' : 'Fix the order of search results',
      epicId: 'SEARCH-2',
      wave: 1,
      lane: 'todo',
      body: ja ? '更新が新しい順に並ぶようにする。' : 'Show newer updates first.',
      conditions: [cond('AC-1', ja ? '新しい順に並ぶ' : 'Results are newest first')],
      question: null,
    },
    {
      id: 32,
      title: ja ? '検索の空結果の文面を直す' : 'Reword the empty search result',
      epicId: 'SEARCH-2',
      wave: 1,
      lane: 'todo',
      body: ja
        ? '何も見つからないときの文面を直す。'
        : 'Reword the text shown when nothing is found.',
      conditions: [cond('AC-1', ja ? '文面が直っている' : 'The text is reworded')],
      question: null,
    },
    {
      id: 28,
      title: ja ? '検索のインデックスを作り直す' : 'Rebuild the search index',
      epicId: 'SEARCH-2',
      wave: 1,
      lane: 'doing',
      body: ja ? 'インデックスの作り方を見直す。' : 'Rework how the index is built.',
      conditions: [cond('AC-1', ja ? '作り直しが終わっている' : 'The rebuild is finished')],
      question: null,
    },
    {
      id: 20,
      title: ja ? '検索の現状を調べる' : 'Survey the current search',
      epicId: 'SEARCH-2',
      wave: 1,
      lane: 'done',
      body: ja ? '現状の問題を洗い出した。' : 'Listed the current problems.',
      conditions: [cond('AC-1', ja ? '問題が一覧になっている' : 'Problems are listed', true)],
      question: null,
    },
  ];
  return {
    epics: [epic, search],
    epicBody: {
      'LOGIN-1': `# ${epic.name}\n\n${goal}`,
      'SEARCH-2': `# ${search.name}\n\n${ja ? '検索を速く、見つけやすくする。' : 'Make search faster and easier to read.'}`,
    },
    cards,
  };
}

export function epicOf(fixture: Fixture, id: string | null): EpicRef | null {
  return fixture.epics.find((item) => item.id === id) ?? null;
}

/** A card as the product's card component takes it. Backlog is drawn as a todo card with its own marks. */
export function summaryOf(card: MockCard, epics: readonly EpicRef[]): TaskSummary {
  return {
    id: card.id,
    title: card.title,
    assignee: 'ai',
    taskStatus: card.lane === 'backlog' ? 'todo' : card.lane,
    taskStatusChangedAt: NOW,
    position: card.id,
    agentStatus: card.lane === 'doing' ? 'running' : 'idle',
    agentStatusChangedAt: NOW,
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    epic: epics.find((item) => item.id === card.epicId) ?? null,
    updatedAt: NOW,
    draft: null,
    acceptance: card.conditions,
  };
}

export const countIn = (cards: readonly MockCard[], lane: Lane) =>
  cards.filter((card) => card.lane === lane).length;

export const allAchieved = (card: MockCard) =>
  card.conditions.length > 0 && card.conditions.every((item) => item.done);
