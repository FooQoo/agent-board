import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownView } from '../../components/markdown/MarkdownView';
import { Lightbox } from '../../components/Lightbox';
import type { AcceptanceItem, Attachment, EvidenceRecord, Problem } from '../../types';

/** Mobile reading content, independent of the desktop detail layout. */
export function MonitorDocument({
  body,
  acceptance,
  acceptanceError,
  attachments,
  evidence,
  attachmentUrl,
  evidenceUrl,
  problems = [],
}: {
  body: string;
  acceptance: readonly AcceptanceItem[];
  acceptanceError: boolean;
  attachments: readonly Attachment[];
  evidence: readonly EvidenceRecord[];
  attachmentUrl(id: string): string;
  evidenceUrl?: (id: string) => string;
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
      {!acceptanceError && acceptance.length > 0 && (
        <section className="monitor-document__acceptance" aria-label={t('acceptance.title')}>
          <h3>{t('acceptance.title')}</h3>
          <p>
            {t('acceptance.progress', {
              done: acceptance.filter((item) => item.done).length,
              total: acceptance.length,
            })}
          </p>
          <ul>
            {acceptance.map((item) => (
              <li key={item.id}>
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled
                  readOnly
                  aria-label={item.text}
                />
                <span>{item.id}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
      {evidence.length > 0 && (
        <section aria-label={t('monitor.evidence')}>
          <h3>{t('monitor.evidence')}</h3>
          <ul>
            {evidence.map((item) => (
              <li key={item.id}>
                {evidenceUrl ? (
                  <a href={evidenceUrl(item.id)} target="_blank" rel="noreferrer">
                    {item.name}
                  </a>
                ) : (
                  item.name
                )}
              </li>
            ))}
          </ul>
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
