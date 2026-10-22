import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownBlocks } from '../../../shared/markdown/MarkdownBlocks';
import type { MarkdownBlockData } from '../../../shared/markdown/model/blocks';
import type { DetailBlock } from '../../../shared/data/core';
import type { Problem } from '../../../shared/api/contracts';

/** The blocks of a Detail stream as the Markdown renderer takes them. */
export function markdownBlocksOf(blocks: readonly DetailBlock[]): MarkdownBlockData[] {
  return blocks.map((block, index) => ({
    id: String(index),
    kind: block.kind,
    source: block.text,
    ...(block.images ? { images: block.images } : {}),
  }));
}

/** Mobile reading content, independent of the desktop detail layout. */
export function MonitorDocument({
  blocks,
  scrollParent,
  isStreaming = false,
  resolveAttachment,
  problems = [],
}: {
  blocks: readonly DetailBlock[];
  /** The panel that scrolls the document; a long document is drawn only near the viewport. */
  scrollParent: HTMLElement | null;
  isStreaming?: boolean;
  /** The address of an attachment named by ID, or null when there is none. */
  resolveAttachment(id: string): string | null;
  problems?: readonly Problem[];
}) {
  const { t } = useTranslation();
  const data = useMemo(() => markdownBlocksOf(blocks), [blocks]);
  return (
    <article className="monitor-document">
      {problems.map((problem) => (
        <p role="status" key={`${problem.file}:${problem.field}`}>
          {t('acceptance.unreadableProblem', {
            file: problem.file,
            field: problem.field,
            reason: problem.reason,
          })}
        </p>
      ))}
      {data.length > 0 ? (
        <MarkdownBlocks
          blocks={data}
          scrollParent={scrollParent}
          isStreaming={isStreaming}
          resolveAttachment={resolveAttachment}
        />
      ) : isStreaming ? null : (
        <p>{t('detail.noDescription')}</p>
      )}
    </article>
  );
}
