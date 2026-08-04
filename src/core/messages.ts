import { browser } from 'wxt/browser';

export type BackgroundRequest =
  | { type: 'sync-now' }
  | { type: 'get-sync-status' }
  | { type: 'set-passphrase'; passphrase: string | null }
  | { type: 'overwrite-remote-plaintext' }
  | { type: 'encryption-changed' }
  | { type: 'backend-activated' };

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
