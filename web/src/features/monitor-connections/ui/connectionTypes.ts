import type { ConnectionStatus } from './connectionProgress';

export type { ConnectionStatus };

/** What the person types: the token is held in memory only and never shown again. */
export interface ConnectionDraft {
  token: string;
  /** Keep the typed token in this PC's secure storage. Off unless the person turns it on. */
  save: boolean;
}

/** Where the token comes from and whether this PC can keep one. Never the token itself. */
export interface TokenInfo {
  source: 'env' | 'keychain' | 'session' | null;
  /** This PC has a secure storage that can hold a token. */
  keychainAvailable: boolean;
  /** A token is saved in the secure storage and can be deleted. */
  saved: boolean;
}

/** The QR code of the phone URL, as an image the caller already rendered. */
export interface ConnectionQr {
  /** An image URL (a data URL is fine). */
  src: string;
  /** The picture is a layout sample and cannot be scanned. */
  sample?: boolean;
}
