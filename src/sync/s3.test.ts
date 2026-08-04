import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { S3Settings } from '../core/types';
import { SyncAuthError, SyncConflictError, SyncUnreachableError } from './adapter';
import { S3Adapter } from './s3';

const settings: S3Settings = {
  backend: 's3',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'mybucket',
  prefix: 'xnotes/',
  accessKey: 'AKIDEXAMPLE',
  secretKey: 'secret',
  pathStyle: false,
  forceHeadFallback: false,
};

const fetchMock = vi.fn<(input: Request) => Promise<Response>>();

function req(i: number): Request {
  const c = fetchMock.mock.calls[i];
  if (!c) throw new Error(`expected fetch call ${i}`);
  return c[0];
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request construction', () => {
  it('uses virtual-host URLs by default and signs with SigV4', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await new S3Adapter(settings).get();
    expect(req(0).url).toBe('https://mybucket.s3.example.com/xnotes/notes.json');
    expect(req(0).headers.get('authorization')).toContain('AWS4-HMAC-SHA256');
  });

  it('uses path-style URLs when enabled', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await new S3Adapter({ ...settings, pathStyle: true }).get();
    expect(req(0).url).toBe('https://s3.example.com/mybucket/xnotes/notes.json');
  });
});

describe('probe', () => {
  it('resolves on 200', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(new S3Adapter(settings).probe()).resolves.toBeUndefined();
    expect(req(0).method).toBe('HEAD');
    // ponytail: URL normalization appends '/' to a bare host
    expect(req(0).url).toBe('https://mybucket.s3.example.com/');
  });

  it('throws SyncAuthError on 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(new S3Adapter(settings).probe()).rejects.toThrow(SyncAuthError);
  });

  it('throws SyncUnreachableError on 404 (bucket not found)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(new S3Adapter(settings).probe()).rejects.toThrow('bucket not found');
  });

  it('throws SyncUnreachableError on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await expect(new S3Adapter(settings).probe()).rejects.toThrow(SyncUnreachableError);
  });
});

describe('get', () => {
  it('returns found with quotes stripped from the etag', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('hello', { status: 200, headers: { etag: '"abc"' } }),
    );
    const res = await new S3Adapter(settings).get();
    expect(res).toEqual({ kind: 'found', data: new TextEncoder().encode('hello'), etag: 'abc' });
  });

  it('forwards If-None-Match and maps 304', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const res = await new S3Adapter(settings).get({ ifNoneMatch: '"abc"' });
    expect(res).toEqual({ kind: 'not-modified' });
    expect(req(0).headers.get('if-none-match')).toBe('"abc"');
  });

  it('re-quotes unquoted etags in conditional headers (S3 compares entity-tags strictly)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await new S3Adapter(settings).get({ ifNoneMatch: 'abc' });
    expect(req(0).headers.get('if-none-match')).toBe('"abc"');
  });

  it('returns not-found on 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(new S3Adapter(settings).get()).resolves.toEqual({ kind: 'not-found' });
  });

  it('throws SyncAuthError on 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(new S3Adapter(settings).get()).rejects.toThrow(SyncAuthError);
  });
});

describe('put', () => {
  const body = new TextEncoder().encode('{"v":1}');

  it('conditional PUT success returns the stripped etag', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v2"' } }));
    await expect(new S3Adapter(settings).put(body, { ifMatch: '"abc"' })).resolves.toEqual({
      etag: 'v2',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(req(0).method).toBe('PUT');
    expect(req(0).headers.get('if-match')).toBe('"abc"');
  });

  it('throws SyncConflictError on 412', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 412 }));
    await expect(new S3Adapter(settings).put(body, { ifMatch: '"abc"' })).rejects.toThrow(
      SyncConflictError,
    );
  });

  it('falls back to HEAD-compare after 501', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 501 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"abc"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v3"' } }));
    await expect(new S3Adapter(settings).put(body, { ifMatch: '"abc"' })).resolves.toEqual({
      etag: 'v3',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(req(0).method).toBe('PUT');
    expect(req(1).method).toBe('HEAD');
    expect(req(2).method).toBe('PUT');
    expect(req(2).headers.get('if-match')).toBeNull();
  });

  it('falls back to HEAD-compare on a NotImplemented error body', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('<Error><Code>NotImplemented</Code></Error>', { status: 400 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v3"' } }));
    await expect(new S3Adapter(settings).put(body, { ifMatch: '"abc"' })).resolves.toEqual({
      etag: 'v3',
    });
    expect(req(1).method).toBe('HEAD');
  });

  it('remembers unsupported conditional writes for later puts', async () => {
    const adapter = new S3Adapter(settings);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 501 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v3"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v4"' } }));
    await adapter.put(body, { ifMatch: '"abc"' });
    await adapter.put(body, { ifMatch: '"v3"' });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(req(3).method).toBe('HEAD');
  });

  it('with forceHeadFallback skips the conditional attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"abc"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v2"' } }));
    await expect(
      new S3Adapter({ ...settings, forceHeadFallback: true }).put(body, { ifMatch: '"abc"' }),
    ).resolves.toEqual({ etag: 'v2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(req(0).method).toBe('HEAD');
    expect(req(1).method).toBe('PUT');
  });

  it('HEAD-compare reports conflict when the remote etag moved', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { etag: '"xyz"' } }),
    );
    await expect(
      new S3Adapter({ ...settings, forceHeadFallback: true }).put(body, { ifMatch: '"abc"' }),
    ).rejects.toThrow(SyncConflictError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws SyncAuthError on PUT 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(new S3Adapter(settings).put(body)).rejects.toThrow(SyncAuthError);
  });
});
