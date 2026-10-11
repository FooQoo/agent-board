import type { Card, Project } from '../types';
import type { MonitorCard, MonitorViewProps } from './contracts';
import { unconnectedMonitorReadResolvers } from './contracts';

const project: Project = {
  id: 'a'.repeat(32),
  name: 'agent-board',
  createdAt: '2026-10-01T00:00:00Z',
};
const longText =
  'A detailed review of the read-only monitor layout, its stable navigation and shared card rendering. '.repeat(
    500,
  );

function card(id: number, status: 'pending' | 'running' | 'done', long: boolean): Card {
  const at = `2026-10-11T00:${String(id % 60).padStart(2, '0')}:00Z`;
  const done = status === 'done';
  const pending = status === 'pending';
  return {
    id,
    title:
      long && id === 1
        ? 'A monitor card title long enough to exercise the two line clamp at narrow widths'
        : `${status[0]?.toUpperCase()}${status.slice(1)} work item ${id}`,
    description:
      long && id === 1
        ? longText
        : '## Work\n\nReview the monitor behavior and confirm the shared display remains read-only.\n\n## Acceptance\n\n- [x] Common detail view\n- [ ] Keep the content readable',
    assignee: 'ai',
    cardStatus: done ? 'done' : pending ? 'todo' : 'doing',
    position: id,
    agentStatus: pending ? 'pending' : status === 'running' ? 'running' : 'idle',
    pendingReason: pending
      ? 'Waiting for a decision about how the mobile monitor should present the result.'
      : null,
    pendingRequestId: pending ? `request-${id}` : null,
    pendingChoices: pending
      ? [
          { id: 'a', label: 'Keep the current shared layout' },
          { id: 'b', label: 'Use a separate view' },
        ]
      : [],
    epic: null,
    createdAt: at,
    updatedAt: at,
    agentStatusChangedAt: at,
    isDraft: pending,
    history: done
      ? [
          {
            id: `done-${id}`,
            kind: 'lane',
            actor: 'ai',
            reason: 'Verified on the fixture',
            fromCardStatus: 'doing',
            toCardStatus: 'done',
            fromAgentStatus: null,
            toAgentStatus: 'idle',
            requestId: null,
            at,
          },
        ]
      : [
          {
            id: `create-${id}`,
            kind: 'created',
            actor: 'ai',
            reason: null,
            fromCardStatus: null,
            toCardStatus: pending ? 'todo' : 'doing',
            fromAgentStatus: null,
            toAgentStatus: pending ? 'pending' : 'running',
            requestId: null,
            at,
          },
        ],
    attachments: [],
    evidence: [],
  };
}

export function createMonitorFixtureProps(): MonitorViewProps {
  const params = new URLSearchParams(window.location.search);
  const long = params.has('long');
  const ac1Fixture = params.get('fixture') === 'ac1';
  const count = ac1Fixture ? 11 : Math.min(100, Math.max(1, Number(params.get('count')) || 6));
  const scope = params.get('scope') ?? 'all';
  const items: MonitorCard[] = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const status = ac1Fixture
      ? id === 1
        ? 'pending'
        : id === 2 || id === 3
          ? 'running'
          : 'done'
      : id === 3 || id % 7 === 0
        ? 'done'
        : id % 3 === 0
          ? 'running'
          : 'pending';
    return {
      projectId: project.id,
      projectName: long
        ? `${project.name} project with an intentionally long name for one-line truncation`
        : project.name,
      card: card(id, status, long),
    };
  });
  const selectedCard = params.has('card')
    ? (items.find((item) => item.card.id === Number(params.get('card'))) ?? null)
    : null;
  const pending = items.filter((item) => item.card.agentStatus === 'pending');
  const running = items.filter((item) => item.card.agentStatus === 'running');
  const done = items.filter((item) => item.card.cardStatus === 'done');
  const selectedTab = params.get('tab') === 'history' ? 'history' : 'body';
  return {
    projects: [project],
    scope: scope === 'all' ? 'all' : project.id,
    summary: { pending: pending.length, running: running.length, done: done.length },
    pending,
    running,
    done,
    selectedCard,
    body: selectedCard?.card.description ?? null,
    history: selectedCard?.card.history ?? null,
    tab: selectedTab,
    freshness: {
      state: 'fresh',
      lastFetchedAt: '2026-10-11T01:00:00Z',
      failedProjectIds: [],
      snapshotProblems: [],
    },
    readResolvers: unconnectedMonitorReadResolvers,
    onScopeChange: () => undefined,
    onCardSelect: (projectId, cardId) => {
      window.history.pushState(null, '', `?scope=${projectId}&card=${cardId}&tab=body`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    onCloseCard: () => {
      window.history.pushState(null, '', `?scope=${scope}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    onTabChange: (tab) => {
      const next = new URL(window.location.href);
      next.searchParams.set('tab', tab);
      window.history.replaceState(null, '', next);
    },
    onRefresh: () => undefined,
  };
}
