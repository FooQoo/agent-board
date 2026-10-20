import { DetailAttachments } from './DetailAttachments';
import { LazyMarkdownSections } from '../../../shared/markdown/LazyMarkdownSections';
import { ProblemNotice } from './ProblemNotice';
import { useTranslation } from 'react-i18next';
import type { Attachment, Problem, ProjectId } from '../../../shared/api/contracts';
import './detail.css';

export function BodyDocumentView({
  body,
  acceptanceError,
  problems = [],
  attachments,
  attachmentUrl,
  projectId,
  taskId,
}: {
  body: string;
  acceptanceError: boolean;
  problems?: readonly Problem[];
  attachments: readonly Attachment[];
  attachmentUrl: (id: string) => string;
  projectId?: ProjectId;
  taskId?: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ProblemNotice problems={acceptanceError ? [] : problems} />
      {acceptanceError && (
        <div className="acceptance-unreadable" role="status">
          <p className="acceptance-unreadable__title">{t('acceptance.unreadableTitle')}</p>
          {problems.map((problem) => (
            <p key={`${problem.file}:${problem.field}`} className="acceptance-unreadable__problem">
              {t('acceptance.unreadableProblem', {
                file: problem.file,
                field: problem.field,
                reason: problem.reason,
              })}
            </p>
          ))}
          <p className="acceptance-unreadable__note">{t('acceptance.unreadableNote')}</p>
        </div>
      )}
      <LazyMarkdownSections
        source={body}
        resolveAttachment={(id) =>
          attachments.some((item) => item.id === id) ? attachmentUrl(id) : null
        }
      />
      {projectId !== undefined && taskId !== undefined ? (
        <DetailAttachments
          projectId={projectId}
          taskId={taskId}
          attachments={[...attachments]}
          attachmentUrl={attachmentUrl}
        />
      ) : null}
    </>
  );
}
