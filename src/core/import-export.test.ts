import { describe, expect, it } from 'vitest';
import { emptyAliases, recordObservation } from './aliases';
import { exportStoreJson, parseImportFile } from './import-export';
import type { StoreV2 } from './types';

const STORE: StoreV2 = {
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
  tombstones: { gone: 999 },
};

describe('exportStoreJson', () => {
  it('names the file xnotes-backup-YYYYMMDD.json', () => {
    const { filename } = exportStoreJson(STORE);
    expect(filename).toMatch(/^xnotes-backup-\d{8}\.json$/);
  });

  it('serializes the full store including tombstones', () => {
    const { json } = exportStoreJson(STORE);
    const parsed: unknown = JSON.parse(json);
    expect(parsed).toEqual(STORE);
    expect(json).toContain('tombstones');
  });

  it('omits the aliases field when no aliases are passed', () => {
    const { json } = exportStoreJson(STORE);
    expect(json).not.toContain('aliases');
  });

  it('carries the alias map when aliases are passed', () => {
    const aliases = recordObservation(emptyAliases(), 'oldhandle', '123', 100);
    const { json } = exportStoreJson(STORE, aliases);
    expect(json).toContain('oldhandle');
    expect(json).toContain('123');
  });
});

describe('parseImportFile', () => {
  it('round-trips an export', () => {
    const { json } = exportStoreJson(STORE);
    expect(parseImportFile(json)).toEqual({ store: STORE, aliases: {} });
  });

  it('imports a schema v1 backup with original timestamps', () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      notes: { jack: { handle: 'jack', text: 'hi', createdAt: 5, updatedAt: 6 } },
    });
    const imported = parseImportFile(v1);
    expect(imported?.store.schemaVersion).toBe(2);
    expect(imported?.store.tombstones).toEqual({});
    expect(imported?.store.notes['jack']?.createdAt).toBe(5);
    expect(imported?.store.notes['jack']?.updatedAt).toBe(6);
    expect(imported?.aliases).toEqual({});
  });

  it('rejects invalid JSON', () => {
    expect(parseImportFile('{not json')).toBeNull();
    expect(parseImportFile('')).toBeNull();
  });

  it('rejects JSON that is not a store', () => {
    expect(parseImportFile(JSON.stringify({ foo: 1 }))).toBeNull();
    expect(parseImportFile(JSON.stringify([1, 2]))).toBeNull();
    expect(parseImportFile(JSON.stringify({ schemaVersion: 3, notes: {} }))).toBeNull();
    expect(parseImportFile('"just a string"')).toBeNull();
  });

  it('falls back to an empty alias map when the aliases field is invalid', () => {
    const raw = JSON.stringify({ ...STORE, aliases: { oldhandle: 'garbage' } });
    const imported = parseImportFile(raw);
    expect(imported?.store).toEqual(STORE);
    expect(imported?.aliases).toEqual({});
  });
});

describe('userId', () => {
  it('round-trips userId through export and import', () => {
    const withId: StoreV2 = {
      schemaVersion: 2,
      notes: {
        jack: {
          handle: 'jack',
          handleLower: 'jack',
          text: 'hi',
          color: null,
          createdAt: 1,
          updatedAt: 2,
          userId: '123',
        },
      },
      tombstones: {},
    };
    const { json } = exportStoreJson(withId);
    expect(json).toContain('123');
    expect(parseImportFile(json)).toEqual({ store: withId, aliases: {} });
  });

  it('drops invalid userIds on import', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      notes: { jack: { handle: 'jack', text: 'hi', createdAt: 1, updatedAt: 2, userId: 'abc' } },
      tombstones: {},
    });
    expect(parseImportFile(raw)?.store.notes['jack']?.userId).toBeUndefined();
  });
});

describe('rename history round-trip', () => {
  it('preserves formerly hint data across export into empty state', () => {
    const renamed: StoreV2 = {
      schemaVersion: 2,
      notes: {
        newhandle: {
          handle: 'newhandle',
          handleLower: 'newhandle',
          text: 'moved',
          color: null,
          createdAt: 1,
          updatedAt: 400,
          userId: '123',
        },
      },
      tombstones: { oldhandle: 350 },
    };
    const aliases = recordObservation(
      recordObservation(emptyAliases(), 'oldhandle', '123', 100),
      'newhandle',
      '123',
      350,
    );
    const { json } = exportStoreJson(renamed, aliases);
    const imported = parseImportFile(json);
    expect(imported?.store).toEqual(renamed);
    expect(imported?.aliases).toEqual({
      oldhandle: { userId: '123', observedAt: 100 },
      newhandle: { userId: '123', observedAt: 350 },
    });
  });
});
