import { toStoreV2 } from './storage';
import type { StoreV2 } from './types';

export function exportStoreJson(store: StoreV2): { filename: string; json: string } {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return {
    filename: `xnotes-backup-${year}${month}${day}.json`,
    json: JSON.stringify(store),
  };
}

export function parseImportFile(text: string): StoreV2 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return toStoreV2(parsed);
}
