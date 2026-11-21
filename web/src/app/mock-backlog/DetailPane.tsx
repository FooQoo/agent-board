import { PencilLineIcon, SendIcon, Undo2Icon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TaskDetailView } from '../../features/tasks/detail/TaskDetailView';
import {
  createDetailFixtureAdapter,
  type DetailFixture,
} from '../../features/tasks/detail/detailFixture';
import type { DetailTab } from '../../features/tasks/detail/DetailTabs';
import { EpicLabel } from '../../features/epics/label/EpicLabel';
import { Button } from '@/shared/ui/button';
import { DataProvider, useEpicDetail, useTaskDetail } from '../../shared/data/react';
import { type Fixture, type MockCard, PROJECT_ID, summaryOf } from './data';
import { useMockText } from './text';
import './backlog-mock.css';

function fixtureOf(fixture: Fixture, card: MockCard, history: string): DetailFixture {
  return {
    tasks: {
      [card.id]: {
        blocks: [card.body],
        acceptance: card.conditions,
        history: [{ at: '2026-11-21T08:00:00.000Z', reason: history }],
      },
    },
    epics: Object.fromEntries(
      fixture.epics.map((epic) => [epic.id, { blocks: [fixture.epicBody[epic.id] ?? ''] }]),
    ),
  };
}

function Body({
  fixture,
  card,
  tab,
  onTab,
  onClose,
  onToggleCondition,
  onEdit,
  onSend,
  onBack,
  onOpenEpic,
  statusLabels,
}: Omit<DetailPaneProps, 'history'>) {
  const m = useMockText();
  const { t } = useTranslation();
  const summary = summaryOf(card, fixture.epics);
  const detail = useTaskDetail(PROJECT_ID, card.id);
  const epicDetail = useEpicDetail(PROJECT_ID, card.epicId);
  const backlog = card.lane === 'backlog';
  return (
    <TaskDetailView
      projectId={PROJECT_ID}
      task={summary}
      document={detail.document}
      history={detail.history}
      epicDocument={epicDetail.document}
      tab={tab}
      onTabChange={onTab}
      onClose={onClose}
      epics={fixture.epics}
      statusLabels={statusLabels}
      readOnlyDraft={false}
      onToggleCondition={async (id, done) => onToggleCondition(id, done)}
      onOpenEpic={onOpenEpic}
      renderEpicLabel={(epic) => (
        <EpicLabel epic={epic} className="card__epic" onClick={() => onOpenEpic?.(epic.id)} />
      )}
      toolbar={
        <div
          className="detail__toolbar bdetail__toolbar"
          role="toolbar"
          aria-label={t('detail.toolbar')}
        >
          {backlog && (
            <>
              <Button type="button" size="s" variant="outline" onClick={onEdit}>
                <PencilLineIcon aria-hidden="true" />
                {m.edit}
              </Button>
              <Button type="button" size="s" onClick={onSend}>
                <SendIcon aria-hidden="true" />
                {m.sendCard}
              </Button>
            </>
          )}
          {card.lane === 'todo' && card.sent && (
            <Button type="button" size="s" variant="outline" onClick={onBack}>
              <Undo2Icon aria-hidden="true" />
              {m.backToBacklog}
            </Button>
          )}
        </div>
      }
    >
      {backlog ? (
        <div className="bdetail__banner" data-lane="backlog">
          <strong>{m.detailBacklogTitle}</strong>
          <p>{m.detailBacklogBody}</p>
          <p className="bdetail__tick">{m.detailTickNote}</p>
        </div>
      ) : (
        card.lane === 'todo' && (
          <div className="bdetail__banner" data-lane="todo">
            <strong>{m.detailTodoBanner}</strong>
          </div>
        )
      )}
    </TaskDetailView>
  );
}

export interface DetailPaneProps {
  fixture: Fixture;
  card: MockCard;
  history: string;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onClose: () => void;
  onToggleCondition: (conditionId: string, done: boolean) => void;
  onEdit: () => void;
  onSend: () => void;
  onBack: () => void;
  onOpenEpic: (epicId: string) => void;
  statusLabels?: 'pc' | 'monitor';
}

/**
 * The product's card detail (TaskDetailView with its tabs), reading the card from memory. The data
 * layer is re-created when the card's text changes, so a saved edit shows at once.
 */
export function DetailPane(props: DetailPaneProps) {
  const { fixture, card, history } = props;
  const version = JSON.stringify([card.id, card.title, card.body, card.conditions, history]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the version stands for the card's text
  const adapter = useMemo(
    () => createDetailFixtureAdapter(fixtureOf(fixture, card, history)),
    [version],
  );
  return (
    <DataProvider key={version} adapter={adapter}>
      <Body {...props} />
    </DataProvider>
  );
}
