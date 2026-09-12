import type { AwsClient } from 'aws4fetch';
import type { S3Settings } from '../core/types';
import type { GetResult, PutOptions, SyncAdapter } from './adapter';
import { SyncAuthError, SyncConflictError, SyncUnreachableError } from './adapter';
import { buildBucketUrl, buildObjectUrl, createAwsClient } from './sigv4';

function stripQuotes(etag: string): string {
  return etag.replaceAll('"', '');
}

// S3 compares entity-tags strictly — conditional headers need the quoted form
function quoteEtag(etag: string): string {
  if (etag === '*' || (etag.startsWith('"') && etag.endsWith('"'))) return etag;
  return `"${etag}"`;
}

export class S3Adapter implements SyncAdapter {
  private readonly settings: S3Settings;
  private readonly client: AwsClient;
  private readonly bucketUrl: string;
  private readonly objectUrl: string;
  private conditionalUnsupported = false;

  constructor(settings: S3Settings) {
    this.settings = settings;
    this.client = createAwsClient(settings);
    this.bucketUrl = buildBucketUrl(settings);
    this.objectUrl = buildObjectUrl(settings);
  }

  async probe(): Promise<void> {
    const res = await this.send(() => this.client.fetch(this.bucketUrl, { method: 'HEAD' }));
    if (res.status === 403) throw new SyncAuthError('S3 authentication failed');
    if (res.status === 404) throw new SyncUnreachableError('bucket not found');
    if (res.status === 200) return;
    throw new SyncUnreachableError(`S3 probe failed: ${res.status}`);
  }

  async get(opts?: { ifNoneMatch?: string }): Promise<GetResult> {
    const headers = new Headers();
    if (opts?.ifNoneMatch) headers.set('If-None-Match', quoteEtag(opts.ifNoneMatch));
    const res = await this.send(() =>
      this.client.fetch(this.objectUrl, { method: 'GET', headers }),
    );
    if (res.status === 304) return { kind: 'not-modified' };
    if (res.status === 404) return { kind: 'not-found' };
    if (res.status === 200) {
      return {
        kind: 'found',
        data: new Uint8Array(await res.arrayBuffer()),
        etag: stripQuotes(res.headers.get('etag') ?? ''),
      };
    }
    if (res.status === 403) throw new SyncAuthError('S3 authentication failed');
    throw new SyncUnreachableError(`S3 GET failed: ${res.status}`);
  }

  async put(data: Uint8Array, opts?: PutOptions): Promise<{ etag: string }> {
    if (this.settings.forceHeadFallback || this.conditionalUnsupported) {
      return this.putWithHeadCompare(data, opts);
    }
    const headers = new Headers();
    if (opts?.ifMatch) headers.set('If-Match', quoteEtag(opts.ifMatch));
    else if (opts?.ifNoneMatch) headers.set('If-None-Match', quoteEtag(opts.ifNoneMatch));
    // ponytail: copy so TS sees an ArrayBuffer-backed view for BodyInit
    const body = new Uint8Array(data);
    const res = await this.send(() =>
      this.client.fetch(this.objectUrl, { method: 'PUT', headers, body }),
    );
    if (res.status === 412) throw new SyncConflictError('S3 conditional PUT conflict');
    if (res.status === 501) return this.fallback(data, opts);
    if (!res.ok) {
      if ((await res.text()).includes('<Code>NotImplemented</Code>')) {
        return this.fallback(data, opts);
      }
      if (res.status === 403) throw new SyncAuthError('S3 authentication failed');
      throw new SyncUnreachableError(`S3 PUT failed: ${res.status}`);
    }
    return { etag: stripQuotes(res.headers.get('etag') ?? '') };
  }

  private fallback(data: Uint8Array, opts?: PutOptions): Promise<{ etag: string }> {
    this.conditionalUnsupported = true;
    return this.putWithHeadCompare(data, opts);
  }

  private async putWithHeadCompare(data: Uint8Array, opts?: PutOptions): Promise<{ etag: string }> {
    const head = await this.send(() => this.client.fetch(this.objectUrl, { method: 'HEAD' }));
    if (head.status === 403) throw new SyncAuthError('S3 authentication failed');
    if (opts?.ifNoneMatch === '*') {
      if (head.ok) throw new SyncConflictError('remote blob already exists');
    } else if (opts?.ifMatch) {
      if (head.status === 404)
        throw new SyncConflictError('remote blob disappeared since last sync');
      if (head.ok) {
        const remote = stripQuotes(head.headers.get('etag') ?? '');
        if (remote !== stripQuotes(opts.ifMatch)) {
          throw new SyncConflictError('remote blob changed since last sync');
        }
      }
    }
    // ponytail: copy so TS sees an ArrayBuffer-backed view for BodyInit
    const body = new Uint8Array(data);
    const res = await this.send(() => this.client.fetch(this.objectUrl, { method: 'PUT', body }));
    if (res.status === 403) throw new SyncAuthError('S3 authentication failed');
    if (!res.ok) throw new SyncUnreachableError(`S3 PUT failed: ${res.status}`);
    return { etag: stripQuotes(res.headers.get('etag') ?? '') };
  }

  private async send(run: () => Promise<Response>): Promise<Response> {
    try {
      // ponytail: no redirect check — SigV4 signatures are host-bound, so a redirected
      // request cannot carry valid credentials to the redirect target
      return await run();
    } catch {
      throw new SyncUnreachableError('cannot reach S3 endpoint');
    }
  }
}
