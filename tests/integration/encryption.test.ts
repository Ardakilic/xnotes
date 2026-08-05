import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toStoreV2 } from '../../src/core/storage';
import { upsertNote } from '../../src/core/storage';
import type { Settings, WebdavSettings } from '../../src/core/types';
import { SyncDecodeError } from '../../src/sync/adapter';
import { decryptStore, isEnvelope } from '../../src/sync/crypto';
import { runCycle, setAdapterFactoryForTests, setPassphrase } from '../../src/sync/scheduler';
import { WebdavAdapter } from '../../src/sync/webdav';
import { env, waitForReady } from './helpers';

const webdav: WebdavSettings = {
  backend: 'webdav',
  endpoint: env('WEBDAV_URL'),
  username: env('WEBDAV_USERNAME'),
  password: env('WEBDAV_PASSWORD'),
  path: '/xnotes-encrypted/notes.json',
};

const PASSPHRASE = 'integration-passphrase';

beforeAll(async () => {
  await waitForReady(() => new WebdavAdapter({ ...webdav, path: '/probe.json' }).probe());
});

beforeEach(() => {
  fakeBrowser.reset();
  setPassphrase(null);
});

describe('encrypted sync against real dufs', () => {
  it('stores only an opaque envelope on the server', async () => {
    setAdapterFactoryForTests(() => new WebdavAdapter(webdav));
    const settings: Settings = { backend: webdav, syncIntervalMinutes: 5, encryptionEnabled: true };
    await fakeBrowser.storage.local.set({ 'xnotes:settings': settings });
    setPassphrase(PASSPHRASE);
    await upsertNote('secretuser', 'a very private note about @secretuser', 'teal', 1000);

    await runCycle();

    const res = await fetch(`${webdav.endpoint}${webdav.path}`, {
      headers: {
        Authorization: `Basic ${btoa(`${webdav.username}:${webdav.password}`)}`,
      },
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());

    expect(isEnvelope(bytes)).toBe(true);
    const raw = new TextDecoder().decode(bytes);
    expect(raw).not.toContain('secretuser');
    expect(raw).not.toContain('private note');

    const decrypted = toStoreV2(await decryptStore(bytes, PASSPHRASE));
    expect(decrypted).not.toBeNull();
    expect(decrypted?.notes['secretuser']?.text).toBe('a very private note about @secretuser');
    expect(decrypted?.notes['secretuser']?.color).toBe('teal');
  });

  it('a second device with the passphrase decrypts the remote blob', async () => {
    setAdapterFactoryForTests(() => new WebdavAdapter(webdav));
    const settings: Settings = { backend: webdav, syncIntervalMinutes: 5, encryptionEnabled: true };
    await fakeBrowser.storage.local.set({ 'xnotes:settings': settings });
    setPassphrase(PASSPHRASE);
    await upsertNote('secretuser', 'a very private note about @secretuser', 'teal', 1000);

    await runCycle();

    const adapter = new WebdavAdapter(webdav);
    const got = await adapter.get();
    expect(got.kind).toBe('found');
    if (got.kind !== 'found') return;
    const store = toStoreV2(await decryptStore(got.data, PASSPHRASE));
    expect(store?.notes['secretuser']).toBeDefined();
    await expect(decryptStore(got.data, 'wrong-passphrase')).rejects.toBeInstanceOf(
      SyncDecodeError,
    );
  });
});
