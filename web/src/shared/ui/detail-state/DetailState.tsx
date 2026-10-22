import { AlertCircleIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import './DetailState.css';

/**
 * The detail view while its body is loading. The frame (title, tabs) is given as `frame` and shown at once;
 * only the body is replaced by placeholder lines. The placeholder is announced as one busy status.
 */
export function DetailSkeleton({ frame, lines = 6 }: { frame?: ReactNode; lines?: number }) {
  const { t } = useTranslation();
  return (
    <div className="detail-state detail-state--loading" aria-busy="true">
      {frame}
      <div className="detail-state__body" role="status" aria-label={t('dataLayerDetail.loading')}>
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className="detail-state__line"
            aria-hidden="true"
            // The last line is shorter, like the end of a paragraph.
            style={{ width: index === lines - 1 ? '58%' : `${96 - ((index * 7) % 18)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** A note above a document that is still arriving: what is shown is the start of it. */
export function DetailPartialNotice() {
  const { t } = useTranslation();
  return (
    <p className="detail-state__partial" role="status">
      <LoaderCircleIcon className="detail-state__spinner" aria-hidden="true" />
      <span>{t('dataLayerDetail.partial')}</span>
    </p>
  );
}

/** The detail could not be read: what happened in one line, and a button to try again. */
export function DetailError({
  message,
  onRetry,
  retrying = false,
}: {
  /** The reason, when one is known. */
  message?: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="detail-state detail-state--error" role="alert">
      <AlertCircleIcon className="detail-state__icon" aria-hidden="true" />
      <div className="detail-state__text">
        <strong>{t('dataLayerDetail.errorTitle')}</strong>
        {message !== undefined && message !== '' && <span>{message}</span>}
      </div>
      <Button type="button" variant="outline" size="s" disabled={retrying} onClick={onRetry}>
        {t('dataLayerDetail.retry')}
      </Button>
    </div>
  );
}
