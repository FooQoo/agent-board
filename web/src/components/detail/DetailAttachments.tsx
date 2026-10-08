import { ImageOffIcon, Maximize2Icon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../ui/dialog';
import type { Attachment, ProjectId } from '../../types';

/** A card's complete image list, including images not referenced in its description. */
export function DetailAttachments({
  projectId,
  cardId,
  attachments,
}: {
  projectId: ProjectId;
  cardId: number;
  attachments: readonly Attachment[];
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState<Attachment | null>(null);
  const imageUrl = (id: string) => `/api/projects/${projectId}/cards/${cardId}/attachments/${id}`;
  if (attachments.length === 0) return null;
  return (
    <section className="detail-attachments" aria-label={t('editor.attachmentsLabel')}>
      <h3 className="detail-attachments__heading">
        {t('editor.attachments')} · {attachments.length}
      </h3>
      <div className="detail-attachments__list">
        {attachments.map((attachment) => (
          <div key={attachment.id} className="detail-attachments__tile">
            <button
              type="button"
              className="detail-attachments__preview"
              aria-label={t('editor.previewAttachment', { name: attachment.name })}
              onClick={() => setZoom(attachment)}
            >
              <AttachmentImage key={imageUrl(attachment.id)} url={imageUrl(attachment.id)} />
              <Maximize2Icon aria-hidden="true" />
            </button>
            <span className="detail-attachments__name" title={attachment.name}>
              {attachment.name}
            </span>
          </div>
        ))}
      </div>
      <Dialog
        open={zoom !== null}
        onOpenChange={(open) => {
          if (!open) setZoom(null);
        }}
      >
        {zoom && (
          <DialogContent
            className="detail-attachments__lightbox"
            showCloseButton={false}
            aria-describedby={undefined}
          >
            <DialogTitle className="visually-hidden">{zoom.name}</DialogTitle>
            <DialogClose
              className="detail-attachments__lightbox-close"
              aria-label={t('dialog.close')}
            >
              <XIcon aria-hidden="true" />
            </DialogClose>
            <img src={imageUrl(zoom.id)} alt={zoom.name} />
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}

function AttachmentImage({ url }: { url: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="detail-attachments__missing">
      <ImageOffIcon aria-hidden="true" />
      {t('markdown.noImage')}
    </span>
  ) : (
    <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  );
}
