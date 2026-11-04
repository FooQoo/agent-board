import { AcceptanceTabView } from '../../../features/tasks/detail/AcceptanceTabView';
import { HistoryTimeline } from '../../../features/tasks/history/HistoryTimeline';
import type { Problem } from '../../../shared/api/contracts';
import { useTaskDetail } from '../../../shared/data/react';
import type { MonitorReadResolvers, MonitorTask } from '../contracts';
import { attachmentResolver } from './attachment-resolver';
import { MonitorDocument } from './MonitorDocument';
import { MonitorSection } from './MonitorSection';

interface TabProps {
  item: MonitorTask;
}

/** The body tab. */
export function TaskBodyTab({
  item,
  resolvers,
  scrollParent,
  problems,
}: TabProps & {
  resolvers: MonitorReadResolvers;
  scrollParent: HTMLElement | null;
  problems: readonly Problem[];
}) {
  const detail = useTaskDetail(item.projectId, item.task.id);
  return (
    <MonitorSection snapshot={detail.document} onRetry={() => void detail.refresh()}>
      {(document, arriving) => (
        <MonitorDocument
          blocks={document.blocks}
          scrollParent={scrollParent}
          isStreaming={arriving}
          problems={problems}
          resolveAttachment={attachmentResolver((id) =>
            resolvers.attachmentUrl(item.projectId, item.task.id, id),
          )}
        />
      )}
    </MonitorSection>
  );
}

/**
 * The conditions tab: they come with the `document` section, which the body tab shares. The person can
 * check and uncheck them here, as on the board.
 */
export function TaskAcceptanceTab({
  item,
  resolvers,
}: TabProps & { resolvers: MonitorReadResolvers }) {
  const detail = useTaskDetail(item.projectId, item.task.id);
  const save = resolvers.setAcceptance;
  const toggle = save
    ? async (conditionId: string, done: boolean) => {
        await save(item.projectId, item.task.id, conditionId, done);
        void detail.refresh();
      }
    : undefined;
  return (
    <MonitorSection snapshot={detail.document} onRetry={() => void detail.refresh()}>
      {(document) => (
        <AcceptanceTabView
          task={{ acceptance: document.acceptance, acceptanceError: false }}
          onToggle={toggle}
        />
      )}
    </MonitorSection>
  );
}

/** The history tab. */
export function TaskHistoryTab({ item }: TabProps) {
  const detail = useTaskDetail(item.projectId, item.task.id);
  return (
    <MonitorSection snapshot={detail.history} onRetry={() => void detail.refresh()}>
      {(history) => <HistoryTimeline events={history.items} />}
    </MonitorSection>
  );
}
