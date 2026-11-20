import { ArrowLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WriteError } from '@/shared/api/writeErrors';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner/Spinner';

/** How a failed write is told: a conflict (409) is the question changing under the person. */
export function failureKey(error: unknown): 'conflict' | 'gone' | 'failed' {
  if (error instanceof WriteError && error.status === 409) return 'conflict';
  if (error instanceof WriteError && error.status === 404) return 'gone';
  return 'failed';
}

export function DetailState({
  state,
  onReload,
}: {
  state: 'loading' | 'failed';
  onReload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="message-detail__state" role={state === 'failed' ? 'alert' : undefined}>
      {state === 'failed' ? (
        <>
          <p>{t('messages.detail.loadFailed')}</p>
          <Button type="button" variant="outline" size="s" onClick={onReload}>
            {t('messages.detail.reload')}
          </Button>
        </>
      ) : (
        <Spinner label={t('messages.detail.loading')} />
      )}
    </div>
  );
}

export function BackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="s"
      className="message-detail__back"
      onClick={onBack}
    >
      <ArrowLeftIcon aria-hidden="true" />
      {t('messages.detail.back')}
    </Button>
  );
}
