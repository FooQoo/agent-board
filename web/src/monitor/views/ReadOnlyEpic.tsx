import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Lightbox } from '../../components/Lightbox';
import { MarkdownSections } from '../../components/markdown/MarkdownSections';
import type { Epic, ProjectId } from '../../types';
import type { MonitorReadResolvers } from '../contracts';

export function ReadOnlyEpic({
  epicId,
  projectId,
  resolvers,
  onClose,
}: {
  epicId: string | null;
  projectId: ProjectId | null;
  resolvers: MonitorReadResolvers;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const [epic, setEpic] = useState<Epic | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    if (!epicId || !projectId) {
      setEpic(null);
      setError(false);
      return;
    }
    const controller = new AbortController();
    setEpic(null);
    setError(false);
    void resolvers
      .getEpic(projectId, epicId, controller.signal)
      .then(setEpic)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [epicId, projectId, resolvers]);
  const open = epicId !== null && projectId !== null;
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
      >
        <DialogContent className="monitor-epic-dialog" aria-describedby={undefined}>
          <DialogTitle>{epic?.name ?? t('monitor.epic')}</DialogTitle>
          {error ? (
            <p role="alert">{t('monitor.epicError')}</p>
          ) : epic ? (
            <>
              <MarkdownSections
                source={epic.plan}
                resolveAttachment={(id) =>
                  epic.attachments.some((attachment) => attachment.id === id)
                    ? resolvers.epicAttachmentUrl(projectId as ProjectId, epic.id, id)
                    : null
                }
              />
              {epic.attachments.length > 0 && (
                <section className="detail-attachments" aria-label={t('editor.attachmentsLabel')}>
                  <h3 className="detail-attachments__heading">
                    {t('editor.attachments')} · {epic.attachments.length}
                  </h3>
                  <div className="detail-attachments__list">
                    {epic.attachments.map((attachment) => (
                      <button
                        key={attachment.id}
                        type="button"
                        className="detail-attachments__preview"
                        aria-label={t('editor.previewAttachment', { name: attachment.name })}
                        onClick={() => setZoom(attachment.id)}
                      >
                        <img
                          src={resolvers.epicAttachmentUrl(
                            projectId as ProjectId,
                            epic.id,
                            attachment.id,
                          )}
                          alt=""
                        />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <p role="status">{t('monitor.epicLoading')}</p>
          )}
        </DialogContent>
      </Dialog>
      {epic && zoom && (
        <Lightbox
          label={
            epic.attachments.find((attachment) => attachment.id === zoom)?.name ??
            t('markdown.image')
          }
          onClose={() => setZoom(null)}
        >
          <img
            src={resolvers.epicAttachmentUrl(projectId as ProjectId, epic.id, zoom)}
            alt={epic.attachments.find((attachment) => attachment.id === zoom)?.name ?? ''}
          />
        </Lightbox>
      )}
    </>
  );
}
