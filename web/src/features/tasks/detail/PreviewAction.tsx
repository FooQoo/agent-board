import { Maximize2Icon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface PreviewActionProps {
  onPreview: () => void;
  disabled?: boolean;
}

/** The toolbar button that opens the task in the preview dialog. */
export function PreviewAction({ onPreview, disabled = false }: PreviewActionProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="detail__tool detail__tool--text"
      aria-label={t('detail.openTaskFullscreen')}
      title={t('detail.openTaskFullscreen')}
      disabled={disabled}
      onClick={onPreview}
    >
      <Maximize2Icon aria-hidden="true" />
      {t('detail.openFullscreen')}
    </button>
  );
}
