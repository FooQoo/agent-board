import { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Problem, ProjectId } from '../../../shared/api/contracts';
import type { DocumentData, SectionSnapshot } from '../../../shared/data/core';
import { preloadable } from '../../../shared/lib/lazy/preloadable';
import { DetailAttachments } from './DetailAttachments';
import { DetailSectionView } from './DetailSection';
import { markdownBlocksOf } from './markdownBlocks';
import { ProblemNotice } from './ProblemNotice';
import './detail.css';

/** The Markdown renderer (parser, GitHub extensions and Mermaid loader) loads after the board is shown. */
const blocksView = preloadable(() =>
  import('../../../shared/markdown/MarkdownBlocks').then((module) => module.MarkdownBlocks),
);

/** Fetches the renderer; a failed fetch is tried again when a description is first shown. */
export function preloadDocumentBlocks(): Promise<unknown> {
  return blocksView.preload();
}

/** The text of a document with its images; `attachmentUrl` names the owner's images. */
export function DocumentBlocks({
  document,
  arriving,
  attachmentUrl,
  scrollParent,
}: {
  document: DocumentData;
  arriving: boolean;
  attachmentUrl: (id: string) => string;
  scrollParent: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const blocks = useMemo(() => markdownBlocksOf(document.blocks), [document.blocks]);
  // While the document is arriving its attachment list may not be here yet: an ID is then taken as an image.
  const known = document.attachments;
  const resolve = (id: string) =>
    known === undefined || known.some((item) => item.id === id) ? attachmentUrl(id) : null;
  if (blocks.length === 0) {
    return arriving ? null : <p className="md-empty">{t('detail.noDescription')}</p>;
  }
  return (
    <Suspense
      fallback={<p className="md-pending">{document.blocks.map((block) => block.text).join('')}</p>}
    >
      <blocksView.Component
        blocks={blocks}
        scrollParent={scrollParent}
        isStreaming={arriving}
        resolveAttachment={resolve}
        chapterHeadings
      />
    </Suspense>
  );
}

export function BodyDocumentView({
  document,
  onRetry,
  acceptanceError,
  problems = [],
  attachmentUrl,
  projectId,
  taskId,
  scrollParent,
}: {
  document: SectionSnapshot<'document'>;
  onRetry: () => void;
  acceptanceError: boolean;
  problems?: readonly Problem[];
  attachmentUrl: (id: string) => string;
  projectId: ProjectId;
  taskId: number;
  scrollParent: HTMLElement | null;
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
      <DetailSectionView snapshot={document} onRetry={onRetry}>
        {(data, arriving) => (
          <>
            <DocumentBlocks
              document={data}
              arriving={arriving}
              attachmentUrl={attachmentUrl}
              scrollParent={scrollParent}
            />
            {!arriving && (
              <DetailAttachments
                projectId={projectId}
                taskId={taskId}
                attachments={[...(data.attachments ?? [])]}
                attachmentUrl={attachmentUrl}
              />
            )}
          </>
        )}
      </DetailSectionView>
    </>
  );
}
