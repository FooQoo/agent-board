import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { residentGuideUrl } from '../guideUrl';
import type { Locale } from '@/shared/i18n';

/** One line and a link to the user guide: the warning is always visible and not expandable. */
export function ResidentNotice() {
  const { t, i18n } = useTranslation();
  const locale: Locale = i18n.resolvedLanguage === 'ja' ? 'ja' : 'en';
  return (
    <p className="resident-notice" role="note">
      <TriangleAlertIcon aria-hidden="true" />
      <span>
        {t('resident.noticeText')}{' '}
        <a href={residentGuideUrl(locale)} target="_blank" rel="noopener noreferrer">
          {t('resident.noticeLink')}
        </a>
      </span>
    </p>
  );
}
