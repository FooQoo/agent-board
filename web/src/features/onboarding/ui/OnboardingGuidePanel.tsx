import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import type { OnboardingGuidePanelProps } from '../model/viewContracts';
import './onboarding.css';

/**
 * One explanation of the guide, anchored under the spotlight. The panel is not a dialog: the stage
 * around it is, so Escape and focus are handled once, by the stage.
 */
export function OnboardingGuidePanel({
  index,
  total,
  title,
  body,
  hint,
  waitingBadge,
  actionLabel,
  busy,
  error,
  onAction,
  onExit,
}: OnboardingGuidePanelProps) {
  const { t } = useTranslation();
  return (
    <section className="onboarding-panel" aria-live="polite" aria-busy={busy}>
      <div className="onboarding-panel__head">
        <span className="onboarding-panel__step">
          {t('onboarding.guide.step', { current: index, total })}
        </span>
        <button type="button" className="onboarding-panel__exit" disabled={busy} onClick={onExit}>
          {t('onboarding.guide.exit')}
        </button>
      </div>
      <h2 className="onboarding-panel__title">{title}</h2>
      <p className="onboarding-panel__body">{body}</p>
      <div
        className={
          waitingBadge
            ? 'onboarding-panel__foot'
            : 'onboarding-panel__foot onboarding-panel__foot--action'
        }
      >
        <span className="onboarding-panel__hint">{hint}</span>
        {waitingBadge ? (
          <span className="onboarding-panel__badge">{waitingBadge}</span>
        ) : (
          <Button size="m" disabled={busy} onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="onboarding-panel__error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
