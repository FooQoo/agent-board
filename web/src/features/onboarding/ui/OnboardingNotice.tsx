import { ArchiveIcon } from 'lucide-react';
import './onboarding.css';

/** A short confirmation that the two samples have been archived, shown on the board after the guide. */
export function OnboardingNotice({
  message,
  inline = false,
}: {
  message: string;
  /** On the phone the notice sits in the screen's flow, between the count tiles and the lanes. */
  inline?: boolean;
}) {
  return (
    <div
      role="status"
      className={inline ? 'onboarding-notice onboarding-notice--inline' : 'onboarding-notice'}
    >
      <ArchiveIcon className="onboarding-notice__icon" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
