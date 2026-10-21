/*
 * Utility classes for the onboarding dialogs. The shared Dialog merges these with its own classes,
 * so each override replaces the matching default instead of competing with it.
 */

/** A 520px card centred 220px above the middle of the viewport, as in the approved PC mock. */
export const WELCOME_DIALOG_CLASS =
  'top-[calc(50%-220px)] translate-y-0 w-[520px] max-w-[calc(100%-2rem)] sm:max-w-[520px] gap-0 flex flex-col rounded-xl border-0 bg-(--r-surface) p-8 text-(--r-text) shadow-[0_20px_48px_rgb(15_23_42/0.24)]';

/** The guide stage fills the viewport and draws nothing of its own; the spotlight and the panel do. */
export const STAGE_DIALOG_CLASS =
  'inset-0 top-0 left-0 translate-x-0 translate-y-0 w-full h-full max-w-none gap-0 rounded-none border-0 bg-transparent p-0 shadow-none overflow-hidden sm:max-w-none';

export const DIALOG_TITLE_CLASS = 'text-[24px] leading-[1.3] font-semibold text-(--r-text)';
