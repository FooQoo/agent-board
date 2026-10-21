import { ArchiveIcon } from 'lucide-react';
import './onboarding.css';

/** A short confirmation that the two samples have been archived, shown on the board after the guide. */
export function OnboardingNotice({ message }: { message: string }) {
  return (
    <div role="status" className="onboarding-notice">
      <ArchiveIcon className="onboarding-notice__icon" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
