import { useTranslation } from 'react-i18next';
import { MonitorDocument } from './MonitorDocument';
import type { Epic } from '../../../shared/api/contracts';
import type { MonitorReadResolvers } from '../contracts';
import type { EpicReadState } from '../hooks/useMonitorDetailDrawer';

export function MonitorEpicContent({
  state,
  retry,
  projectId,
  resolvers,
}: {
  state: EpicReadState;
  retry(): void;
  projectId: string;
  resolvers: MonitorReadResolvers;
}) {
  const { t } = useTranslation();
  if (state.status === 'idle')
    return <p className="monitor-drawer__notice">{t('monitor.epicNotAssigned')}</p>;
  if (state.status === 'loading')
    return (
      <p className="monitor-drawer__notice" role="status">
        {t('monitor.epicLoading')}
      </p>
    );
  if (state.status === 'not-found')
    return (
      <p className="monitor-drawer__notice" role="status">
        {t('monitor.epicNotFound')}
      </p>
    );
  if (state.status === 'error') {
    return (
      <div className="monitor-drawer__notice" role="alert">
        <p>{t('monitor.epicError')}</p>
        <button type="button" className="monitor-drawer__retry" onClick={retry}>
          {t('monitor.retry')}
        </button>
      </div>
    );
  }
  return (
    <>
      {state.status === 'partial' && (
        <p className="monitor-drawer__partial" role="status">
          {t('monitor.epicPartial')}
        </p>
      )}
      <EpicDocument epic={state.epic} projectId={projectId} resolvers={resolvers} />
    </>
  );
}

function EpicDocument({
  epic,
  projectId,
  resolvers,
}: {
  epic: Epic;
  projectId: string;
  resolvers: MonitorReadResolvers;
}) {
  return (
    <MonitorDocument
      body={epic.body}
      acceptanceError={false}
      attachments={epic.attachments ?? []}
      evidence={[]}
      attachmentUrl={(id) => resolvers.epicAttachmentUrl(projectId, epic.id, id)}
    />
  );
}
