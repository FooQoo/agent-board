import { useTranslation } from 'react-i18next';
import { CircleCheckIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import type { OnboardingCompleteProps } from '../model/viewContracts';
import { DIALOG_TITLE_CLASS, WELCOME_DIALOG_CLASS } from './dialog-classes';
import './onboarding.css';

/** The last screen: what the user has tried, and the finish action that archives the two samples. */
export function OnboardingComplete({ busy, error, onFinish }: OnboardingCompleteProps) {
  const { t } = useTranslation();
  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-[rgb(15_23_42/0.62)]"
        className={WELCOME_DIALOG_CLASS}
        aria-busy={busy}
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
        <p className="onboarding-dialog__note">{t('onboarding.complete.archiveNote')}</p>
        {error ? (
          <p role="alert" className="onboarding-dialog__error">
            {error}
          </p>
        ) : null}
        <div className="onboarding-dialog__actions mt-5">
          <Button size="m" disabled={busy} onClick={onFinish}>
            {error ? t('onboarding.guide.retry') : t('onboarding.complete.finish')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
