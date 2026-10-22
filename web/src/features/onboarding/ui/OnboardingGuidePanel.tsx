import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import type { OnboardingGuidePanelProps } from '../model/viewContracts';
import './onboarding.css';

/**
 * One explanation of the guide, anchored under the spotlight. The panel is not a dialog: the stage
 * around it is, so Escape is handled once, by the stage.
 */
export function OnboardingGuidePanel({
  index,
  total,
  title,
  body,
  hint,
  waitingBadge,
  actionLabel,
  actionDisabled = false,
  busy,
  error,
  onAction,
  onExit,
}: OnboardingGuidePanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  // Keyboard focus follows the guide: once a step is ready, focus moves to its action, so Tab starts there.
  useEffect(() => {
    if (busy) return;
    const target = actionRef.current && !actionDisabled ? actionRef.current : panelRef.current;
    target?.focus();
  }, [busy, actionDisabled]);
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="onboarding-panel"
      aria-live="polite"
      aria-busy={busy}
    >
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
          <Button ref={actionRef} size="m" disabled={busy || actionDisabled} onClick={onAction}>
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
