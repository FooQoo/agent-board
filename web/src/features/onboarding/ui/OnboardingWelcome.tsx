import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SparklesIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import type { OnboardingWelcomeProps } from '../model/viewContracts';
import { DIALOG_TITLE_CLASS, WELCOME_DIALOG_CLASS } from './dialog-classes';
import './onboarding.css';

/** The first screen: what the guide does, what it creates, and the choice to start or skip. */
export function OnboardingWelcome({ onStart, onSkip }: OnboardingWelcomeProps) {
  const { t } = useTranslation();
  const startRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        overlayClassName="onboarding-overlay"
        className={`onboarding-dialog onboarding-dialog--card ${WELCOME_DIALOG_CLASS}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          startRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onSkip();
        }}
      >
        <SparklesIcon className="onboarding-dialog__icon" aria-hidden="true" />
        <DialogTitle className={`onboarding-dialog__title ${DIALOG_TITLE_CLASS}`}>
          {t('onboarding.welcome.title')}
        </DialogTitle>
        <DialogDescription className="onboarding-dialog__body">
          {t('onboarding.welcome.body')}
        </DialogDescription>
        <ol className="onboarding-dialog__points">
          <li>
            <span aria-hidden="true">1 </span>
            {t('onboarding.welcome.stepWatch')}
          </li>
          <li>
            <span aria-hidden="true">2 </span>
            {t('onboarding.welcome.stepAnswer')}
          </li>
        </ol>
        <div className="onboarding-dialog__actions mt-5">
          <Button variant="outline" size="m" onClick={onSkip}>
            {t('onboarding.welcome.skip')}
          </Button>
          <Button ref={startRef} size="m" onClick={onStart}>
            {t('onboarding.welcome.start')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
