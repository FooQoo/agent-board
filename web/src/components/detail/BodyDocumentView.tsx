import { AcceptanceView } from '../acceptance/AcceptanceView';
import { DetailAttachments } from './DetailAttachments';
import { DetailEvidence } from './DetailEvidence';
import { MarkdownSections } from '../markdown/MarkdownSections';
import { ProblemNotice } from './ProblemNotice';
import { useTranslation } from 'react-i18next';
import type { AcceptanceItem, Attachment, EvidenceRecord, Problem, ProjectId } from '../../types';
import '../../styles/detail.css';

export function BodyDocumentView({
  body,
  acceptance,
  acceptanceError,
  problems = [],
  attachments,
  evidence,
  attachmentUrl,
  evidenceUrl,
  projectId,
  cardId,
}: {
  body: string;
  acceptance: readonly AcceptanceItem[];
  acceptanceError: boolean;
  problems?: readonly Problem[];
  attachments: readonly Attachment[];
  evidence: readonly EvidenceRecord[];
  attachmentUrl: (id: string) => string;
  evidenceUrl?: (id: string) => string;
  projectId?: ProjectId;
  cardId?: number;
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
      <AcceptanceView items={acceptanceError ? [] : acceptance} />
      <MarkdownSections
        source={body}
        resolveAttachment={(id) =>
          attachments.some((item) => item.id === id) ? attachmentUrl(id) : null
        }
      />
      {projectId !== undefined && cardId !== undefined ? (
        <DetailAttachments
          projectId={projectId}
          cardId={cardId}
          attachments={[...attachments]}
          attachmentUrl={attachmentUrl}
        />
      ) : null}
      <DetailEvidence evidence={[...evidence]} evidenceUrl={evidenceUrl} />
    </>
  );
}
