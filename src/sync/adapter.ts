export type GetResult =
  | { kind: 'found'; data: Uint8Array; etag: string }
  | { kind: 'not-found' }
  | { kind: 'not-modified' };

export interface PutOptions {
  ifMatch?: string;
  ifNoneMatch?: '*';
}

/** The only surface the sync engine sees. Encryption wraps any adapter. */
export interface SyncAdapter {
  /** Auth + reachability check; throws typed errors. */
  probe(): Promise<void>;
  /** `ifNoneMatch` enables the conditional-GET 304 fast path. */
  get(opts?: { ifNoneMatch?: string }): Promise<GetResult>;
  /** 412/precondition-failed SHALL surface as SyncConflictError. */
  put(data: Uint8Array, opts?: PutOptions): Promise<{ etag: string }>;
}

export class SyncAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncAuthError';
  }
}

export class SyncUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncUnreachableError';
  }
}

export class SyncConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncConflictError';
  }
}

export class SyncDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncDecodeError';
  }
}
