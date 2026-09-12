import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportStoreJson } from './import-export';
import {
  CORRUPT_PREFIX,
  deleteNote,
  emptyStore,
  getSettings,
  getStore,
  getSyncState,
  getView,
  saveSettings,
  saveStore,
  saveSyncState,
  saveView,
  SETTINGS_KEY,
  StorageWriteError,
  STORE_KEY,
  subscribeToStoreChanges,
  toNoteRecord,
  toStoreV2,
  upsertNote,
} from './storage';
import type { StoreV2, SyncState } from './types';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('toNoteRecord', () => {
  it('defaults missing updatedAt to createdAt', () => {
    expect(toNoteRecord({ handle: 'jack', text: 'hi', createdAt: 100 })).toEqual({
      handle: 'jack',
      handleLower: 'jack',
      text: 'hi',
      color: null,
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it('defaults invalid color to null, non-string text to empty, missing createdAt to 0', () => {
    expect(toNoteRecord({ handle: 'jack', color: 42, text: 7 })).toEqual({
      handle: 'jack',
      handleLower: 'jack',
      text: '',
      color: null,
      createdAt: 0,
      updatedAt: 0,
    });
  });

  it('strips one leading @ and trims, keeping original casing', () => {
    const record = toNoteRecord({ handle: ' @SomeUser ', text: 'hi' });
    expect(record?.handle).toBe('SomeUser');
    expect(record?.handleLower).toBe('someuser');
  });

  it('uses the key fallback when the handle field is missing or not a string', () => {
    expect(toNoteRecord({ text: 'hi' }, 'fallback')?.handle).toBe('fallback');
    expect(toNoteRecord({ handle: 42, text: 'hi' }, 'fallback')?.handle).toBe('fallback');
  });

  it('returns null for an empty handle and non-object input', () => {
    expect(toNoteRecord({ handle: '', text: 'hi' }, 'fallback')).toBeNull();
    expect(toNoteRecord({ handle: '@' })).toBeNull();
    expect(toNoteRecord({ handle: '   ' })).toBeNull();
    expect(toNoteRecord('nope')).toBeNull();
    expect(toNoteRecord(null)).toBeNull();
  });
});

describe('toStoreV2', () => {
  it('keeps valid records keyed by handleLower and drops invalid ones', () => {
    const store = toStoreV2({
      schemaVersion: 2,
      notes: {
        good: { handle: 'Good', text: 'hi', createdAt: 1, updatedAt: 2, color: 'red' },
        bad: { handle: '', text: 'dropped' },
      },
      tombstones: { gone: 123, notanumber: 'x' },
    });
    expect(store).not.toBeNull();
    expect(Object.keys(store?.notes ?? {})).toEqual(['good']);
    expect(store?.notes['good']?.handle).toBe('Good');
    expect(store?.tombstones).toEqual({ gone: 123 });
  });

  it('converts schema v1 with an empty tombstone map', () => {
    const store = toStoreV2({
      schemaVersion: 1,
      notes: { jack: { handle: 'jack', text: 'hi', createdAt: 5, updatedAt: 6 } },
    });
    expect(store?.schemaVersion).toBe(2);
    expect(store?.tombstones).toEqual({});
    expect(store?.notes['jack']?.text).toBe('hi');
  });

  it('rejects non-objects, unknown schema versions, and missing notes', () => {
    expect(toStoreV2('garbage')).toBeNull();
    expect(toStoreV2(null)).toBeNull();
    expect(toStoreV2([])).toBeNull();
    expect(toStoreV2({ schemaVersion: 3, notes: {} })).toBeNull();
    expect(toStoreV2({ notes: {} })).toBeNull();
    expect(toStoreV2({ schemaVersion: 2 })).toBeNull();
    expect(toStoreV2({ schemaVersion: 2, notes: 'nope' })).toBeNull();
  });

  it('canonicalizes tombstone keys (lowercase, stripped @) and keeps the greatest timestamp', () => {
    const store = toStoreV2({
      schemaVersion: 2,
      notes: {},
      tombstones: {
        '@Jack': 100,
        jack: 200,
        JACK: 150,
        '  bob ': 300,
      },
    });
    expect(store?.tombstones).toEqual({ jack: 200, bob: 300 });
  });

  it('preserves __proto__ as a regular key via null-prototype maps', () => {
    const raw = JSON.parse(
      '{"schemaVersion":2,"notes":{"__proto__":{"handle":"__proto__","text":"hi","createdAt":1,"updatedAt":2}},"tombstones":{}}',
    );
    const store = toStoreV2(raw);
    expect(store?.notes['__proto__']?.text).toBe('hi');
    expect(Object.getPrototypeOf(store?.notes)).toBeNull();
  });
});

describe('store round-trip', () => {
  it('reads back exactly what was saved', async () => {
    const store: StoreV2 = {
      schemaVersion: 2,
      notes: {
        jack: {
          handle: 'jack',
          handleLower: 'jack',
          text: 'hi',
          color: 'teal',
          createdAt: 1,
          updatedAt: 2,
        },
      },
      tombstones: { gone: 99 },
    };
    await saveStore(store);
    expect(await getStore()).toEqual(store);
  });

  it('returns an empty store when nothing is stored', async () => {
    expect(await getStore()).toEqual(emptyStore());
  });
});

describe('corrupt store quarantine', () => {
  it('moves the raw blob to a quarantine key and starts fresh', async () => {
    await fakeBrowser.storage.local.set({ [STORE_KEY]: 'total-garbage' });
    expect(await getStore()).toEqual(emptyStore());
    const all = await fakeBrowser.storage.local.get(null);
    const corruptKeys = Object.keys(all).filter((key) => key.startsWith(CORRUPT_PREFIX));
    expect(corruptKeys).toHaveLength(1);
    const corruptKey = corruptKeys[0];
    expect(corruptKey).toBeDefined();
    if (corruptKey !== undefined) expect(all[corruptKey]).toBe('total-garbage');
    expect(all[STORE_KEY]).toBeUndefined();
    expect(await getStore()).toEqual(emptyStore());
  });
});

describe('handle normalization', () => {
  it('strips @, keys case-insensitively, preserves display case', async () => {
    await upsertNote('@SomeUser', 'note', null, 100);
    const store = await getStore();
    expect(Object.keys(store.notes)).toEqual(['someuser']);
    expect(store.notes['someuser']?.handle).toBe('SomeUser');
  });

  it('treats differently-cased handles as the same note', async () => {
    await upsertNote('@SomeUser', 'first', null, 100);
    await upsertNote('SOMEUSER', 'second', null, 200);
    const store = await getStore();
    expect(Object.keys(store.notes)).toEqual(['someuser']);
    expect(store.notes['someuser']?.text).toBe('second');
  });
});

describe('upsert semantics', () => {
  it('preserves createdAt and advances updatedAt', async () => {
    await upsertNote('jack', 'v1', null, 100);
    await upsertNote('jack', 'v2', 'red', 200);
    const note = (await getStore()).notes['jack'];
    expect(note?.createdAt).toBe(100);
    expect(note?.updatedAt).toBe(200);
    expect(note?.text).toBe('v2');
    expect(note?.color).toBe('red');
  });

  it('sets createdAt on first creation', async () => {
    await upsertNote('jack', 'v1', null, 100);
    const note = (await getStore()).notes['jack'];
    expect(note?.createdAt).toBe(100);
    expect(note?.updatedAt).toBe(100);
  });

  it('deletes on whitespace-only text and writes a tombstone', async () => {
    await upsertNote('jack', 'hello', null, 100);
    await upsertNote('jack', '   ', null, 200);
    const store = await getStore();
    expect(store.notes['jack']).toBeUndefined();
    expect(store.tombstones['jack']).toBe(200);
  });

  it('writes a tombstone on whitespace-only text even when no local note exists', async () => {
    await upsertNote('jack', '   ', null, 200);
    const store = await getStore();
    expect(store.notes['jack']).toBeUndefined();
    expect(store.tombstones['jack']).toBe(200);
  });

  it('clears the tombstone when a note is re-added', async () => {
    await upsertNote('jack', 'hello', null, 100);
    await deleteNote('jack', 200);
    await upsertNote('jack', 'back', null, 300);
    const store = await getStore();
    expect(store.notes['jack']?.text).toBe('back');
    expect(store.tombstones['jack']).toBeUndefined();
  });
});

describe('deleteNote', () => {
  it('removes the note and writes a tombstone', async () => {
    await upsertNote('@jack', 'hello', null, 100);
    await deleteNote('JACK', 300);
    const store = await getStore();
    expect(store.notes['jack']).toBeUndefined();
    expect(store.tombstones['jack']).toBe(300);
  });
});

describe('subscribeToStoreChanges', () => {
  it('fires on store writes and stops after unsubscribe', async () => {
    const cb = vi.fn();
    const unsubscribe = subscribeToStoreChanges(cb);
    await upsertNote('jack', 'hello', null, 100);
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    await upsertNote('jack', 'again', null, 200);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('ignores changes to other keys and areas', async () => {
    const cb = vi.fn();
    const unsubscribe = subscribeToStoreChanges(cb);
    await fakeBrowser.storage.local.set({ unrelated: 1 });
    await fakeBrowser.storage.onChanged.trigger({}, 'sync');
    expect(cb).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('v1 store read from storage', () => {
  it('is converted to v2 on read', async () => {
    await fakeBrowser.storage.local.set({
      [STORE_KEY]: {
        schemaVersion: 1,
        notes: { jack: { handle: 'jack', text: 'hi', createdAt: 5, updatedAt: 6 } },
      },
    });
    const store = await getStore();
    expect(store.schemaVersion).toBe(2);
    expect(store.tombstones).toEqual({});
    expect(store.notes['jack']?.createdAt).toBe(5);
  });
});

describe('stale extension context', () => {
  it('fails soft instead of throwing', async () => {
    await upsertNote('jack', 'hello', null, 100);
    fakeBrowser.runtime.id = '';
    try {
      expect(await getStore()).toEqual(emptyStore());
      await expect(upsertNote('jack', 'x', null, 200)).resolves.toBeUndefined();
      await expect(deleteNote('jack')).resolves.toBeUndefined();
    } finally {
      fakeBrowser.runtime.id = 'test-extension-id';
    }
  });
});

describe('rejected storage reads', () => {
  it('upsertNote aborts without saving when the store read fails', async () => {
    await upsertNote('jack', 'original', null, 100);
    const spy = vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation(() => {
      throw new Error('storage read failed');
    });
    await expect(upsertNote('jack', 'changed', null, 200)).resolves.toBeUndefined();
    spy.mockRestore();
    const store = await getStore();
    expect(store.notes['jack']?.text).toBe('original');
  });

  it('deleteNote aborts without saving when the store read fails', async () => {
    await upsertNote('jack', 'original', null, 100);
    const spy = vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation(() => {
      throw new Error('storage read failed');
    });
    await expect(deleteNote('jack')).resolves.toBeUndefined();
    spy.mockRestore();
    const store = await getStore();
    expect(store.notes['jack']?.text).toBe('original');
  });
});

describe('rejected storage writes', () => {
  it('upsertNote rejects when the store write fails', async () => {
    await upsertNote('jack', 'original', null, 100);
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(() => {
      throw new Error('QUOTA_BYTES quota exceeded');
    });
    await expect(upsertNote('jack', 'changed', null, 200)).rejects.toBeInstanceOf(
      StorageWriteError,
    );
    spy.mockRestore();
    const store = await getStore();
    expect(store.notes['jack']?.text).toBe('original');
  });

  it('deleteNote rejects when the store write fails', async () => {
    await upsertNote('jack', 'original', null, 100);
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(() => {
      throw new Error('QUOTA_BYTES quota exceeded');
    });
    await expect(deleteNote('jack')).rejects.toBeInstanceOf(StorageWriteError);
    spy.mockRestore();
    const store = await getStore();
    expect(store.notes['jack']?.text).toBe('original');
  });

  it('saveStore rejects when the write fails (import/sync-merge path)', async () => {
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(() => {
      throw new Error('QUOTA_BYTES quota exceeded');
    });
    await expect(saveStore(emptyStore())).rejects.toBeInstanceOf(StorageWriteError);
    spy.mockRestore();
  });
});

describe('userId', () => {
  it('keeps valid digits-only userIds and drops invalid ones', () => {
    expect(toNoteRecord({ handle: 'jack', text: 'hi', userId: '123' })?.userId).toBe('123');
    expect(toNoteRecord({ handle: 'jack', text: 'hi', userId: 'abc' })?.userId).toBeUndefined();
    expect(toNoteRecord({ handle: 'jack', text: 'hi', userId: '12a' })?.userId).toBeUndefined();
    expect(toNoteRecord({ handle: 'jack', text: 'hi', userId: 42 })?.userId).toBeUndefined();
    expect(toNoteRecord({ handle: 'jack', text: 'hi' })?.userId).toBeUndefined();
  });

  it('round-trips userId through storage', async () => {
    await upsertNote('jack', 'hi', null, 100, '123');
    expect((await getStore()).notes['jack']?.userId).toBe('123');
  });

  it('attaches a valid userId and preserves the existing one on edits', async () => {
    await upsertNote('jack', 'v1', null, 100, '123');
    await upsertNote('jack', 'v2', 'red', 200);
    const note = (await getStore()).notes['jack'];
    expect(note?.text).toBe('v2');
    expect(note?.userId).toBe('123');
    await upsertNote('jack', 'v3', null, 300, 'not-digits');
    expect((await getStore()).notes['jack']?.userId).toBe('123');
    await upsertNote('bob', 'hi', null, 100, 'abc');
    expect((await getStore()).notes['bob']?.userId).toBeUndefined();
  });
});

describe('local-only keys', () => {
  it('round-trip sync state with safe defaults', async () => {
    expect(await getSyncState()).toEqual({
      deviceId: '',
      lastSyncAt: null,
      lastRemoteEtag: null,
      status: 'idle',
      lastError: null,
      lastSyncedLocalHash: null,
      failureCount: 0,
    });
    const state: SyncState = {
      deviceId: 'd1',
      lastSyncAt: 10,
      lastRemoteEtag: 'e',
      status: 'error',
      lastError: 'boom',
      lastSyncedLocalHash: 'h',
      failureCount: 2,
    };
    await saveSyncState(state);
    expect(await getSyncState()).toEqual(state);
  });

  it('round-trip settings and null out unknown backends', async () => {
    expect(await getSettings()).toEqual({
      backend: null,
      syncIntervalMinutes: 5,
      encryptionEnabled: false,
    });
    await saveSettings({ backend: null, syncIntervalMinutes: 10, encryptionEnabled: true });
    expect(await getSettings()).toEqual({
      backend: null,
      syncIntervalMinutes: 10,
      encryptionEnabled: true,
    });
    await fakeBrowser.storage.local.set({
      [SETTINGS_KEY]: {
        backend: { backend: 'ftp' },
        syncIntervalMinutes: 9,
        encryptionEnabled: true,
      },
    });
    expect(await getSettings()).toEqual({
      backend: null,
      syncIntervalMinutes: 9,
      encryptionEnabled: true,
    });
  });

  it('round-trip view with table default', async () => {
    expect(await getView()).toBe('table');
    await saveView('cards');
    expect(await getView()).toBe('cards');
  });

  it('never appear in the serialized store', async () => {
    await upsertNote('jack', 'hello', null, 100);
    await saveSyncState({
      deviceId: 'device-1',
      lastSyncAt: 5,
      lastRemoteEtag: 'etag',
      status: 'idle',
      lastError: null,
      lastSyncedLocalHash: 'hash',
      failureCount: 0,
    });
    await saveSettings({ backend: null, syncIntervalMinutes: 5, encryptionEnabled: false });
    await saveView('cards');
    const { json } = exportStoreJson(await getStore());
    expect(json).not.toContain('deviceId');
    expect(json).not.toContain('device-1');
    expect(json).not.toContain('syncIntervalMinutes');
    expect(json).not.toContain('encryptionEnabled');
    expect(json).toContain('jack');
  });
});
