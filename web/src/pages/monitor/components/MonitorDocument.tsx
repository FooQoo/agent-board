import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownView } from '../../../shared/markdown/MarkdownView';
import { Lightbox } from '../../../shared/ui/lightbox/Lightbox';
import type { Attachment, Problem } from '../../../shared/api/contracts';

/** Mobile reading content, independent of the desktop detail layout. */
export function MonitorDocument({
  body,
  acceptanceError,
  attachments,
  attachmentUrl,
  problems = [],
}: {
  body: string;
  acceptanceError: boolean;
  attachments: readonly Attachment[];
  attachmentUrl(id: string): string;
  problems?: readonly Problem[];
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Attachment | null>(null);
  return (
    <article className="monitor-document">
      {acceptanceError && <p role="status">{t('acceptance.unreadableTitle')}</p>}
      {problems.map((problem) => (
        <p role="status" key={`${problem.file}:${problem.field}`}>
          {t('acceptance.unreadableProblem', {
            file: problem.file,
            field: problem.field,
            reason: problem.reason,
          })}
        </p>
      ))}
      {body.trim() ? (
        <MarkdownView
          source={body}
          resolveAttachment={(id) =>
            attachments.some((item) => item.id === id) ? attachmentUrl(id) : null
          }
        />
      ) : (
        <p>{t('detail.noDescription')}</p>
      )}
      {attachments.length > 0 && (
        <section aria-label={t('editor.attachmentsLabel')}>
          <h3>
            {t('editor.attachments')} · {attachments.length}
          </h3>
          <div className="monitor-document__images">
            {attachments.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-label={t('editor.previewAttachment', { name: item.name })}
                onClick={() => setPreview(item)}
              >
                <img src={attachmentUrl(item.id)} alt={item.name} loading="lazy" />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {preview && (
        <Lightbox label={preview.name} onClose={() => setPreview(null)}>
          <img src={attachmentUrl(preview.id)} alt={preview.name} />
        </Lightbox>
      )}
    </article>
  );
}
