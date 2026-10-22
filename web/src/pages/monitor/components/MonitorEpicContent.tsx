import { useTranslation } from 'react-i18next';
import { useEpicDetail } from '../../../shared/data/react';
import { monitorErrorStatus } from '../client';
import type { MonitorReadResolvers } from '../contracts';
import { attachmentResolver } from './attachment-resolver';
import { MonitorDocument } from './MonitorDocument';
import { MonitorSection } from './MonitorSection';

/**
 * The epic tab. It is mounted only while the tab is active, so the epic's document is read the
 * first time the tab is reached and reused afterwards.
 */
export function MonitorEpicContent({
  projectId,
  epicId,
  resolvers,
  scrollParent,
}: {
  projectId: string;
  epicId: string | null;
  resolvers: MonitorReadResolvers;
  scrollParent: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const detail = useEpicDetail(projectId, epicId);
  if (epicId === null)
    return <p className="monitor-drawer__notice">{t('monitor.epicNotAssigned')}</p>;
  const { error, data } = detail.document;
  if (monitorErrorStatus(error) === 404 && data === null) {
    return (
      <p className="monitor-drawer__notice" role="status">
        {t('monitor.epicNotFound')}
      </p>
    );
  }
  return (
    <MonitorSection snapshot={detail.document} onRetry={() => void detail.refresh()}>
      {(document, arriving) => (
        <MonitorDocument
          blocks={document.blocks}
          scrollParent={scrollParent}
          isStreaming={arriving}
          resolveAttachment={attachmentResolver((id) =>
            resolvers.epicAttachmentUrl(projectId, epicId, id),
          )}
        />
      )}
    </MonitorSection>
  );
}
