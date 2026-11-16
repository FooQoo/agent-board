/** Props of the onboarding view parts. The controller owns the timers and the step order. */

export interface OnboardingWelcomeProps {
  onStart: () => void;
  onSkip: () => void;
}

export interface OnboardingCompleteProps {
  onFinish: () => void;
}

export interface OnboardingGuidePanelProps {
  /** 1-based index of the explanation; the guide has a fixed number of explanations. */
  index: number;
  total: number;
  title: string;
  body: string;
  /** The line beside the action, such as "Read the note, then continue." */
  hint: string;
  /** Shown instead of the action while the card waits for the user's answer. */
  waitingBadge?: string;
  actionLabel: string;
  /** The action waits for the running card to be on screen long enough. */
  actionDisabled?: boolean;
  onAction: () => void;
  onExit: () => void;
  /**
   * A slim strip with the step and the waiting state only. The phone shows it at the top of the
   * screen while the answer sheet is open, so the sheet keeps the room.
   */
  compact?: boolean;
}
