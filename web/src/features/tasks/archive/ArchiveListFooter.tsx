import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner/Spinner';
import './ArchiveListFooter.css';

export interface ArchiveListFooterProps {
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  onRetry: () => void;
  /** The class of the footer's box, so the PC list and the phone sheet each place it. */
  className?: string;
}

/** Under the last row: loading the next page, the failure with a retry, or the end of the list. */
export function ArchiveListFooter({
  hasMore,
  loadingMore,
  loadMoreFailed,
  onRetry,
  className,
}: ArchiveListFooterProps) {
  const { t } = useTranslation();
  const box = className ? `archive-footer ${className}` : 'archive-footer';
  if (loadMoreFailed) {
    return (
      <div className={box} role="alert">
        <p>{t('archive.loadMoreError')}</p>
        <Button type="button" variant="outline" onClick={onRetry}>
          {t('archive.retry')}
        </Button>
      </div>
    );
  }
  if (loadingMore || hasMore) {
    return (
      <div className={box}>
        <Spinner size="sm" label={t('archive.loadingMore')} />
      </div>
    );
  }
  return (
    <p className={box} data-testid="archive-end">
      {t('archive.end')}
    </p>
  );
}
