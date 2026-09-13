/** A learned binding of one lowercased handle to the stable X numeric user ID. */
export interface AliasRecord {
  userId: string;
  observedAt: number;
}

/** Local-only learned bindings, keyed by lowercased handle. Never synced. */
export type AliasStore = Record<string, AliasRecord>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDigits(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function normalizeKey(handle: string): string {
  return handle.trim().replace(/^@/, '').trim().toLowerCase();
}

function isAliasRecord(value: unknown): value is AliasRecord {
  if (!isRecord(value)) return false;
  if (!isDigits(value['userId'])) return false;
  const observedAt = value['observedAt'];
  return typeof observedAt === 'number' && Number.isFinite(observedAt);
}

/**
 * Validate-by-construction parser for a persisted alias store. Rebuilds a
 * valid `AliasStore` from `unknown`, normalizing keys and skipping invalid
 * entries; returns `null` when the value is not a record at all.
 */
export function toAliasStore(value: unknown): AliasStore | null {
  if (!isRecord(value)) return null;
  const store: AliasStore = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    if (!isAliasRecord(entry)) continue;
    const normalized = normalizeKey(key);
    if (normalized === '') continue;
    store[normalized] = { userId: entry.userId, observedAt: entry.observedAt };
  }
  return store;
}

/**
 * Return a fresh empty alias store.
 */
export function emptyAliases(): AliasStore {
  return Object.create(null);
}

/**
 * Look up the learned binding for a handle (normalized before lookup).
 * Returns `null` when nothing was learned for the handle.
 */
export function getAlias(store: AliasStore, handle: string): AliasRecord | null {
  const normalized = normalizeKey(handle);
  if (normalized === '') return null;
  const entry = store[normalized];
  return isAliasRecord(entry) ? entry : null;
}

/**
 * Find every lowercased handle bound to the given user ID. Scans values;
 * O(n) is fine for a per-device learned cache.
 */
export function lookupByUserId(store: AliasStore, userId: string): string[] {
  if (!isDigits(userId)) return [];
  const handles: string[] = [];
  for (const [key, entry] of Object.entries(store)) {
    if (isAliasRecord(entry) && entry.userId === userId) handles.push(key);
  }
  return handles;
}

/**
 * Pure observation update: return a new store with `handle` bound to
 * `userId` at `now`. Returns the store unchanged when the user ID is not
 * digits-only or the handle is empty.
 */
export function recordObservation(
  store: AliasStore,
  handle: string,
  userId: string,
  now?: number,
): AliasStore {
  if (!isDigits(userId)) return store;
  const normalized = normalizeKey(handle);
  if (normalized === '') return store;
  const next: AliasStore = Object.create(null);
  Object.assign(next, store);
  next[normalized] = { userId, observedAt: now ?? Date.now() };
  return next;
}

export function mergeAliases(local: AliasStore, imported: AliasStore): AliasStore {
  const next: AliasStore = Object.create(null);
  Object.assign(next, local);
  for (const [key, entry] of Object.entries(imported)) {
    const current = next[key];
    if (current === undefined || entry.observedAt >= current.observedAt) {
      next[key] = { userId: entry.userId, observedAt: entry.observedAt };
    }
  }
  return next;
}
