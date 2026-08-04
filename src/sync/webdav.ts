import type { WebdavSettings } from '../core/types';
import type { GetResult, PutOptions, SyncAdapter } from './adapter';
import { SyncAuthError, SyncConflictError, SyncUnreachableError } from './adapter';
import { toBase64 } from './crypto';

const DEFAULT_PATH = '/xnotes/notes.json';

function normalizeEtag(etag: string): string {
  return etag.replaceAll('"', '');
}

export class WebdavAdapter implements SyncAdapter {
  private readonly blobUrl: string;
  private readonly folderUrl: string;
  private readonly auth: string;

  constructor(settings: WebdavSettings) {
    const base = settings.endpoint.replace(/\/+$/, '');
    const path = settings.path === '' ? DEFAULT_PATH : settings.path;
    this.blobUrl = base + path;
    this.folderUrl = base + path.slice(0, path.lastIndexOf('/'));
    // ponytail: UTF-8 per RFC 7617, not raw btoa (which throws on non-Latin1)
    this.auth = `Basic ${toBase64(new TextEncoder().encode(`${settings.username}:${settings.password}`))}`;
  }

  async probe(): Promise<void> {
    const res = await this.send('HEAD', this.blobUrl);
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError('WebDAV authentication failed');
    }
    if (res.status === 200 || res.status === 204 || res.status === 404) return;
    throw new SyncUnreachableError(`WebDAV probe failed: ${res.status}`);
  }

  async get(opts?: { ifNoneMatch?: string }): Promise<GetResult> {
    const headers = new Headers();
    if (opts?.ifNoneMatch) headers.set('If-None-Match', opts.ifNoneMatch);
    const res = await this.send('GET', this.blobUrl, headers);
    if (res.status === 304) return { kind: 'not-modified' };
    if (res.status === 404) return { kind: 'not-found' };
    if (res.status === 200) {
      return {
        kind: 'found',
        data: new Uint8Array(await res.arrayBuffer()),
        etag: res.headers.get('etag') ?? '',
      };
    }
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError('WebDAV authentication failed');
    }
    throw new SyncUnreachableError(`WebDAV GET failed: ${res.status}`);
  }

  async put(data: Uint8Array, opts?: PutOptions): Promise<{ etag: string }> {
    await this.precheck(opts);
    const headers = new Headers();
    // Still forwarded for servers that honor preconditions (Nextcloud/sabre); dufs ignores
    // If-Match on PUT (verified v0.46.0), so the HEAD precheck above is the real guard.
    if (opts?.ifMatch) headers.set('If-Match', opts.ifMatch);
    if (opts?.ifNoneMatch) headers.set('If-None-Match', opts.ifNoneMatch);
    let res = await this.send('PUT', this.blobUrl, headers, data);
    if (res.status === 404 || res.status === 409) {
      await this.mkcol();
      res = await this.send('PUT', this.blobUrl, headers, data);
    }
    if (res.status === 412) throw new SyncConflictError('WebDAV conditional PUT conflict');
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError('WebDAV authentication failed');
    }
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
      throw new SyncUnreachableError(`WebDAV PUT failed: ${res.status}`);
    }
    let etag = res.headers.get('etag') ?? '';
    if (etag === '') {
      // ponytail: dufs omits the ETag on PUT responses — one HEAD to fetch it
      const head = await this.send('HEAD', this.blobUrl);
      if (head.status === 200) etag = head.headers.get('etag') ?? '';
    }
    return { etag };
  }

  /**
   * HEAD-compare conflict guard. dufs (the reference server) ignores If-Match on PUT, so
   * optimistic locking is enforced here: compare the live remote etag against the caller's
   * precondition before writing. A small HEAD→PUT race window remains (documented, lossless).
   */
  private async precheck(opts?: PutOptions): Promise<void> {
    if (!opts?.ifMatch && opts?.ifNoneMatch !== '*') return;
    const head = await this.send('HEAD', this.blobUrl);
    if (head.status === 401 || head.status === 403) {
      throw new SyncAuthError('WebDAV authentication failed');
    }
    if (opts?.ifNoneMatch === '*') {
      if (head.status === 200) throw new SyncConflictError('remote blob already exists');
      return;
    }
    if (opts?.ifMatch) {
      if (head.status === 404) {
        throw new SyncConflictError('remote blob disappeared since last sync');
      }
      if (head.status === 200) {
        const remote = normalizeEtag(head.headers.get('etag') ?? '');
        if (remote !== normalizeEtag(opts.ifMatch)) {
          throw new SyncConflictError('remote blob changed since last sync');
        }
        return;
      }
      throw new SyncUnreachableError(`WebDAV HEAD failed: ${head.status}`);
    }
  }

  private async mkcol(): Promise<void> {
    const res = await this.send('MKCOL', this.folderUrl);
    if (res.status === 401 || res.status === 403) {
      throw new SyncAuthError('WebDAV authentication failed');
    }
    if (res.status !== 201 && res.status !== 204 && res.status !== 405) {
      throw new SyncUnreachableError(`WebDAV MKCOL failed: ${res.status}`);
    }
  }

  private async send(
    method: string,
    url: string,
    extraHeaders?: Headers,
    body?: Uint8Array,
  ): Promise<Response> {
    const headers = new Headers(extraHeaders);
    headers.set('Authorization', this.auth);
    const init: RequestInit = { method, headers };
    // ponytail: copy so TS sees an ArrayBuffer-backed view for BodyInit
    if (body) init.body = new Uint8Array(body);
    try {
      return await fetch(url, init);
    } catch {
      throw new SyncUnreachableError(`cannot reach WebDAV endpoint at ${url}`);
    }
  }
}
