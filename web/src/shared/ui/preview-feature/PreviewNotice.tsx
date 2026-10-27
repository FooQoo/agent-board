import '@/shared/i18n/preview-feature-strings';
import { Trans, useTranslation } from 'react-i18next';
import { isLocale } from '@/shared/i18n';
import { featureStagesUrl, type PreviewFeature } from './feature-stage';

export interface PreviewNoticeProps {
  feature: PreviewFeature;
  className?: string;
}

/** One sentence that says the feature is in public preview, with the documentation link. */
export function PreviewNotice({ feature, className }: PreviewNoticeProps) {
  const { t, i18n } = useTranslation();
  const locale = isLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en';
  return (
    <p
      data-preview-feature={feature}
      className={`m-0 text-xs leading-[1.6] text-(--r-text2) [overflow-wrap:anywhere] ${className ?? ''}`}
    >
      <Trans
        i18nKey="previewFeature.notice"
        components={{
          doc: (
            <a
              href={featureStagesUrl(feature, locale)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--r-accent) underline underline-offset-2"
            >
              {t('previewFeature.link')}
            </a>
          ),
        }}
      />
    </p>
  );
}
