import { browser } from 'wxt/browser';
import { isColorKey, type ColorKey } from './colors';
import {
  DEFAULT_SETTINGS,
  type BackendSettings,
  type ManagerView,
  type NoteRecord,
  type Settings,
  type StoreV2,
  type SyncState,
  type SyncStatus,
} from './types';

export const STORE_KEY = 'xnotes:store';
export const SYNC_STATE_KEY = 'xnotes:sync-state';
export const SETTINGS_KEY = 'xnotes:settings';
export const VIEW_KEY = 'xnotes:view';
export const CORRUPT_PREFIX = 'xnotes:corrupt-';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contextAlive(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

async function safeRead(key: string): Promise<unknown> {
  if (!contextAlive()) return undefined;
  try {
    const result = await browser.storage.local.get(key);
    return result[key];
  } catch {
    // ponytail: fail-soft — storage errors and invalidated contexts read as absent
    return undefined;
  }
}

async function safeWrite(key: string, value: unknown): Promise<void> {
  if (!contextAlive()) return;
  try {
    await browser.storage.local.set({ [key]: value });
  } catch {
    // ponytail: fail-soft — swallow quota/invalidated-context errors
  }
}

async function safeRemove(key: string): Promise<void> {
  if (!contextAlive()) return;
  try {
    await browser.storage.local.remove(key);
  } catch {
    // ponytail: fail-soft
  }
}

export function toNoteRecord(value: unknown, keyFallback?: string): NoteRecord | null {
  if (!isRecord(value)) return null;
  const rawHandle = value['handle'];
  let handleSource: string;
  if (typeof rawHandle === 'string') {
    handleSource = rawHandle;
  } else if (typeof keyFallback === 'string') {
    handleSource = keyFallback;
  } else {
    return null;
  }
  const handle = normalizeHandle(handleSource);
  if (handle === '') return null;
  const handleLower = handle.toLowerCase();
  const rawText = value['text'];
  const text = typeof rawText === 'string' ? rawText : '';
  const rawCreatedAt = value['createdAt'];
  const createdAt =
    typeof rawCreatedAt === 'number' && Number.isFinite(rawCreatedAt) ? rawCreatedAt : 0;
  const rawUpdatedAt = value['updatedAt'];
  const updatedAt =
    typeof rawUpdatedAt === 'number' && Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : createdAt;
  const color = isColorKey(value['color']) ? value['color'] : null;
  return { handle, handleLower, text, color, createdAt, updatedAt };
}

export function toStoreV2(value: unknown): StoreV2 | null {
  if (!isRecord(value)) return null;
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 1 && schemaVersion !== 2) return null;
  const rawNotes = value['notes'];
  if (!isRecord(rawNotes)) return null;
  const notes: Record<string, NoteRecord> = {};
  for (const [key, entry] of Object.entries(rawNotes)) {
    const record = toNoteRecord(entry, key);
    if (record !== null) notes[record.handleLower] = record;
  }
  const tombstones: Record<string, number> = {};
  if (schemaVersion === 2) {
    const rawTombstones = value['tombstones'];
    if (isRecord(rawTombstones)) {
      for (const [key, deletedAt] of Object.entries(rawTombstones)) {
        if (typeof deletedAt === 'number' && Number.isFinite(deletedAt))
          tombstones[key] = deletedAt;
      }
    }
  }
  return { schemaVersion: 2, notes, tombstones };
}

export function emptyStore(): StoreV2 {
  return { schemaVersion: 2, notes: {}, tombstones: {} };
}

export async function getStore(): Promise<StoreV2> {
  const raw = await safeRead(STORE_KEY);
  if (raw === undefined) return emptyStore();
  const parsed = toStoreV2(raw);
  if (parsed !== null) return parsed;
  // ponytail: millisecond key — two corruptions in the same ms would collide, acceptable
  await safeWrite(CORRUPT_PREFIX + String(Date.now()), raw);
  await safeRemove(STORE_KEY);
  return emptyStore();
}

export async function saveStore(store: StoreV2): Promise<void> {
  await safeWrite(STORE_KEY, store);
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').trim();
}

export async function upsertNote(
  handle: string,
  text: string,
  color: ColorKey | null,
  now?: number,
): Promise<void> {
  const normalized = normalizeHandle(handle);
  if (normalized === '') return;
  const handleLower = normalized.toLowerCase();
  const timestamp = now ?? Date.now();
  const store = await getStore();
  const existing = store.notes[handleLower];
  if (text.trim() === '') {
    if (existing !== undefined) {
      delete store.notes[handleLower];
      store.tombstones[handleLower] = timestamp;
      await saveStore(store);
    }
    return;
  }
  store.notes[handleLower] = {
    handle: normalized,
    handleLower,
    text,
    color,
    createdAt: existing !== undefined ? existing.createdAt : timestamp,
    updatedAt: timestamp,
  };
  delete store.tombstones[handleLower];
  await saveStore(store);
}

export async function deleteNote(handle: string, now?: number): Promise<void> {
  const normalized = normalizeHandle(handle);
  if (normalized === '') return;
  const handleLower = normalized.toLowerCase();
  const store = await getStore();
  delete store.notes[handleLower];
  store.tombstones[handleLower] = now ?? Date.now();
  await saveStore(store);
}

export function subscribeToStoreChanges(cb: () => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName === 'local' && STORE_KEY in changes) cb();
  };
  try {
    browser.storage.onChanged.addListener(listener);
  } catch {
    // ponytail: fail-soft — no subscription in an invalidated context
  }
  return () => {
    try {
      browser.storage.onChanged.removeListener(listener);
    } catch {
      // ponytail: fail-soft
    }
  };
}

const DEFAULT_SYNC_STATE: SyncState = {
  deviceId: '',
  lastSyncAt: null,
  lastRemoteEtag: null,
  status: 'idle',
  lastError: null,
  lastSyncedLocalHash: null,
  failureCount: 0,
};

export async function getSyncState(): Promise<SyncState> {
  const raw = await safeRead(SYNC_STATE_KEY);
  if (!isRecord(raw)) return { ...DEFAULT_SYNC_STATE };
  const rawStatus = raw['status'];
  const status: SyncStatus = rawStatus === 'syncing' || rawStatus === 'error' ? rawStatus : 'idle';
  const rawLastSyncAt = raw['lastSyncAt'];
  const rawFailureCount = raw['failureCount'];
  return {
    deviceId: typeof raw['deviceId'] === 'string' ? raw['deviceId'] : '',
    lastSyncAt:
      typeof rawLastSyncAt === 'number' && Number.isFinite(rawLastSyncAt) ? rawLastSyncAt : null,
    lastRemoteEtag: typeof raw['lastRemoteEtag'] === 'string' ? raw['lastRemoteEtag'] : null,
    status,
    lastError: typeof raw['lastError'] === 'string' ? raw['lastError'] : null,
    lastSyncedLocalHash:
      typeof raw['lastSyncedLocalHash'] === 'string' ? raw['lastSyncedLocalHash'] : null,
    failureCount:
      typeof rawFailureCount === 'number' && Number.isFinite(rawFailureCount) && rawFailureCount > 0
        ? Math.floor(rawFailureCount)
        : 0,
  };
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await safeWrite(SYNC_STATE_KEY, state);
}

function parseBackend(value: unknown): BackendSettings | null {
  if (!isRecord(value)) return null;
  const kind = value['backend'];
  if (kind === 'webdav') {
    return {
      backend: 'webdav',
      endpoint: typeof value['endpoint'] === 'string' ? value['endpoint'] : '',
      username: typeof value['username'] === 'string' ? value['username'] : '',
      password: typeof value['password'] === 'string' ? value['password'] : '',
      path: typeof value['path'] === 'string' ? value['path'] : '',
    };
  }
  if (kind === 's3') {
    return {
      backend: 's3',
      endpoint: typeof value['endpoint'] === 'string' ? value['endpoint'] : '',
      region: typeof value['region'] === 'string' ? value['region'] : '',
      bucket: typeof value['bucket'] === 'string' ? value['bucket'] : '',
      prefix: typeof value['prefix'] === 'string' ? value['prefix'] : '',
      accessKey: typeof value['accessKey'] === 'string' ? value['accessKey'] : '',
      secretKey: typeof value['secretKey'] === 'string' ? value['secretKey'] : '',
      pathStyle: value['pathStyle'] === true,
      forceHeadFallback: value['forceHeadFallback'] === true,
    };
  }
  return null;
}

export async function getSettings(): Promise<Settings> {
  const raw = await safeRead(SETTINGS_KEY);
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS };
  const rawInterval = raw['syncIntervalMinutes'];
  return {
    backend: parseBackend(raw['backend']),
    syncIntervalMinutes:
      typeof rawInterval === 'number' && Number.isFinite(rawInterval)
        ? rawInterval
        : DEFAULT_SETTINGS.syncIntervalMinutes,
    encryptionEnabled: raw['encryptionEnabled'] === true,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await safeWrite(SETTINGS_KEY, settings);
}

export async function getView(): Promise<ManagerView> {
  const raw = await safeRead(VIEW_KEY);
  return raw === 'cards' ? 'cards' : 'table';
}

export async function saveView(view: ManagerView): Promise<void> {
  await safeWrite(VIEW_KEY, view);
}
