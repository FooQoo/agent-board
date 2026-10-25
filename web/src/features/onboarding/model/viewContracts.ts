/** Props shared by the onboarding view parts. The controller owns the timers, the API calls and the step order. */

export interface OnboardingActionState {
  /** A save or a transition is in flight; the controls are disabled and show progress. */
  busy: boolean;
  /** A short, user-facing message for a failed save. The step keeps its input and offers Retry. */
  error: string | null;
}

export interface OnboardingWelcomeProps extends OnboardingActionState {
  onStart: () => void;
  onSkip: () => void;
}

export interface OnboardingCompleteProps extends OnboardingActionState {
  onFinish: () => void;
}

export interface OnboardingGuidePanelProps extends OnboardingActionState {
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
  /** The action waits for the running card to be on screen long enough; busy also disables it. */
  actionDisabled?: boolean;
  onAction: () => void;
  onExit: () => void;
}
