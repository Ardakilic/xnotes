import { browser } from 'wxt/browser';

export type BackgroundRequest =
  | { type: 'sync-now' }
  | { type: 'get-sync-status' }
  | { type: 'set-passphrase'; passphrase: string | null }
  | { type: 'overwrite-remote-plaintext' }
  | { type: 'encryption-changed' }
  | { type: 'backend-activated' }
  | { type: 'open-options' };

export interface SyncStatusResponse {
  state: import('./types').SyncState;
  backendConfigured: boolean;
  encryptionEnabled: boolean;
  passphraseSet: boolean;
}

export type BackgroundResponse = { ok: boolean } | SyncStatusResponse;

export function sendBackground(msg: BackgroundRequest): Promise<BackgroundResponse> {
  return browser.runtime.sendMessage(msg);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MESSAGE_TYPES = [
  'sync-now',
  'get-sync-status',
  'overwrite-remote-plaintext',
  'encryption-changed',
  'backend-activated',
  'open-options',
] as const;

type SimpleMessageType = (typeof MESSAGE_TYPES)[number];

function isSimpleMessageType(value: unknown): value is SimpleMessageType {
  return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value);
}

export function parseBackgroundRequest(msg: unknown): BackgroundRequest | null {
  if (!isRecord(msg)) return null;
  const { type, passphrase } = msg;
  if (isSimpleMessageType(type)) return { type };
  if (type === 'set-passphrase') {
    if (passphrase !== null && typeof passphrase !== 'string') return null;
    return { type: 'set-passphrase', passphrase };
  }
  return null;
}
