import { FilePenIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

/**
 * Tells that a card or an epic is a draft (read-only for agents) and lets a person finalize it.
 * The texts default to the card's; an epic passes its own.
 */
export function DraftBanner({
  busy,
  failed,
  onFinalize,
  label,
  description,
  finalizeLabel,
  errorText,
}: {
  busy: boolean;
  failed: boolean;
  onFinalize: () => void;
  label?: string;
  description?: string;
  finalizeLabel?: string;
  errorText?: string;
}) {
  const { t } = useTranslation();
  const heading = label ?? t('draft.label');
  return (
    <section className="detail__draft" aria-label={heading}>
      <p className="detail__banner-head">
        <FilePenIcon aria-hidden="true" />
        <span>{heading}</span>
      </p>
      <p className="detail__banner-text">{description ?? t('draft.description')}</p>
      {failed && (
        <p className="detail__error" role="alert">
          {errorText ?? t('detail.saveError')}
        </p>
      )}
      <Button type="button" size="s" className="detail-btn" disabled={busy} onClick={onFinalize}>
        {finalizeLabel ?? t('draft.finalize')}
      </Button>
    </section>
  );
}
