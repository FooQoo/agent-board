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

/** The body tab: only the `document` section is read. */
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
  const detail = useTaskDetail(item.projectId, item.task.id, ['document']);
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

/** The conditions tab: they come with the `document` section, which the body tab shares. */
export function TaskAcceptanceTab({ item }: TabProps) {
  const detail = useTaskDetail(item.projectId, item.task.id, ['document']);
  return (
    <MonitorSection snapshot={detail.document} onRetry={() => void detail.refresh()}>
      {(document) => (
        <AcceptanceTabView task={{ acceptance: document.acceptance, acceptanceError: false }} />
      )}
    </MonitorSection>
  );
}

/** The history tab: only the `history` section is read. */
export function TaskHistoryTab({ item }: TabProps) {
  const detail = useTaskDetail(item.projectId, item.task.id, ['history']);
  return (
    <MonitorSection snapshot={detail.history} onRetry={() => void detail.refresh()}>
      {(history) => <HistoryTimeline events={history.items} />}
    </MonitorSection>
  );
}
