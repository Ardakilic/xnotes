import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptyAliases,
  getAlias,
  lookupByUserId,
  mergeAliases,
  recordObservation,
  toAliasStore,
  type AliasStore,
} from './aliases';
import { exportStoreJson, parseImportFile } from './import-export';
import { getAliases, saveAliases } from './storage';
import { encodeStore } from '../sync/scheduler';
import type { StoreV2 } from './types';

beforeEach(() => {
  fakeBrowser.reset();
});

function storeWithNote(): StoreV2 {
  return {
    schemaVersion: 2,
    notes: {
      jack: {
        handle: 'jack',
        handleLower: 'jack',
        text: 'hi',
        color: null,
        createdAt: 1,
        updatedAt: 2,
      },
    },
    tombstones: {},
  };
}

describe('recordObservation / getAlias / lookupByUserId', () => {
  it('round-trips a learned binding in both directions', () => {
    const next = recordObservation(emptyAliases(), 'SomeHandle', '123', 500);
    expect(getAlias(next, 'somehandle')?.userId).toBe('123');
    expect(getAlias(next, '@SOMEHANDLE')?.userId).toBe('123');
    expect(lookupByUserId(next, '123')).toEqual(['somehandle']);
  });

  it('records the observation time', () => {
    const next = recordObservation(emptyAliases(), 'jack', '123', 777);
    expect(getAlias(next, 'jack')?.observedAt).toBe(777);
  });

  it('overwrites the binding on re-learn', () => {
    const first = recordObservation(emptyAliases(), 'jack', '111', 100);
    const second = recordObservation(first, 'jack', '222', 200);
    expect(getAlias(second, 'jack')).toEqual({ userId: '222', observedAt: 200 });
    expect(lookupByUserId(second, '111')).toEqual([]);
    expect(lookupByUserId(second, '222')).toEqual(['jack']);
  });

  it('ignores non-digit user IDs and empty handles', () => {
    const base = recordObservation(emptyAliases(), 'jack', '123', 100);
    expect(recordObservation(base, 'bob', 'abc', 200)).toBe(base);
    expect(recordObservation(base, '   ', '456', 200)).toBe(base);
    expect(getAlias(base, 'bob')).toBeNull();
  });
});

describe('toAliasStore', () => {
  it('drops invalid entries and normalizes keys', () => {
    const parsed = toAliasStore({
      Good: { userId: '123', observedAt: 5 },
      bad: { userId: 'abc', observedAt: 5 },
      alsobad: 'nope',
      '': { userId: '123', observedAt: 1 },
    });
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {})).toEqual(['good']);
    expect(getAlias(parsed ?? emptyAliases(), 'GOOD')?.userId).toBe('123');
  });

  it('returns null for non-record input', () => {
    expect(toAliasStore('garbage')).toBeNull();
    expect(toAliasStore([])).toBeNull();
    expect(toAliasStore(null)).toBeNull();
  });
});

describe('alias storage round-trip', () => {
  it('saves and reads back through fakeBrowser', async () => {
    expect((await getAliases()).aliases).toEqual({});
    expect((await getAliases()).ok).toBe(true);
    const next = recordObservation(emptyAliases(), 'jack', '123', 100);
    await saveAliases(next);
    expect(await getAliases()).toEqual({
      aliases: { jack: { userId: '123', observedAt: 100 } },
      ok: true,
    });
  });

  it('reads an empty store with ok:true when the blob is invalid', async () => {
    const store: AliasStore = Object.create(null);
    store['jack'] = { userId: 'not-digits', observedAt: 1 };
    await saveAliases(store);
    expect(await getAliases()).toEqual({ aliases: {}, ok: true });
  });
});

describe('mergeAliases', () => {
  it('unions disjoint maps', () => {
    const local = recordObservation(emptyAliases(), 'jack', '111', 100);
    const imported = recordObservation(emptyAliases(), 'jill', '222', 200);
    expect(mergeAliases(local, imported)).toEqual({
      jack: { userId: '111', observedAt: 100 },
      jill: { userId: '222', observedAt: 200 },
    });
  });

  it('keeps the newer observation on conflict', () => {
    const local = recordObservation(emptyAliases(), 'jack', '111', 100);
    const imported = recordObservation(emptyAliases(), 'jack', '222', 200);
    expect(getAlias(mergeAliases(local, imported), 'jack')).toEqual({
      userId: '222',
      observedAt: 200,
    });
    expect(getAlias(mergeAliases(imported, local), 'jack')).toEqual({
      userId: '222',
      observedAt: 200,
    });
  });

  it('leaves the local store untouched', () => {
    const local = recordObservation(emptyAliases(), 'jack', '111', 100);
    const imported = recordObservation(emptyAliases(), 'jill', '222', 200);
    mergeAliases(local, imported);
    expect(local).toEqual({ jack: { userId: '111', observedAt: 100 } });
  });
});

describe('local-only exclusion', () => {
  it('keeps alias data out of the sync blob while the export file carries it', () => {
    const store = storeWithNote();
    const aliases = recordObservation(emptyAliases(), 'aliasedhandle', '999888777', 100);
    const blobText = new TextDecoder().decode(encodeStore(store));
    expect(blobText).not.toContain('999888777');
    expect(blobText).not.toContain('aliasedhandle');
    const { json } = exportStoreJson(store, aliases);
    expect(json).toContain('999888777');
    expect(json).toContain('aliasedhandle');
    expect(parseImportFile(json)).toEqual({
      store,
      aliases: { aliasedhandle: { userId: '999888777', observedAt: 100 } },
    });
    expect(getAlias(aliases, 'aliasedhandle')?.userId).toBe('999888777');
  });
});
