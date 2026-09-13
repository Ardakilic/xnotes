import { emptyAliases, toAliasStore, type AliasStore } from './aliases';
import { toStoreV2 } from './storage';
import type { StoreV2 } from './types';

export interface ParsedImport {
  store: StoreV2;
  aliases: AliasStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function exportStoreJson(
  store: StoreV2,
  aliases?: AliasStore,
): { filename: string; json: string } {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return {
    filename: `xnotes-backup-${year}${month}${day}.json`,
    json: JSON.stringify(aliases === undefined ? store : { ...store, aliases }),
  };
}

export function parseImportFile(text: string): ParsedImport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const store = toStoreV2(parsed);
  if (store === null || !isRecord(parsed)) return null;
  return { store, aliases: toAliasStore(parsed['aliases']) ?? emptyAliases() };
}
