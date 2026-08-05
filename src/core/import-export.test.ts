import { describe, expect, it } from 'vitest';
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
});

describe('parseImportFile', () => {
  it('round-trips an export', () => {
    const { json } = exportStoreJson(STORE);
    expect(parseImportFile(json)).toEqual(STORE);
  });

  it('imports a schema v1 backup with original timestamps', () => {
    const v1 = JSON.stringify({
      schemaVersion: 1,
      notes: { jack: { handle: 'jack', text: 'hi', createdAt: 5, updatedAt: 6 } },
    });
    const imported = parseImportFile(v1);
    expect(imported?.schemaVersion).toBe(2);
    expect(imported?.tombstones).toEqual({});
    expect(imported?.notes['jack']?.createdAt).toBe(5);
    expect(imported?.notes['jack']?.updatedAt).toBe(6);
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
});
