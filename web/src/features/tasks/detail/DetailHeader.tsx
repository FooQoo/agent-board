import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Shared identity, actions, and close control for task, archive, and epic details. */
export function DetailHeader({
  identity,
  identityClassName = '',
  toolbar,
  onClose,
}: {
  identity: ReactNode;
  identityClassName?: string;
  toolbar?: ReactNode;
  onClose(): void;
}) {
  const { t } = useTranslation();
  return (
    <div className="detail__top">
      <span className={`detail__id ${identityClassName}`.trim()}>{identity}</span>
      {toolbar}
      <button
        type="button"
        className="detail__close"
        aria-label={t('detail.close')}
        onClick={onClose}
      >
        <XIcon aria-hidden="true" />
      </button>
    </div>
  );
}
