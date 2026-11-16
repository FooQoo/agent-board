// What the first-run guide and the phone screen tell each other. The guide lives above the width
// switch, so one controller serves both layouts; the phone screen owns the lane on screen, so the
// guide asks it to show the lane its step is about.

import { useSyncExternalStore } from 'react';

/** A lane of the phone screen. */
export type PhoneGuideLane = 'todo' | 'doing' | 'done';

export interface PhoneGuideLink {
  /** The guide asks the phone screen to show the lane its step is about, or `null` for none. */
  setLane(lane: PhoneGuideLane | null): void;
  subscribe(listener: () => void): () => void;
  lane(): PhoneGuideLane | null;
}

export function createPhoneGuideLink(): PhoneGuideLink {
  const listeners = new Set<() => void>();
  let lane: PhoneGuideLane | null = null;
  return {
    setLane: (next) => {
      if (lane === next) return;
      lane = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lane: () => lane,
  };
}

const none = () => () => {};

/** The lane the guide asks the phone screen to show; `null` without a link or a step. */
export function usePhoneGuideLane(link: PhoneGuideLink | undefined): PhoneGuideLane | null {
  return useSyncExternalStore(
    link ? link.subscribe : none,
    link ? link.lane : () => null,
    () => null,
  );
}
