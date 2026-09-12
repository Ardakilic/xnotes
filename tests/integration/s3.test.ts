import { AwsClient } from 'aws4fetch';
import { beforeAll, describe, expect, it } from 'vitest';
import { SyncConflictError } from '../../src/sync/adapter';
import type { S3Settings, StoreV2 } from '../../src/core/types';
import { S3Adapter } from '../../src/sync/s3';
import { env, waitForReady } from './helpers';

const bucket = env('S3_BUCKET');

const settings: S3Settings = {
  backend: 's3',
  endpoint: env('S3_ENDPOINT'),
  region: env('S3_REGION'),
  bucket,
  prefix: 'integration/',
  accessKey: env('S3_ACCESS_KEY'),
  secretKey: env('S3_SECRET_KEY'),
  pathStyle: true,
  forceHeadFallback: false,
};

function makeAdapter(overrides: Partial<S3Settings> = {}): S3Adapter {
  return new S3Adapter({ ...settings, ...overrides });
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

beforeAll(async () => {
  const client = new AwsClient({
    accessKeyId: settings.accessKey,
    secretAccessKey: settings.secretKey,
    region: settings.region,
    retries: 0,
  });
  await waitForReady(async () => {
    const res = await client.fetch(`${settings.endpoint}/${bucket}`, { method: 'PUT' });
    if (res.status >= 500) throw new Error(`s3 mock not ready: ${res.status}`);
  });
});

describe('S3 adapter against a real S3-compatible mock', () => {
  it('probe succeeds (SigV4 accepted)', async () => {
    await expect(makeAdapter().probe()).resolves.toBeUndefined();
  });

  it('put/get round-trip with etags', async () => {
    const adapter = makeAdapter({ prefix: 'roundtrip/' });
    expect(await adapter.get()).toEqual({ kind: 'not-found' });
    const payload = encode(store('alice', 1000));
    const { etag } = await adapter.put(payload);
    expect(etag).not.toBe('');
    expect(etag).not.toContain('"');
    const got = await adapter.get();
    expect(got.kind).toBe('found');
    if (got.kind === 'found') {
      expect(new TextDecoder().decode(got.data)).toBe(new TextDecoder().decode(payload));
      expect(got.etag).toBe(etag);
    }
  });

  it('round-trips a note carrying userId', async () => {
    const adapter = makeAdapter({ prefix: 'userid/' });
    const origin = store('alice', 1000);
    const note = origin.notes['alice'];
    if (note === undefined) throw new Error('fixture missing');
    note.userId = '12345';
    await adapter.put(encode(origin));
    const got = await adapter.get();
    expect(got.kind).toBe('found');
    if (got.kind === 'found') {
      const decoded: StoreV2 = JSON.parse(new TextDecoder().decode(got.data));
      expect(decoded.notes['alice']?.userId).toBe('12345');
    }
  });

  it('conditional GET answers not-modified for a known etag', async () => {
    const adapter = makeAdapter({ prefix: 'etag/' });
    const { etag } = await adapter.put(encode(store('bob', 2000)));
    expect(await adapter.get({ ifNoneMatch: etag })).toEqual({ kind: 'not-modified' });
  });

  // ponytail: adobe/s3mock ignores If-Match on PUT (verified empirically) — exactly the
  // class of server the HEAD-compare fallback exists for. The 412 mapping itself is
  // unit-tested in src/sync/s3.test.ts; here we prove the fallback guards the same race.
  it('servers ignoring If-Match are still safe via the HEAD-compare fallback', async () => {
    const path = { prefix: 'ignored-ifmatch/' };
    const conditional = makeAdapter(path);
    const { etag } = await conditional.put(encode(store('gina', 3500)));
    await conditional.put(encode(store('gina', 3600)), { ifMatch: 'stale-etag' });
    const safe = makeAdapter({ ...path, forceHeadFallback: true });
    await expect(safe.put(encode(store('gina', 3700)), { ifMatch: etag })).rejects.toBeInstanceOf(
      SyncConflictError,
    );
  });

  it('HEAD-compare fallback completes the sync (B2-style path)', async () => {
    const adapter = makeAdapter({ prefix: 'fallback/', forceHeadFallback: true });
    const { etag } = await adapter.put(encode(store('erin', 5000)));
    expect(etag).not.toBe('');
    const got = await adapter.get();
    expect(got.kind).toBe('found');
    await adapter.put(encode(store('erin', 6000)), { ifMatch: etag });
  });

  it('HEAD-compare detects a concurrent change and reports conflict', async () => {
    const path = { prefix: 'fallback-conflict/' };
    const deviceA = makeAdapter(path);
    const deviceB = makeAdapter({ ...path, forceHeadFallback: true });
    const { etag } = await deviceA.put(encode(store('frank', 7000)));
    await deviceA.put(encode(store('frank', 8000)), { ifMatch: etag });
    await expect(
      deviceB.put(encode(store('frank', 9000)), { ifMatch: etag }),
    ).rejects.toBeInstanceOf(SyncConflictError);
  });
});
