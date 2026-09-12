import { beforeAll, describe, expect, it } from 'vitest';
import { merge } from '../../src/sync/merge';
import { SyncAuthError, SyncConflictError } from '../../src/sync/adapter';
import { WebdavAdapter } from '../../src/sync/webdav';
import type { StoreV2 } from '../../src/core/types';
import type { WebdavSettings } from '../../src/core/types';
import { env, waitForReady } from './helpers';

const settings: WebdavSettings = {
  backend: 'webdav',
  endpoint: env('WEBDAV_URL'),
  username: env('WEBDAV_USERNAME'),
  password: env('WEBDAV_PASSWORD'),
  path: '/xnotes-integration/notes.json',
};

function makeAdapter(path = settings.path): WebdavAdapter {
  return new WebdavAdapter({ ...settings, path });
}

function store(handle: string, updatedAt: number): StoreV2 {
  return {
    schemaVersion: 2,
    notes: {
      [handle]: {
        handle,
        handleLower: handle,
        text: `note from ${handle}`,
        color: null,
        createdAt: updatedAt - 1,
        updatedAt,
      },
    },
    tombstones: {},
  };
}

const encode = (s: StoreV2): Uint8Array => new TextEncoder().encode(JSON.stringify(s));
const decode = (b: Uint8Array): StoreV2 => JSON.parse(new TextDecoder().decode(b)) as StoreV2;

beforeAll(async () => {
  await waitForReady(() => makeAdapter('/probe.json').probe());
});

describe('WebDAV adapter against real dufs', () => {
  it('probe succeeds with correct credentials', async () => {
    await expect(makeAdapter().probe()).resolves.toBeUndefined();
  });

  it('probe rejects wrong credentials with a typed auth error', async () => {
    const bad = new WebdavAdapter({ ...settings, password: 'wrong' });
    await expect(bad.probe()).rejects.toBeInstanceOf(SyncAuthError);
  });

  it('get returns not-found on an empty server, then put/get round-trips', async () => {
    const adapter = makeAdapter('/roundtrip/notes.json');
    expect(await adapter.get()).toEqual({ kind: 'not-found' });
    const payload = encode(store('alice', 1000));
    const { etag } = await adapter.put(payload);
    expect(etag).not.toBe('');
    const got = await adapter.get();
    expect(got.kind).toBe('found');
    if (got.kind === 'found') {
      expect(new TextDecoder().decode(got.data)).toBe(new TextDecoder().decode(payload));
      expect(got.etag).toBe(etag);
    }
  });

  it('round-trips a note carrying userId', async () => {
    const adapter = makeAdapter('/userid/notes.json');
    const origin = store('alice', 1000);
    const note = origin.notes['alice'];
    if (note === undefined) throw new Error('fixture missing');
    note.userId = '12345';
    await adapter.put(encode(origin));
    const got = await adapter.get();
    expect(got.kind).toBe('found');
    if (got.kind === 'found') {
      expect(decode(got.data).notes['alice']?.userId).toBe('12345');
    }
  });

  it('creates the folder via MKCOL on first run', async () => {
    const adapter = makeAdapter(`/mkcol-${Date.now()}/notes.json`);
    const { etag } = await adapter.put(encode(store('bob', 2000)));
    expect(etag).not.toBe('');
    const got = await adapter.get();
    expect(got.kind).toBe('found');
  });

  it('conditional GET answers not-modified for a known etag', async () => {
    const adapter = makeAdapter('/etag/notes.json');
    const { etag } = await adapter.put(encode(store('carol', 3000)));
    expect(await adapter.get({ ifNoneMatch: etag })).toEqual({ kind: 'not-modified' });
    const fresh = await adapter.get({ ifNoneMatch: 'some-other-etag' });
    expect(fresh.kind).toBe('found');
  });

  it('PUT with a stale If-Match yields a typed conflict', async () => {
    const adapter = makeAdapter('/conflict/notes.json');
    await adapter.put(encode(store('dave', 4000)));
    await expect(
      adapter.put(encode(store('eve', 5000)), { ifMatch: '"stale"' }),
    ).rejects.toBeInstanceOf(SyncConflictError);
  });

  it('two simulated devices racing converge via the retry loop', async () => {
    const path = '/race/notes.json';
    const deviceA = makeAdapter(path);
    const deviceB = makeAdapter(path);

    const first = await deviceA.put(encode(store('devicea', 10_000)), { ifNoneMatch: '*' });
    expect(first.etag).not.toBe('');

    await expect(
      deviceB.put(encode(store('deviceb', 11_000)), { ifNoneMatch: '*' }),
    ).rejects.toBeInstanceOf(SyncConflictError);

    const remote = await deviceB.get();
    expect(remote.kind).toBe('found');
    if (remote.kind !== 'found') return;
    const merged = merge(decode(remote.data), store('deviceb', 11_000));
    await deviceB.put(encode(merged), { ifMatch: remote.etag });

    const final = await deviceA.get();
    expect(final.kind).toBe('found');
    if (final.kind === 'found') {
      const finalStore = decode(final.data);
      expect(finalStore.notes['devicea']).toBeDefined();
      expect(finalStore.notes['deviceb']).toBeDefined();
    }
  });
});
