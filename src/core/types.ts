import type { ColorKey } from './colors';

export interface NoteRecord {
  /** Display case, no leading "@". */
  handle: string;
  /** Lowercased handle — the storage key. */
  handleLower: string;
  text: string;
  /** Palette key; hex values live only in CSS. */
  color: ColorKey | null;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms — the LWW clock. */
  updatedAt: number;
}

export interface StoreV2 {
  schemaVersion: 2;
  /** Key = handleLower. */
  notes: Record<string, NoteRecord>;
  /** handleLower -> deletedAt epoch ms. */
  tombstones: Record<string, number>;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncState {
  deviceId: string;
  lastSyncAt: number | null;
  lastRemoteEtag: string | null;
  status: SyncStatus;
  lastError: string | null;
  /** Hash of the local store as of the last successful sync — powers the 304 fast path. */
  lastSyncedLocalHash: string | null;
  /** Consecutive failed cycles — drives exponential backoff. */
  failureCount: number;
}

export interface WebdavSettings {
  backend: 'webdav';
  endpoint: string;
  username: string;
  password: string;
  /** Blob path on the server, default `/xnotes/notes.json`. */
  path: string;
}

export interface S3Settings {
  backend: 's3';
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
  /** Provider known to lack conditional writes (e.g. B2) — skip straight to HEAD-compare. */
  forceHeadFallback: boolean;
}

export type BackendSettings = WebdavSettings | S3Settings;

export interface Settings {
  backend: BackendSettings | null;
  /** Minutes; default 5, floor 1. */
  syncIntervalMinutes: number;
  encryptionEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: null,
  syncIntervalMinutes: 5,
  encryptionEnabled: false,
};

export type ManagerView = 'table' | 'cards';
