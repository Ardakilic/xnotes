import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebdavSettings } from '../core/types';
import { SyncAuthError, SyncConflictError, SyncUnreachableError } from './adapter';
import { WebdavAdapter } from './webdav';

const settings: WebdavSettings = {
  backend: 'webdav',
  endpoint: 'https://dav.example.com',
  username: 'user',
  password: 'pass',
  path: '/xnotes/notes.json',
};

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function call(i: number): { url: string; init: RequestInit } {
  const c = fetchMock.mock.calls[i];
  if (!c) throw new Error(`expected fetch call ${i}`);
  return { url: c[0], init: c[1] ?? {} };
}

function headersAt(i: number): Headers {
  return new Headers(call(i).init.headers);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probe', () => {
  it.each([200, 204, 404])('resolves on %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(new WebdavAdapter(settings).probe()).resolves.toBeUndefined();
    expect(call(0).init.method).toBe('HEAD');
    expect(call(0).url).toBe('https://dav.example.com/xnotes/notes.json');
  });

  it.each([401, 403])('throws SyncAuthError on %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(new WebdavAdapter(settings).probe()).rejects.toThrow(SyncAuthError);
  });

  it('throws SyncUnreachableError on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await expect(new WebdavAdapter(settings).probe()).rejects.toThrow(SyncUnreachableError);
  });

  it('throws SyncUnreachableError on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(new WebdavAdapter(settings).probe()).rejects.toThrow(SyncUnreachableError);
  });

  it('sends the Basic auth header', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await new WebdavAdapter(settings).probe();
    expect(headersAt(0).get('authorization')).toBe(`Basic ${btoa('user:pass')}`);
  });
});

describe('get', () => {
  it('returns found with data and etag on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('hello', { status: 200, headers: { etag: '"abc"' } }),
    );
    const res = await new WebdavAdapter(settings).get();
    expect(res).toEqual({ kind: 'found', data: new TextEncoder().encode('hello'), etag: '"abc"' });
  });

  it('forwards If-None-Match', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await new WebdavAdapter(settings).get({ ifNoneMatch: '"abc"' });
    expect(headersAt(0).get('if-none-match')).toBe('"abc"');
  });

  it('returns not-modified on 304', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    await expect(new WebdavAdapter(settings).get({ ifNoneMatch: '"abc"' })).resolves.toEqual({
      kind: 'not-modified',
    });
  });

  it('returns not-found on 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(new WebdavAdapter(settings).get()).resolves.toEqual({ kind: 'not-found' });
  });

  it.each([401, 403])('throws SyncAuthError on %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(new WebdavAdapter(settings).get()).rejects.toThrow(SyncAuthError);
  });

  it('throws SyncUnreachableError with status on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(new WebdavAdapter(settings).get()).rejects.toThrow('503');
  });
});

describe('put', () => {
  const body = new TextEncoder().encode('{"v":1}');

  it('returns the new etag on 201', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201, headers: { etag: '"v2"' } }));
    await expect(new WebdavAdapter(settings).put(body)).resolves.toEqual({ etag: '"v2"' });
    expect(call(0).init.method).toBe('PUT');
  });

  it('fetches the etag via HEAD when the PUT response has none (dufs)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v9"' } }));
    await expect(new WebdavAdapter(settings).put(body)).resolves.toEqual({ etag: '"v9"' });
    expect(call(0).init.method).toBe('PUT');
    expect(call(1).init.method).toBe('HEAD');
  });

  it('forwards If-Match and If-None-Match', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"abc"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"v2"' } }));
    await new WebdavAdapter(settings).put(body, { ifMatch: '"abc"' });
    expect(call(0).init.method).toBe('HEAD');
    expect(headersAt(1).get('if-match')).toBe('"abc"');
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { etag: '"v3"' } }));
    await new WebdavAdapter(settings).put(body, { ifNoneMatch: '*' });
    expect(headersAt(3).get('if-none-match')).toBe('*');
  });

  it('throws SyncConflictError on 412', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"abc"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }));
    await expect(new WebdavAdapter(settings).put(body, { ifMatch: '"abc"' })).rejects.toThrow(
      SyncConflictError,
    );
  });

  it('HEAD precheck detects a changed remote etag (servers ignoring If-Match, e.g. dufs)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { etag: '"someone-else"' } }),
    );
    await expect(new WebdavAdapter(settings).put(body, { ifMatch: '"abc"' })).rejects.toThrow(
      SyncConflictError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HEAD precheck treats a vanished blob as conflict', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(new WebdavAdapter(settings).put(body, { ifMatch: '"abc"' })).rejects.toThrow(
      SyncConflictError,
    );
  });

  it('HEAD precheck rejects ifNoneMatch * when the blob already exists', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(new WebdavAdapter(settings).put(body, { ifNoneMatch: '*' })).rejects.toThrow(
      SyncConflictError,
    );
  });

  it('compares etags ignoring quotes', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: 'abc' } }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { etag: '"v2"' } }));
    await expect(new WebdavAdapter(settings).put(body, { ifMatch: '"abc"' })).resolves.toEqual({
      etag: '"v2"',
    });
  });

  it.each([404, 409])('MKCOLs the folder then retries the PUT on %i', async (status) => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { etag: '"v2"' } }));
    await expect(new WebdavAdapter(settings).put(body)).resolves.toEqual({ etag: '"v2"' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(call(1).init.method).toBe('MKCOL');
    expect(call(1).url).toBe('https://dav.example.com/xnotes');
    expect(call(2).init.method).toBe('PUT');
  });

  it('accepts MKCOL 405 (folder already exists)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { etag: '"v2"' } }));
    await expect(new WebdavAdapter(settings).put(body)).resolves.toEqual({ etag: '"v2"' });
  });

  it.each([401, 403])('throws SyncAuthError on %i', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(new WebdavAdapter(settings).put(body)).rejects.toThrow(SyncAuthError);
  });

  it('throws SyncUnreachableError on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(new WebdavAdapter(settings).put(body)).rejects.toThrow(SyncUnreachableError);
  });
});

describe('url construction', () => {
  it('defaults the path and tolerates a trailing slash', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const adapter = new WebdavAdapter({
      ...settings,
      endpoint: 'https://dav.example.com/',
      path: '',
    });
    await adapter.probe();
    await adapter.get();
    expect(call(0).url).toBe('https://dav.example.com/xnotes/notes.json');
    expect(call(1).url).toBe('https://dav.example.com/xnotes/notes.json');
  });

  it('normalizes a path without a leading slash', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const adapter = new WebdavAdapter({
      ...settings,
      path: 'my-notes/notes.json',
    });
    await adapter.get();
    expect(call(0).url).toBe('https://dav.example.com/my-notes/notes.json');
  });
});
