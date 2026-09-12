import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, getSyncState, toStoreV2, upsertNote } from '../core/storage';
import type { BackendSettings, Settings, StoreV2 } from '../core/types';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDecodeError,
  SyncUnreachableError,
  type PutOptions,
} from './adapter';
import { decryptStore, encryptStore, isEnvelope } from './crypto';
import {
  allowPlaintextOverwriteOnce,
  backoffMinutes,
  BACKOFF_ALARM,
  forceNextPush,
  initScheduler,
  isPassphraseSet,
  runCycle,
  setAdapterFactoryForTests,
  setPassphrase,
} from './scheduler';

const BACKEND: BackendSettings = {
  backend: 'webdav',
  endpoint: 'https://dav.example.com',
  username: 'u',
  password: 'p',
  path: '/xnotes/notes.json',
};

function settingsOf(overrides: Partial<Settings>): Settings {
  return { backend: BACKEND, syncIntervalMinutes: 5, encryptionEnabled: false, ...overrides };
}

async function saveSettings(settings: Settings): Promise<void> {
  await fakeBrowser.storage.local.set({ 'xnotes:settings': settings });
}

class FakeAdapter {
  remote: { bytes: Uint8Array; etag: string } | null = null;
  puts: { bytes: Uint8Array; opts?: PutOptions }[] = [];
  gets = 0;
  putFailures: ('conflict' | 'auth')[] = [];
  getError: Error | null = null;
  slowGets = 0;
  inFlight = 0;
  maxConcurrent = 0;

  async probe(): Promise<void> {}

  async get(opts?: {
    ifNoneMatch?: string;
  }): Promise<
    | { kind: 'found'; data: Uint8Array; etag: string }
    | { kind: 'not-found' }
    | { kind: 'not-modified' }
  > {
    this.inFlight++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    try {
      this.gets++;
      if (this.slowGets > 0) {
        this.slowGets--;
        await new Promise((r) => setTimeout(r, 20));
      }
      if (this.getError) throw this.getError;
      if (this.remote === null) return { kind: 'not-found' };
      if (opts?.ifNoneMatch === this.remote.etag) return { kind: 'not-modified' };
      return { kind: 'found', data: this.remote.bytes, etag: this.remote.etag };
    } finally {
      this.inFlight--;
    }
  }

  async put(bytes: Uint8Array, opts?: PutOptions): Promise<{ etag: string }> {
    const fail = this.putFailures.shift();
    if (fail === 'conflict') throw new SyncConflictError('412');
    if (fail === 'auth') throw new SyncAuthError('401');
    this.puts.push({ bytes: new Uint8Array(bytes), ...(opts !== undefined ? { opts } : {}) });
    const etag = `etag-${this.puts.length}`;
    this.remote = { bytes: new Uint8Array(bytes), etag };
    return { etag };
  }
}

function storeBytes(store: StoreV2): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(store));
}

function note(handle: string, updatedAt: number, text = `text of ${handle}`): StoreV2 {
  return {
    schemaVersion: 2,
    notes: {
      [handle.toLowerCase()]: {
        handle,
        handleLower: handle.toLowerCase(),
        text,
        color: null,
        createdAt: updatedAt - 1000,
        updatedAt,
      },
    },
    tombstones: {},
  };
}

let fake: FakeAdapter;

beforeEach(async () => {
  fakeBrowser.reset();
  fake = new FakeAdapter();
  setAdapterFactoryForTests(() => fake);
  setPassphrase(null);
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('no backend configured', () => {
  it('is a complete no-op', async () => {
    await runCycle();
    expect(fake.gets).toBe(0);
    expect(fake.puts).toHaveLength(0);
    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(state.lastError).toBeNull();
  });
});

describe('first sync', () => {
  it('creates the remote blob when none exists and records state', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'hello', null, 1000);
    await runCycle();
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0]!.opts).toEqual({ ifNoneMatch: '*' });
    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(state.lastError).toBeNull();
    expect(state.lastRemoteEtag).toBe('etag-1');
    expect(state.lastSyncAt).not.toBeNull();
    expect(state.deviceId).not.toBe('');
    expect(state.lastSyncedLocalHash).not.toBeNull();
  });
});

describe('pull / push / no-op', () => {
  it('pulls a remote-only note without PUTting', async () => {
    await saveSettings(settingsOf({}));
    fake.remote = { bytes: storeBytes(note('remoteuser', 5000)), etag: 'e0' };
    await runCycle();
    expect(fake.puts).toHaveLength(0);
    const store = await getStore();
    expect(store.notes['remoteuser']?.text).toBe('text of remoteuser');
    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(state.lastRemoteEtag).toBe('e0');
  });

  it('pushes a local-only change', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'local note', null, 9000);
    fake.remote = { bytes: storeBytes(note('remoteuser', 5000)), etag: 'e0' };
    await runCycle();
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0]!.opts).toEqual({ ifMatch: 'e0' });
    const pushed = toStoreV2(JSON.parse(new TextDecoder().decode(fake.puts[0]!.bytes)));
    expect(pushed?.notes['jack']).toBeDefined();
    expect(pushed?.notes['remoteuser']).toBeDefined();
  });

  it('does nothing when both sides already agree', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'same', null, 9000);
    await runCycle();
    expect(fake.puts).toHaveLength(1);
    await runCycle();
    expect(fake.puts).toHaveLength(1);
    expect((await getSyncState()).status).toBe('idle');
  });

  it('304 fast path pushes when local moved on', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'v1', null, 9000);
    await runCycle();
    await upsertNote('jack', 'v2', null, 9500);
    await runCycle();
    expect(fake.gets).toBe(2);
    expect(fake.puts).toHaveLength(2);
    const pushed = toStoreV2(JSON.parse(new TextDecoder().decode(fake.puts[1]!.bytes)));
    expect(pushed?.notes['jack']?.text).toBe('v2');
  });
});

describe('conflict retry', () => {
  it('re-fetches, re-merges and succeeds within budget after a 412', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'mine', null, 9000);
    fake.remote = { bytes: storeBytes(note('other', 5000)), etag: 'e0' };
    fake.putFailures = ['conflict'];
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(fake.puts).toHaveLength(1);
    const store = await getStore();
    expect(store.notes['jack']).toBeDefined();
    expect(store.notes['other']).toBeDefined();
  });

  it('ends in error after the budget is exhausted, local intact', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'mine', null, 9000);
    fake.remote = { bytes: storeBytes(note('other', 5000)), etag: 'e0' };
    fake.putFailures = ['conflict', 'conflict', 'conflict'];
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('conflict');
    expect(fake.puts).toHaveLength(0);
    expect((await getStore()).notes['jack']?.text).toBe('mine');
  });

  it('retries the not-found create PUT when it conflicts once', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'mine', null, 9000);
    fake.putFailures = ['conflict'];
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(fake.puts).toHaveLength(1);
    expect(fake.puts[0]!.opts).toEqual({ ifNoneMatch: '*' });
    expect((await getStore()).notes['jack']?.text).toBe('mine');
  });

  it('retries the 304 fast-path PUT when it conflicts once', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'v1', null, 9000);
    await runCycle();
    fake.putFailures = ['conflict'];
    await upsertNote('jack', 'v2', null, 9500);
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(fake.puts).toHaveLength(2);
    const pushed = toStoreV2(JSON.parse(new TextDecoder().decode(fake.puts[1]!.bytes)));
    expect(pushed?.notes['jack']?.text).toBe('v2');
  });
});

describe('single-flight', () => {
  it('coalesces overlapping triggers into one extra cycle, never running in parallel', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'v1', null, 9000);
    fake.slowGets = 1;
    const first = runCycle();
    const second = runCycle();
    await Promise.all([first, second]);
    await settle();
    expect(fake.gets).toBe(2);
    expect(fake.maxConcurrent).toBe(1);
  });
});

describe('concurrent local edits during sync', () => {
  it('preserves a local edit made while adapter.get is pending', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'v1', null, 9000);
    fake.remote = { bytes: storeBytes(note('remoteuser', 5000)), etag: 'e0' };
    fake.slowGets = 1;
    const cyclePromise = runCycle();
    await upsertNote('concurrent', 'edit during get', null, 10_000);
    await cyclePromise;
    await settle();
    const store = await getStore();
    expect(store.notes['concurrent']?.text).toBe('edit during get');
    expect(store.notes['jack']).toBeDefined();
    expect(store.notes['remoteuser']).toBeDefined();
  });
});

describe('errors and backoff', () => {
  it('records unreachable errors and increments failure count', async () => {
    await saveSettings(settingsOf({}));
    fake.getError = new SyncUnreachableError('network down');
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('unreachable');
    expect(state.failureCount).toBe(1);
  });

  it('surfaces auth errors distinctly', async () => {
    await saveSettings(settingsOf({}));
    fake.getError = new SyncAuthError('401');
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('Authentication failed');
  });

  it('does not schedule a backoff alarm for auth errors', async () => {
    await saveSettings(settingsOf({}));
    fake.getError = new SyncAuthError('401');
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('Authentication');
    expect(await fakeBrowser.alarms.get(BACKOFF_ALARM)).toBeUndefined();
  });

  it('schedules a backoff alarm for non-auth errors', async () => {
    await saveSettings(settingsOf({}));
    fake.getError = new SyncUnreachableError('network down');
    await runCycle();
    expect(await fakeBrowser.alarms.get(BACKOFF_ALARM)).toBeDefined();
  });

  it('backoff doubles and caps at 60 minutes', () => {
    expect(backoffMinutes(1)).toBe(1);
    expect(backoffMinutes(2)).toBe(2);
    expect(backoffMinutes(3)).toBe(4);
    expect(backoffMinutes(4)).toBe(8);
    expect(backoffMinutes(10)).toBe(60);
  });

  it('keeps deviceId stable across cycles', async () => {
    await saveSettings(settingsOf({}));
    await runCycle();
    const first = (await getSyncState()).deviceId;
    await runCycle();
    expect((await getSyncState()).deviceId).toBe(first);
    expect(first).not.toBe('');
  });
});

describe('encryption', () => {
  it('errors when remote is encrypted but encryption is off, local untouched', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: false }));
    await upsertNote('jack', 'local', null, 9000);
    const envelope = await encryptStore(note('secret', 5000), 'pw');
    fake.remote = { bytes: envelope, etag: 'e0' };
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('encrypted');
    expect(fake.puts).toHaveLength(0);
    expect((await getStore()).notes['jack']?.text).toBe('local');
  });

  it('errors on remote plaintext while encryption is on until confirmed, then pushes an envelope', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    setPassphrase('pw');
    await upsertNote('jack', 'local', null, 9000);
    fake.remote = { bytes: storeBytes(note('plain', 5000)), etag: 'e0' };
    await runCycle();
    let state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('not encrypted');
    expect(fake.puts).toHaveLength(0);

    allowPlaintextOverwriteOnce();
    await runCycle();
    state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(fake.puts).toHaveLength(1);
    expect(isEnvelope(fake.puts[0]!.bytes)).toBe(true);
  });

  it('requires the passphrase for encrypted sync', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    fake.remote = { bytes: await encryptStore(note('secret', 5000), 'pw'), etag: 'e0' };
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('passphrase');
  });

  it('uploads an opaque envelope decryptable with the passphrase', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    setPassphrase('pw');
    await upsertNote('jack', 'private note', null, 9000);
    await runCycle();
    expect(fake.puts).toHaveLength(1);
    const bytes = fake.puts[0]!.bytes;
    expect(isEnvelope(bytes)).toBe(true);
    expect(new TextDecoder().decode(bytes)).not.toContain('private note');
    expect(new TextDecoder().decode(bytes)).not.toContain('jack');
    const decrypted = await decryptStore(bytes, 'pw');
    expect(decrypted).toEqual(await getStore());
  });

  it('wrong passphrase errors the cycle without touching the local store', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    await upsertNote('jack', 'mine', null, 9000);
    fake.remote = { bytes: await encryptStore(note('secret', 5000), 'right-pass'), etag: 'e0' };
    setPassphrase('wrong-pass');
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('wrong passphrase');
    expect(fake.puts).toHaveLength(0);
    expect((await getStore()).notes['jack']?.text).toBe('mine');
  });

  it('re-encrypts and pushes when the passphrase changes (plaintext unchanged)', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    setPassphrase('passphrase-A');
    await upsertNote('jack', 'private', null, 9000);
    await runCycle();
    expect(fake.puts).toHaveLength(1);

    forceNextPush();
    setPassphrase('passphrase-B');
    await runCycle();

    expect(fake.puts).toHaveLength(2);
    expect((await getSyncState()).status).toBe('idle');
    const bytes = fake.puts[1]!.bytes;
    expect(isEnvelope(bytes)).toBe(true);
    const decrypted = toStoreV2(await decryptStore(bytes, 'passphrase-B'));
    expect(decrypted?.notes['jack']?.text).toBe('private');
    await expect(decryptStore(bytes, 'passphrase-A')).rejects.toBeInstanceOf(SyncDecodeError);
  });

  it('pushes the envelope when encryption is enabled even if nothing else changed', async () => {
    await saveSettings(settingsOf({}));
    await upsertNote('jack', 'v1', null, 9000);
    await runCycle();
    expect(fake.puts).toHaveLength(1);
    expect(isEnvelope(fake.puts[0]!.bytes)).toBe(false);

    await saveSettings(settingsOf({ encryptionEnabled: true }));
    setPassphrase('pw');
    forceNextPush();
    await runCycle();

    expect(fake.puts).toHaveLength(2);
    expect(isEnvelope(fake.puts[1]!.bytes)).toBe(true);
    expect((await getSyncState()).status).toBe('idle');
  });

  it('merges a remote changed under the old passphrase when the passphrase changed', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    setPassphrase('passphrase-A');
    await upsertNote('jack', 'local note', null, 9000);
    fake.remote = {
      bytes: await encryptStore(note('remoteuser', 5000), 'passphrase-A'),
      etag: 'e0',
    };
    await runCycle();
    expect(fake.puts).toHaveLength(1);

    fake.remote = {
      bytes: await encryptStore(note('otherdevice', 6000), 'passphrase-A'),
      etag: 'e1',
    };
    forceNextPush();
    setPassphrase('passphrase-B');
    await runCycle();

    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(fake.puts).toHaveLength(2);
    const bytes = fake.puts[1]!.bytes;
    expect(isEnvelope(bytes)).toBe(true);
    const decrypted = toStoreV2(await decryptStore(bytes, 'passphrase-B'));
    expect(decrypted?.notes['jack']?.text).toBe('local note');
    expect(decrypted?.notes['otherdevice']).toBeDefined();
    expect(decrypted?.notes['remoteuser']).toBeDefined();
    await expect(decryptStore(bytes, 'passphrase-A')).rejects.toBeInstanceOf(SyncDecodeError);
    expect((await getStore()).notes['otherdevice']).toBeDefined();
  });

  it('converts the remote to plaintext when encryption is disabled with a changed remote', async () => {
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    setPassphrase('pw');
    await upsertNote('jack', 'local note', null, 9000);
    fake.remote = { bytes: await encryptStore(note('remoteuser', 5000), 'pw'), etag: 'e0' };
    await runCycle();
    expect(fake.puts).toHaveLength(1);

    fake.remote = { bytes: await encryptStore(note('otherdevice', 6000), 'pw'), etag: 'e1' };
    await saveSettings(settingsOf({ encryptionEnabled: false }));
    forceNextPush();
    await runCycle();

    const state = await getSyncState();
    expect(state.status).toBe('idle');
    expect(fake.puts).toHaveLength(2);
    expect(isEnvelope(fake.puts[1]!.bytes)).toBe(false);
    const pushed = toStoreV2(JSON.parse(new TextDecoder().decode(fake.puts[1]!.bytes)));
    expect(pushed?.notes['jack']?.text).toBe('local note');
    expect(pushed?.notes['otherdevice']).toBeDefined();
  });

  it('treats an empty passphrase as unset', async () => {
    setPassphrase('pw');
    setPassphrase('');
    expect(isPassphraseSet()).toBe(false);
    await saveSettings(settingsOf({ encryptionEnabled: true }));
    fake.remote = { bytes: await encryptStore(note('secret', 5000), 'pw'), etag: 'e0' };
    await runCycle();
    const state = await getSyncState();
    expect(state.status).toBe('error');
    expect(state.lastError).toContain('passphrase');
    expect(fake.puts).toHaveLength(0);
  });
});

describe('debounced local-change trigger', () => {
  it('runs a cycle ~10 s after a local edit when a backend is configured', async () => {
    await saveSettings(settingsOf({}));
    initScheduler();
    vi.useFakeTimers();
    await upsertNote('jack', 'edit', null, 9000);
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    // ponytail: the cycle awaits crypto.subtle.digest, which settles on the event loop,
    // not inside the fake-timer flush — assert on real time
    await vi.waitFor(() => expect(fake.gets).toBe(1));
  });

  it('does not sync on local changes when no backend is configured', async () => {
    initScheduler();
    vi.useFakeTimers();
    await upsertNote('jack', 'edit', null, 9000);
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.gets).toBe(0);
  });
});
