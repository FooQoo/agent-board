import { FilePenIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Read-only draft status without the PC finalization control. */
export function DraftStatus() {
  const { t } = useTranslation();
  return (
    <section className="detail__draft" aria-label={t('draft.label')}>
      <p className="detail__banner-head">
        <FilePenIcon aria-hidden="true" />
        <span>{t('draft.label')}</span>
      </p>
      <p className="detail__banner-text">{t('draft.description')}</p>
    </section>
  );
}
