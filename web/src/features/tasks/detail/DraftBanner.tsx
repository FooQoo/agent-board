import { FilePenIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

/** Tells that the card is a draft (read-only for agents) and lets a person finalize it. */
export function DraftBanner({
  busy,
  failed,
  onFinalize,
}: {
  busy: boolean;
  failed: boolean;
  onFinalize: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="detail__draft" aria-label={t('draft.label')}>
      <p className="detail__banner-head">
        <FilePenIcon aria-hidden="true" />
        <span>{t('draft.label')}</span>
      </p>
      <p className="detail__banner-text">{t('draft.description')}</p>
      {failed && (
        <p className="detail__error" role="alert">
          {t('detail.saveError')}
        </p>
      )}
      <Button type="button" className="detail-btn" disabled={busy} onClick={onFinalize}>
        {t('draft.finalize')}
      </Button>
    </section>
  );
}
