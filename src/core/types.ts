import type { ColorKey } from './colors';

/**
 * A private note attached to an X profile. Keys stay `handleLower`; `userId`
 * is additive confidence (absent = unknown) for rename vs. reuse decisions.
 */
export interface NoteRecord {
  handle: string;
  handleLower: string;
  text: string;
  color: ColorKey | null;
  createdAt: number;
  updatedAt: number;
  /** Stable numeric X user ID (`rest_id`, digits-only `^\d+$`); absent = unknown. */
  userId?: string;
}

export interface StoreV2 {
  schemaVersion: 2;
  notes: Record<string, NoteRecord>;
  tombstones: Record<string, number>;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

export interface SyncState {
  deviceId: string;
  lastSyncAt: number | null;
  lastRemoteEtag: string | null;
  status: SyncStatus;
  lastError: string | null;
  lastSyncedLocalHash: string | null;
  failureCount: number;
}

export interface WebdavSettings {
  backend: 'webdav';
  endpoint: string;
  username: string;
  password: string;
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
  forceHeadFallback: boolean;
}

export type BackendSettings = WebdavSettings | S3Settings;

export interface Settings {
  backend: BackendSettings | null;
  syncIntervalMinutes: number;
  encryptionEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: null,
  syncIntervalMinutes: 5,
  encryptionEnabled: false,
};

export type ManagerView = 'table' | 'cards';
