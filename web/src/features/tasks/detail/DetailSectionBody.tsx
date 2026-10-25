import type { ReactNode } from 'react';
import type { DetailSection as SectionName } from '../../../shared/data/api';
import type { SectionDataMap, SectionSnapshot } from '../../../shared/data/core';
import {
  DetailError,
  DetailPartialNotice,
  DetailSkeleton,
} from '../../../shared/ui/detail-state/DetailState';

/**
 * One section of a Detail as the data layer holds it: a skeleton until the first part arrives, the
 * start of the document with a note while it is still arriving, the whole document, or a failure
 * with a retry. A failed refresh keeps showing the last whole version.
 */
export function DetailSectionBody<S extends SectionName>({
  snapshot,
  onRetry,
  children,
}: {
  snapshot: SectionSnapshot<S>;
  onRetry(): void;
  children(data: SectionDataMap[S], arriving: boolean): ReactNode;
}) {
  const arriving = snapshot.data === null;
  const data = snapshot.data ?? snapshot.partial;
  if (arriving && snapshot.state === 'error') return <DetailError onRetry={onRetry} />;
  if (data === null) return <DetailSkeleton />;
  return (
    <>
      {arriving && <DetailPartialNotice />}
      {children(data, arriving)}
    </>
  );
}
