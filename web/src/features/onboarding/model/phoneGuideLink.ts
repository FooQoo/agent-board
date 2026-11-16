// What the first-run guide and the phone screen tell each other. The guide lives above the width
// switch, so one controller serves both layouts; the phone screen owns the answer sheet, the lane
// on screen and the space under its header, so the guide asks it, and it reports back.

import { useSyncExternalStore } from 'react';

/** A lane of the phone screen. */
export type PhoneGuideLane = 'todo' | 'doing' | 'done';

export interface PhoneGuideLink {
  /** The guide asks the phone screen to open the answer sheet of a card. */
  openAnswer(taskId: number): void;
  /** The phone screen answers those requests. Returns the function that stops listening. */
  onAnswerRequest(handler: (taskId: number) => void): () => void;
  /** The phone screen reports whether its answer sheet is open. */
  setSheetOpen(open: boolean): void;
  /** The guide gives the phone screen a notice to show under its header, or `null`. */
  setNotice(message: string | null): void;
  /** The guide asks the phone screen to show the lane its step is about, or `null` for none. */
  setLane(lane: PhoneGuideLane | null): void;
  subscribe(listener: () => void): () => void;
  sheetOpen(): boolean;
  notice(): string | null;
  lane(): PhoneGuideLane | null;
}

export function createPhoneGuideLink(): PhoneGuideLink {
  const listeners = new Set<() => void>();
  const handlers = new Set<(taskId: number) => void>();
  let sheetOpen = false;
  let notice: string | null = null;
  let lane: PhoneGuideLane | null = null;
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    openAnswer: (taskId) => {
      for (const handler of [...handlers]) handler(taskId);
    },
    onAnswerRequest: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    setSheetOpen: (open) => {
      if (sheetOpen === open) return;
      sheetOpen = open;
      emit();
    },
    setNotice: (message) => {
      if (notice === message) return;
      notice = message;
      emit();
    },
    setLane: (next) => {
      if (lane === next) return;
      lane = next;
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sheetOpen: () => sheetOpen,
    notice: () => notice,
    lane: () => lane,
  };
}

const none = () => () => {};

/** Whether the phone screen's answer sheet is open; `false` without a link. */
export function usePhoneSheetOpen(link: PhoneGuideLink | undefined): boolean {
  return useSyncExternalStore(
    link ? link.subscribe : none,
    link ? link.sheetOpen : () => false,
    () => false,
  );
}

/** The notice the guide left for the phone screen; `null` without a link. */
export function usePhoneGuideNotice(link: PhoneGuideLink | undefined): string | null {
  return useSyncExternalStore(
    link ? link.subscribe : none,
    link ? link.notice : () => null,
    () => null,
  );
}

/** The lane the guide asks the phone screen to show; `null` without a link or a step. */
export function usePhoneGuideLane(link: PhoneGuideLink | undefined): PhoneGuideLane | null {
  return useSyncExternalStore(
    link ? link.subscribe : none,
    link ? link.lane : () => null,
    () => null,
  );
}
