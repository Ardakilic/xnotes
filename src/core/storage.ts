import { browser } from 'wxt/browser';
import { emptyAliases, toAliasStore, type AliasStore } from './aliases';
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
export const ALIASES_KEY = 'xnotes:aliases';
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

type ReadResult = { ok: true; value: unknown } | { ok: false };

async function safeRead(key: string): Promise<ReadResult> {
  if (!contextAlive()) return { ok: true, value: undefined };
  try {
    const result = await browser.storage.local.get(key);
    return { ok: true, value: result[key] };
  } catch {
    // ponytail: fail-soft — storage errors return failure, not absence
    return { ok: false };
  }
}

export class StorageWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageWriteError';
  }
}

async function safeWrite(key: string, value: unknown): Promise<void> {
  if (!contextAlive()) return;
  try {
    await browser.storage.local.set({ [key]: value });
  } catch {
    // ponytail: fail-soft for bookkeeping keys only (sync-state/settings/view/quarantine) —
    // store data goes through strictWrite so write failures surface instead of lying
  }
}

async function strictWrite(key: string, value: unknown): Promise<void> {
  if (!contextAlive()) return;
  try {
    await browser.storage.local.set({ [key]: value });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new StorageWriteError(`Could not save — browser storage write failed (${cause})`);
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

/**
 * Validate-by-construction parser for a stored note. Rebuilds a valid
 * `NoteRecord` from `unknown`, coercing or dropping invalid fields; a
 * `userId` is kept only when it is a digits-only string, else omitted.
 */
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
  const rawUserId = value['userId'];
  if (typeof rawUserId === 'string' && /^\d+$/.test(rawUserId)) {
    return { handle, handleLower, text, color, createdAt, updatedAt, userId: rawUserId };
  }
  return { handle, handleLower, text, color, createdAt, updatedAt };
}

export function toStoreV2(value: unknown): StoreV2 | null {
  if (!isRecord(value)) return null;
  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== 1 && schemaVersion !== 2) return null;
  const rawNotes = value['notes'];
  if (!isRecord(rawNotes)) return null;
  const notes: Record<string, NoteRecord> = Object.create(null);
  for (const [key, entry] of Object.entries(rawNotes)) {
    const record = toNoteRecord(entry, key);
    if (record !== null) notes[record.handleLower] = record;
  }
  const tombstones: Record<string, number> = Object.create(null);
  if (schemaVersion === 2) {
    const rawTombstones = value['tombstones'];
    if (isRecord(rawTombstones)) {
      for (const [key, deletedAt] of Object.entries(rawTombstones)) {
        if (typeof deletedAt === 'number' && Number.isFinite(deletedAt)) {
          const normalized = normalizeHandle(key).toLowerCase();
          if (normalized === '') continue;
          const existing = tombstones[normalized];
          if (existing === undefined || deletedAt > existing) {
            tombstones[normalized] = deletedAt;
          }
        }
      }
    }
  }
  return { schemaVersion: 2, notes, tombstones };
}

export function emptyStore(): StoreV2 {
  return { schemaVersion: 2, notes: Object.create(null), tombstones: Object.create(null) };
}

export async function getStore(): Promise<StoreV2> {
  const raw = await safeRead(STORE_KEY);
  if (!raw.ok) return emptyStore();
  if (raw.value === undefined) return emptyStore();
  const parsed = toStoreV2(raw.value);
  if (parsed !== null) return parsed;
  // ponytail: millisecond key — two corruptions in the same ms would collide, acceptable
  await safeWrite(CORRUPT_PREFIX + String(Date.now()), raw.value);
  await safeRemove(STORE_KEY);
  return emptyStore();
}

export async function saveStore(store: StoreV2): Promise<void> {
  await strictWrite(STORE_KEY, store);
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@/, '').trim();
}

/**
 * Create or update the note under `handle` (whitespace-only text deletes).
 * A digits-only `userId` attaches the stable X user ID to the note; when
 * omitted or invalid the existing note's ID is preserved so edits never
 * strip learned identity. The empty-text delete path is unchanged.
 */
export async function upsertNote(
  handle: string,
  text: string,
  color: ColorKey | null,
  now?: number,
  userId?: string,
): Promise<void> {
  const normalized = normalizeHandle(handle);
  if (normalized === '') return;
  const handleLower = normalized.toLowerCase();
  const timestamp = now ?? Date.now();
  const raw = await safeRead(STORE_KEY);
  if (!raw.ok) return;
  const store = raw.value === undefined ? emptyStore() : (toStoreV2(raw.value) ?? emptyStore());
  const existing = store.notes[handleLower];
  if (text.trim() === '') {
    if (existing !== undefined || store.tombstones[handleLower] === undefined) {
      delete store.notes[handleLower];
      store.tombstones[handleLower] = timestamp;
      await saveStore(store);
    }
    return;
  }
  const next: NoteRecord = {
    handle: normalized,
    handleLower,
    text,
    color,
    createdAt: existing !== undefined ? existing.createdAt : timestamp,
    updatedAt: timestamp,
  };
  if (typeof userId === 'string' && /^\d+$/.test(userId)) {
    next.userId = userId;
  } else if (existing?.userId !== undefined) {
    next.userId = existing.userId;
  }
  store.notes[handleLower] = next;
  delete store.tombstones[handleLower];
  await saveStore(store);
}

export async function deleteNote(handle: string, now?: number): Promise<void> {
  const normalized = normalizeHandle(handle);
  if (normalized === '') return;
  const handleLower = normalized.toLowerCase();
  const raw = await safeRead(STORE_KEY);
  if (!raw.ok) return;
  const store = raw.value === undefined ? emptyStore() : (toStoreV2(raw.value) ?? emptyStore());
  delete store.notes[handleLower];
  store.tombstones[handleLower] = now ?? Date.now();
  await saveStore(store);
}

/** Result of an explicit orphan-reassign move. */
export type ReassignResult = 'moved' | 'target-occupied' | 'nothing-to-move';

/**
 * Atomically move the note at `sourceHandle` to `targetHandle` in one store
 * read + one write: copy text/color/createdAt, bump updatedAt, write a
 * tombstone for the source, and clear any tombstone on the target. The target
 * stamps its recorded alias ID when known, else omits userId (fresh,
 * re-learned later) — never carries the orphan's possibly-stale ID. Returns
 * 'target-occupied' without writing when the target key already holds a note,
 * and 'nothing-to-move' when the source holds none (or handles are
 * invalid/identical after normalization, or the store read fails fail-soft).
 * Never throws beyond saveStore's StorageWriteError.
 */
export async function reassignNote(
  sourceHandle: string,
  targetHandle: string,
  now?: number,
): Promise<ReassignResult> {
  const source = normalizeHandle(sourceHandle);
  const target = normalizeHandle(targetHandle);
  if (source === '' || target === '') return 'nothing-to-move';
  const sourceLower = source.toLowerCase();
  const targetLower = target.toLowerCase();
  if (sourceLower === targetLower) return 'nothing-to-move';
  const timestamp = now ?? Date.now();
  const raw = await safeRead(STORE_KEY);
  if (!raw.ok) return 'nothing-to-move';
  const store = raw.value === undefined ? emptyStore() : (toStoreV2(raw.value) ?? emptyStore());
  const existing = store.notes[sourceLower];
  if (existing === undefined) return 'nothing-to-move';
  if (store.notes[targetLower] !== undefined) return 'target-occupied';
  const aliasRead = await getAliases();
  const aliases = aliasRead.aliases;
  const next: NoteRecord = {
    handle: target,
    handleLower: targetLower,
    text: existing.text,
    color: existing.color,
    createdAt: existing.createdAt,
    updatedAt: timestamp,
  };
  const aliasUserId = aliases[targetLower]?.userId;
  if (aliasUserId !== undefined) next.userId = aliasUserId;
  store.notes[targetLower] = next;
  delete store.tombstones[targetLower];
  delete store.notes[sourceLower];
  store.tombstones[sourceLower] = timestamp;
  await saveStore(store);
  return 'moved';
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
  if (!raw.ok) return { ...DEFAULT_SYNC_STATE };
  if (!isRecord(raw.value)) return { ...DEFAULT_SYNC_STATE };
  const rawStatus = raw.value['status'];
  const status: SyncStatus = rawStatus === 'syncing' || rawStatus === 'error' ? rawStatus : 'idle';
  const rawLastSyncAt = raw.value['lastSyncAt'];
  const rawFailureCount = raw.value['failureCount'];
  return {
    deviceId: typeof raw.value['deviceId'] === 'string' ? raw.value['deviceId'] : '',
    lastSyncAt:
      typeof rawLastSyncAt === 'number' && Number.isFinite(rawLastSyncAt) ? rawLastSyncAt : null,
    lastRemoteEtag:
      typeof raw.value['lastRemoteEtag'] === 'string' ? raw.value['lastRemoteEtag'] : null,
    status,
    lastError: typeof raw.value['lastError'] === 'string' ? raw.value['lastError'] : null,
    lastSyncedLocalHash:
      typeof raw.value['lastSyncedLocalHash'] === 'string'
        ? raw.value['lastSyncedLocalHash']
        : null,
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
  if (!raw.ok || !isRecord(raw.value)) return { ...DEFAULT_SETTINGS };
  const rawInterval = raw.value['syncIntervalMinutes'];
  return {
    backend: parseBackend(raw.value['backend']),
    syncIntervalMinutes:
      typeof rawInterval === 'number' && Number.isFinite(rawInterval)
        ? rawInterval
        : DEFAULT_SETTINGS.syncIntervalMinutes,
    encryptionEnabled: raw.value['encryptionEnabled'] === true,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await safeWrite(SETTINGS_KEY, settings);
}

export async function getView(): Promise<ManagerView> {
  const raw = await safeRead(VIEW_KEY);
  if (!raw.ok) return 'table';
  return raw.value === 'cards' ? 'cards' : 'table';
}

export async function saveView(view: ManagerView): Promise<void> {
  await safeWrite(VIEW_KEY, view);
}

/**
 * Result of reading the local-only alias store. `ok` is false only when the
 * underlying storage read itself failed; invalid blobs still yield an empty
 * store with `ok: true` (fail-soft, never throws).
 */
export interface AliasReadResult {
  aliases: AliasStore;
  ok: boolean;
}

/**
 * Read the local-only learned handle→userId alias store. Fail-soft: any
 * invalid blob yields an empty store with `ok: true`; only a storage-read
 * failure yields `ok: false`. Never synced.
 */
export async function getAliases(): Promise<AliasReadResult> {
  const raw = await safeRead(ALIASES_KEY);
  if (!raw.ok) return { aliases: emptyAliases(), ok: false };
  if (raw.value === undefined) return { aliases: emptyAliases(), ok: true };
  return { aliases: toAliasStore(raw.value) ?? emptyAliases(), ok: true };
}

/**
 * Persist the local-only learned handle→userId alias store. Fail-soft like
 * other bookkeeping keys; never part of the synced `StoreV2` blob.
 */
export async function saveAliases(store: AliasStore): Promise<void> {
  await safeWrite(ALIASES_KEY, store);
}
