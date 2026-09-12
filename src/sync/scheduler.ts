import { browser } from 'wxt/browser';
import {
  getSettings,
  getStore,
  getSyncState,
  saveStore,
  saveSyncState,
  subscribeToStoreChanges,
  toStoreV2,
} from '../core/storage';
import type { BackendSettings, Settings, StoreV2, SyncState } from '../core/types';
import {
  SyncAuthError,
  SyncConflictError,
  SyncDecodeError,
  SyncUnreachableError,
  type SyncAdapter,
} from './adapter';
import { decryptStore, encryptStore, EncryptionMismatchError, isEnvelope } from './crypto';
import { merge } from './merge';
import { S3Adapter } from './s3';
import { WebdavAdapter } from './webdav';

export const SYNC_ALARM = 'xnotes-sync';
export const BACKOFF_ALARM = 'xnotes-sync-backoff';
export const MAX_PUT_ATTEMPTS = 3;
const DEBOUNCE_MS = 10_000;

export class SyncPassphraseRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncPassphraseRequiredError';
  }
}

let running = false;
let pendingRerun = false;
let passphrase: string | null = null;
// ponytail: bridges exactly one passphrase change; a second change before any successful
// cycle overwrites it with the middle value (chain depth 1) — keep a list if that bites
let previousPassphrase: string | null = null;
let overwritePlaintextOnce = false;
let forcePushOnce = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let adapterFactory = (backend: BackendSettings): SyncAdapter =>
  backend.backend === 'webdav' ? new WebdavAdapter(backend) : new S3Adapter(backend);

export function setAdapterFactoryForTests(
  factory: (backend: BackendSettings) => SyncAdapter,
): void {
  adapterFactory = factory;
}

export function setPassphrase(value: string | null): void {
  const next = value === '' ? null : value;
  if (passphrase !== null && next !== null && next !== passphrase) {
    previousPassphrase = passphrase;
  }
  passphrase = next;
}

export function isPassphraseSet(): boolean {
  return passphrase !== null;
}

export function allowPlaintextOverwriteOnce(): void {
  overwritePlaintextOnce = true;
}

export function forceNextPush(): void {
  forcePushOnce = true;
}

export function backoffMinutes(failureCount: number): number {
  return Math.min(60, 2 ** Math.max(0, failureCount - 1));
}

/** Deterministic byte serialization (sorted keys) — used for hashing AND as the wire format. */
export function encodeStore(store: StoreV2): Uint8Array<ArrayBuffer> {
  const notes: Record<string, unknown> = {};
  for (const key of Object.keys(store.notes).sort()) {
    const n = store.notes[key]!;
    notes[key] = {
      color: n.color,
      createdAt: n.createdAt,
      handle: n.handle,
      handleLower: n.handleLower,
      text: n.text,
      updatedAt: n.updatedAt,
    };
  }
  const tombstones: Record<string, number> = {};
  for (const key of Object.keys(store.tombstones).sort()) tombstones[key] = store.tombstones[key]!;
  return new TextEncoder().encode(JSON.stringify({ schemaVersion: 2, notes, tombstones }));
}

export async function hashStore(store: StoreV2): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encodeStore(store));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function requirePassphrase(): string {
  if (passphrase === null) {
    throw new SyncPassphraseRequiredError(
      'Encrypted sync needs the passphrase — enter it in the popup',
    );
  }
  return passphrase;
}

function parsePlaintext(bytes: Uint8Array): StoreV2 {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SyncDecodeError('remote blob is not valid UTF-8');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SyncDecodeError('remote blob is not valid JSON');
  }
  const store = toStoreV2(json);
  if (store === null) throw new SyncDecodeError('remote blob is not a valid notes store');
  return store;
}

async function decryptEnvelope(bytes: Uint8Array): Promise<unknown> {
  try {
    return await decryptStore(bytes, requirePassphrase());
  } catch (err) {
    if (!(err instanceof SyncDecodeError) || previousPassphrase === null) throw err;
    return decryptStore(bytes, previousPassphrase);
  }
}

async function decodeRemote(
  bytes: Uint8Array,
  settings: Settings,
  force: boolean,
): Promise<StoreV2> {
  if (isEnvelope(bytes)) {
    if (!settings.encryptionEnabled && !force)
      throw new EncryptionMismatchError('remote-encrypted');
    const store = toStoreV2(await decryptEnvelope(bytes));
    if (store === null) throw new SyncDecodeError('decrypted blob is not a valid notes store');
    return store;
  }
  if (settings.encryptionEnabled) {
    if (overwritePlaintextOnce) {
      overwritePlaintextOnce = false;
      return parsePlaintext(bytes);
    }
    throw new EncryptionMismatchError('remote-plaintext');
  }
  return parsePlaintext(bytes);
}

async function encodeForUpload(store: StoreV2, settings: Settings): Promise<Uint8Array> {
  if (settings.encryptionEnabled) return encryptStore(store, requirePassphrase());
  return encodeStore(store);
}

interface CycleResult {
  etag: string | null;
  hash: string;
}

async function syncCycle(
  adapter: SyncAdapter,
  settings: Settings,
  knownEtag: string | null,
  force: boolean,
): Promise<CycleResult> {
  let etag = knownEtag;
  for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
    const localAtStart = await getStore();
    const localHashAtStart = await hashStore(localAtStart);
    const remote = await adapter.get(
      etag !== null && etag !== '' ? { ifNoneMatch: etag } : undefined,
    );

    if (remote.kind === 'not-modified') {
      const state = await getSyncState();
      if (state.lastSyncedLocalHash === localHashAtStart && !force)
        return { etag, hash: localHashAtStart };
      const local = await getStore();
      const localHash = await hashStore(local);
      const bytes = await encodeForUpload(local, settings);
      try {
        const put = await adapter.put(bytes, etag ? { ifMatch: etag } : { ifNoneMatch: '*' });
        return { etag: put.etag !== '' ? put.etag : etag, hash: localHash };
      } catch (err) {
        if (err instanceof SyncConflictError && attempt < MAX_PUT_ATTEMPTS - 1) continue;
        throw err;
      }
    }

    if (remote.kind === 'not-found') {
      const local = await getStore();
      const localHash = await hashStore(local);
      const bytes = await encodeForUpload(local, settings);
      try {
        const put = await adapter.put(bytes, { ifNoneMatch: '*' });
        return { etag: put.etag !== '' ? put.etag : null, hash: localHash };
      } catch (err) {
        if (err instanceof SyncConflictError && attempt < MAX_PUT_ATTEMPTS - 1) continue;
        throw err;
      }
    }

    etag = remote.etag;
    const remoteStore = await decodeRemote(remote.data, settings, force);
    const local = await getStore();
    const localHash = await hashStore(local);
    const merged = merge(local, remoteStore);
    const mergedHash = await hashStore(merged);
    if (mergedHash !== localHash) await saveStore(merged);
    if (mergedHash === (await hashStore(remoteStore)) && !force) {
      return { etag, hash: mergedHash };
    }
    const bytes = await encodeForUpload(merged, settings);
    try {
      const put = await adapter.put(bytes, etag !== '' ? { ifMatch: etag } : undefined);
      return { etag: put.etag !== '' ? put.etag : etag, hash: mergedHash };
    } catch (err) {
      if (err instanceof SyncConflictError && attempt < MAX_PUT_ATTEMPTS - 1) continue;
      throw err;
    }
  }
  throw new SyncConflictError('conflict retry budget exhausted');
}

function messageFor(err: unknown): string {
  if (err instanceof SyncAuthError)
    return `Authentication failed — check backend credentials (${err.message})`;
  if (err instanceof SyncUnreachableError) return `Backend unreachable — ${err.message}`;
  if (err instanceof SyncConflictError) return `Sync conflict — ${err.message}`;
  if (err instanceof SyncDecodeError) return err.message;
  if (err instanceof SyncPassphraseRequiredError) return err.message;
  if (err instanceof EncryptionMismatchError) {
    return err.direction === 'remote-encrypted'
      ? 'Remote data is encrypted — enable encryption and enter the passphrase before syncing'
      : 'Remote data is not encrypted but encryption is on — confirm overwrite from the popup';
  }
  return err instanceof Error ? err.message : String(err);
}

async function updateBadge(state: SyncState): Promise<void> {
  try {
    if (state.status === 'error') {
      await browser.action.setBadgeText({ text: '!' });
      await browser.action.setBadgeBackgroundColor({ color: '#d93025' });
    } else {
      await browser.action.setBadgeText({ text: '' });
    }
  } catch {
    // ponytail: badge is cosmetic — never let it break a cycle
  }
}

async function cycleOnce(): Promise<void> {
  const settings = await getSettings();
  if (settings.backend === null) return;
  const adapter = adapterFactory(settings.backend);
  const before = await getSyncState();
  const deviceId = before.deviceId !== '' ? before.deviceId : crypto.randomUUID();
  await saveSyncState({ ...before, deviceId, status: 'syncing' });
  const force = forcePushOnce;
  forcePushOnce = false;
  try {
    const result = await syncCycle(adapter, settings, before.lastRemoteEtag, force);
    const after = await getSyncState();
    const next: SyncState = {
      ...after,
      deviceId,
      status: 'idle',
      lastError: null,
      lastSyncAt: Date.now(),
      lastRemoteEtag: result.etag,
      lastSyncedLocalHash: result.hash,
      failureCount: 0,
    };
    await saveSyncState(next);
    await updateBadge(next);
    previousPassphrase = null;
  } catch (err) {
    if (force) forcePushOnce = true;
    const after = await getSyncState();
    const failureCount = after.failureCount + 1;
    const next: SyncState = {
      ...after,
      deviceId,
      status: 'error',
      lastError: messageFor(err),
      failureCount,
    };
    await saveSyncState(next);
    await updateBadge(next);
    if (!(err instanceof SyncAuthError)) {
      try {
        await browser.alarms.create(BACKOFF_ALARM, {
          delayInMinutes: backoffMinutes(failureCount),
        });
      } catch {
        // ponytail: backoff alarm is best-effort; the periodic alarm still retries
      }
    }
  }
}

export async function runCycle(): Promise<void> {
  if (running) {
    pendingRerun = true;
    return;
  }
  running = true;
  try {
    await cycleOnce();
  } finally {
    running = false;
    if (pendingRerun) {
      pendingRerun = false;
      void runCycle();
    }
  }
}

export async function rescheduleAlarm(): Promise<void> {
  try {
    await browser.alarms.clear(SYNC_ALARM);
    const settings = await getSettings();
    if (settings.backend !== null) {
      await browser.alarms.create(SYNC_ALARM, {
        periodInMinutes: Math.max(1, settings.syncIntervalMinutes),
      });
    }
  } catch {
    // ponytail: alarm bookkeeping is best-effort
  }
}

export function initScheduler(): void {
  browser.runtime.onStartup.addListener(() => {
    void runCycle();
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM || alarm.name === BACKOFF_ALARM) void runCycle();
  });
  subscribeToStoreChanges(() => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    // ponytail: setTimeout, not browser.alarms — Chrome's 30 s alarm floor can't express a
    // ~10 s debounce; if the SW dies inside the window the periodic alarm is the backstop
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void getSettings().then((settings) => {
        if (settings.backend !== null) void runCycle();
      });
    }, DEBOUNCE_MS);
  });
  void rescheduleAlarm();
}
