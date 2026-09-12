import { beforeAll, describe, expect, it } from 'vitest';
import type { StoreV2 } from '../core/types';
import { SyncDecodeError } from './adapter';
import {
  decryptStore,
  encryptStore,
  EncryptionMismatchError,
  isEnvelope,
  MIN_PBKDF2_ITERATIONS,
} from './crypto';

const T = 30_000;

const store: StoreV2 = {
  schemaVersion: 2,
  notes: {
    alice: {
      handle: 'Alice',
      handleLower: 'alice',
      text: 'hello @bob',
      color: 'teal',
      createdAt: 1700000000000,
      updatedAt: 1700000000001,
    },
  },
  tombstones: { bob: 1700000000002 },
};

const enc = new TextEncoder();

function toWeakenedEnvelope(parsed: unknown, iter: number): Record<string, unknown> {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('envelope is not a record');
  const record: Record<string, unknown> = { ...parsed };
  record['iter'] = iter;
  return record;
}

describe('crypto', () => {
  let encrypted: Uint8Array;

  beforeAll(async () => {
    encrypted = await encryptStore(store, 'correct horse');
  }, T);

  it(
    'round-trips a store',
    async () => {
      await expect(decryptStore(encrypted, 'correct horse')).resolves.toEqual(store);
    },
    T,
  );

  it(
    'round-trips a store carrying userId',
    async () => {
      const withId: StoreV2 = {
        schemaVersion: 2,
        notes: {
          alice: {
            handle: 'Alice',
            handleLower: 'alice',
            text: 'hello @bob',
            color: 'teal',
            createdAt: 1700000000000,
            updatedAt: 1700000000001,
            userId: '12345',
          },
        },
        tombstones: { bob: 1700000000002 },
      };
      const bytes = await encryptStore(withId, 'correct horse');
      await expect(decryptStore(bytes, 'correct horse')).resolves.toEqual(withId);
    },
    T,
  );

  it(
    'uses fresh salt, iv, and ciphertext per encryption',
    async () => {
      const a = JSON.parse(new TextDecoder().decode(await encryptStore(store, 'pw')));
      const b = JSON.parse(new TextDecoder().decode(await encryptStore(store, 'pw')));
      expect(a.salt).not.toBe(b.salt);
      expect(a.iv).not.toBe(b.iv);
      expect(a.data).not.toBe(b.data);
    },
    T,
  );

  it(
    'rejects a wrong passphrase with a typed error',
    async () => {
      const attempt = decryptStore(encrypted, 'wrong horse');
      await expect(attempt).rejects.toThrow(SyncDecodeError);
      await expect(attempt).rejects.toThrow('wrong passphrase');
    },
    T,
  );

  it('writes the minimum iteration count into the envelope', () => {
    expect(MIN_PBKDF2_ITERATIONS).toBe(600_000);
    const env: unknown = JSON.parse(new TextDecoder().decode(encrypted));
    expect(env).toMatchObject({ v: 1, cipher: 'aes-256-gcm', kdf: 'pbkdf2-sha256', iter: 600_000 });
  });

  it('rejects envelopes whose iteration count is below the minimum', async () => {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(encrypted));
    const env = toWeakenedEnvelope(parsed, 1000);
    const weakened = enc.encode(JSON.stringify(env));
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow(SyncDecodeError);
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow('below minimum');
  });

  it('rejects envelopes whose iteration count exceeds the maximum', async () => {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(encrypted));
    const env = toWeakenedEnvelope(parsed, 99_999_999);
    const weakened = enc.encode(JSON.stringify(env));
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow(SyncDecodeError);
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow('above maximum');
  });

  it('rejects fractional iteration counts as malformed', async () => {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(encrypted));
    const env = toWeakenedEnvelope(parsed, 600_000.5);
    const weakened = enc.encode(JSON.stringify(env));
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow(SyncDecodeError);
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow('malformed');
  });

  it('rejects envelopes with malformed base64 in salt/iv/data', async () => {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(encrypted));
    const env = toWeakenedEnvelope(parsed, 600_000);
    env['salt'] = '!!!not-base64!!!';
    const weakened = enc.encode(JSON.stringify(env));
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow(SyncDecodeError);
    await expect(decryptStore(weakened, 'correct horse')).rejects.toThrow('malformed base64');
  });

  it(
    'rejects garbage bytes',
    async () => {
      await expect(decryptStore(enc.encode('not json at all'), 'pw')).rejects.toThrow(
        SyncDecodeError,
      );
    },
    T,
  );

  it(
    'rejects an unknown envelope version',
    async () => {
      const bytes = enc.encode(
        JSON.stringify({ v: 2, cipher: 'aes-256-gcm', kdf: 'pbkdf2-sha256' }),
      );
      await expect(decryptStore(bytes, 'pw')).rejects.toThrow(SyncDecodeError);
    },
    T,
  );

  it('detects envelopes vs plaintext stores', () => {
    expect(isEnvelope(encrypted)).toBe(true);
    expect(isEnvelope(enc.encode(JSON.stringify(store)))).toBe(false);
    expect(isEnvelope(enc.encode('garbage'))).toBe(false);
  });

  it('exposes the mismatch error with a direction', () => {
    const remote = new EncryptionMismatchError('remote-encrypted');
    const plain = new EncryptionMismatchError('remote-plaintext');
    expect(remote.name).toBe('EncryptionMismatchError');
    expect(remote.direction).toBe('remote-encrypted');
    expect(plain.direction).toBe('remote-plaintext');
  });
});
