import { browser } from 'wxt/browser';
import {
  type BackgroundRequest,
  type BackgroundResponse,
  type SyncStatusResponse,
  parseBackgroundRequest,
} from '../../src/core/messages';
import { getSettings, getSyncState } from '../../src/core/storage';
import {
  allowPlaintextOverwriteOnce,
  forceNextPush,
  initScheduler,
  isPassphraseSet,
  rescheduleAlarm,
  runCycle,
  setPassphrase,
} from '../../src/sync/scheduler';

async function handle(msg: BackgroundRequest): Promise<BackgroundResponse> {
  switch (msg.type) {
    case 'sync-now':
      await runCycle();
      return { ok: true };
    case 'get-sync-status': {
      const state = await getSyncState();
      const settings = await getSettings();
      const response: SyncStatusResponse = {
        state,
        backendConfigured: settings.backend !== null,
        encryptionEnabled: settings.encryptionEnabled,
        passphraseSet: isPassphraseSet(),
      };
      return response;
    }
    case 'set-passphrase':
      setPassphrase(msg.passphrase);
      return { ok: true };
    case 'overwrite-remote-plaintext':
      allowPlaintextOverwriteOnce();
      await runCycle();
      return { ok: true };
    case 'encryption-changed':
      forceNextPush();
      await runCycle();
      return { ok: true };
    case 'backend-activated':
      await rescheduleAlarm();
      await runCycle();
      return { ok: true };
    case 'open-options':
      await browser.runtime.openOptionsPage();
      return { ok: true };
  }
}

export default defineBackground(() => {
  initScheduler();
  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    const parsed = parseBackgroundRequest(msg);
    if (parsed === null) return;
    void handle(parsed).then(sendResponse);
    return true;
  });
});
