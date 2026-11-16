import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheckIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import type { OnboardingCompleteProps } from '../model/viewContracts';
import { DIALOG_TITLE_CLASS, WELCOME_DIALOG_CLASS } from './dialog-classes';
import './onboarding.css';

/** The last screen: what the user has tried, and the finish action. */
export function OnboardingComplete({ onFinish }: OnboardingCompleteProps) {
  const { t } = useTranslation();
  const finishRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        overlayClassName="onboarding-overlay"
        className={`onboarding-dialog onboarding-dialog--card ${WELCOME_DIALOG_CLASS}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          finishRef.current?.focus();
        }}
      >
        <CircleCheckIcon
          className="onboarding-dialog__icon onboarding-dialog__icon--done"
          aria-hidden="true"
        />
        <DialogTitle className={`onboarding-dialog__title ${DIALOG_TITLE_CLASS}`}>
          {t('onboarding.complete.title')}
        </DialogTitle>
        <DialogDescription className="onboarding-dialog__body">
          {t('onboarding.complete.body')}
        </DialogDescription>
        <ul className="onboarding-dialog__points">
          <li>✓ {t('onboarding.complete.pointFlow')}</li>
          <li>✓ {t('onboarding.complete.pointDecision')}</li>
        </ul>
        <div className="onboarding-dialog__actions mt-5">
          <Button ref={finishRef} size="m" onClick={onFinish}>
            {t('onboarding.complete.finish')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
