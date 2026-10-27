import '@/shared/i18n/preview-feature-strings';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import type { PreviewFeature } from './feature-stage';

export interface PreviewBadgeProps {
  feature: PreviewFeature;
  /**
   * The badge sits inside a title, so the title's accessible name stays the feature's name. The
   * notice beside it says the same thing in words.
   */
  decorative?: boolean;
}

/** The small "Public preview" label next to the title of a preview feature. */
export function PreviewBadge({ feature, decorative = false }: PreviewBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge
      variant="outline"
      data-preview-feature={feature}
      aria-hidden={decorative ? true : undefined}
    >
      {t('previewFeature.badge')}
    </Badge>
  );
}
