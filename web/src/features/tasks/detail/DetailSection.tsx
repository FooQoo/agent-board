import { type ComponentType, type ReactNode, Suspense } from 'react';
import { preloadable } from '../../../shared/lib/lazy/preloadable';
import type { DetailSection as SectionName } from '../../../shared/data/api';
import type { SectionDataMap, SectionSnapshot } from '../../../shared/data/core';

interface SectionProps {
  snapshot: SectionSnapshot<SectionName>;
  onRetry(): void;
  children(data: SectionDataMap[SectionName], arriving: boolean): ReactNode;
}

/** The states of a section (skeleton, arriving note, failure) load after the board is shown. */
const body = preloadable(() =>
  import('./DetailSectionBody').then(
    (module) => module.DetailSectionBody as unknown as ComponentType<SectionProps>,
  ),
);

/** Fetches the section view; a failed fetch is tried again when a section is first shown. */
export function preloadDetailSection(): Promise<unknown> {
  return body.preload();
}

/**
 * One section of a Detail as the data layer holds it: a skeleton until the first part arrives, the
 * start of the document with a note while it is still arriving, the whole document, or a failure
 * with a retry. A failed refresh keeps showing the last whole version.
 */
export function DetailSectionView<S extends SectionName>({
  snapshot,
  onRetry,
  children,
}: {
  snapshot: SectionSnapshot<S>;
  onRetry(): void;
  children(data: SectionDataMap[S], arriving: boolean): ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <body.Component
        snapshot={snapshot as unknown as SectionSnapshot<SectionName>}
        onRetry={onRetry}
      >
        {children as SectionProps['children']}
      </body.Component>
    </Suspense>
  );
}
