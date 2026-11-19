import type { ConnectionStatus } from './connectionProgress';

export type { ConnectionStatus };

/** What the person types: the token is held in memory only and never shown again. */
export interface ConnectionDraft {
  token: string;
  /** Keep the typed token in this PC's secure storage. Off unless the person turns it on. */
  save: boolean;
  /** The ngrok domain that keeps the address the same; empty lets ngrok choose a new one each time. */
  domain: string;
}

/** Where the token comes from and whether this PC can keep one. Never the token itself. */
export interface TokenInfo {
  source: 'env' | 'keychain' | 'session' | null;
  /** This PC has a secure storage that can hold a token. */
  keychainAvailable: boolean;
  /** A token is saved in the secure storage and can be deleted. */
  saved: boolean;
}

/** A phone or browser registered with the passcode, as the PC lists it. */
export interface ConnectionDevice {
  id: string;
  /** A short name made from the browser's User-Agent, such as "iPhone / Safari". */
  label: string;
  /** RFC 3339 times. */
  createdAt: string;
  lastSeenAt: string;
}

/** The QR code of the phone URL, as an image the caller already rendered. */
export interface ConnectionQr {
  /** An image URL (a data URL is fine). */
  src: string;
  /** The picture is a layout sample and cannot be scanned. */
  sample?: boolean;
}
