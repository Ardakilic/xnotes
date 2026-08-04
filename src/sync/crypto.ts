import type { StoreV2 } from '../core/types';
import { SyncDecodeError } from './adapter';

export const MIN_PBKDF2_ITERATIONS = 600_000;
export const MAX_PBKDF2_ITERATIONS = 10_000_000;

interface Envelope {
  v: 1;
  cipher: 'aes-256-gcm';
  kdf: 'pbkdf2-sha256';
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

export class EncryptionMismatchError extends Error {
  readonly direction: 'remote-encrypted' | 'remote-plaintext';

  constructor(direction: 'remote-encrypted' | 'remote-plaintext') {
    super(
      direction === 'remote-encrypted'
        ? 'remote blob is encrypted; enable encryption with the passphrase to sync'
        : 'remote blob is not encrypted; confirm before overwriting it with encrypted data',
    );
    this.name = 'EncryptionMismatchError';
    this.direction = direction;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEnvelope(parsed: unknown): Envelope {
  if (!isRecord(parsed)) throw new SyncDecodeError('blob is not an encryption envelope');
  const { v, cipher, kdf, iter, salt, iv, data } = parsed;
  if (v !== 1) throw new SyncDecodeError(`unknown envelope version: ${String(v)}`);
  if (cipher !== 'aes-256-gcm') throw new SyncDecodeError(`unknown cipher: ${String(cipher)}`);
  if (kdf !== 'pbkdf2-sha256') throw new SyncDecodeError(`unknown kdf: ${String(kdf)}`);
  if (
    typeof iter !== 'number' ||
    !Number.isFinite(iter) ||
    !Number.isInteger(iter) ||
    typeof salt !== 'string' ||
    typeof iv !== 'string' ||
    typeof data !== 'string'
  ) {
    throw new SyncDecodeError('malformed envelope');
  }
  if (iter < MIN_PBKDF2_ITERATIONS) {
    throw new SyncDecodeError(`envelope kdf iterations below minimum (${MIN_PBKDF2_ITERATIONS})`);
  }
  if (iter > MAX_PBKDF2_ITERATIONS) {
    throw new SyncDecodeError(`envelope kdf iterations above maximum (${MAX_PBKDF2_ITERATIONS})`);
  }
  return { v, cipher, kdf, iter, salt, iv, data };
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iter: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptStore(store: StoreV2, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, MIN_PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(store)),
  );
  const envelope: Envelope = {
    v: 1,
    cipher: 'aes-256-gcm',
    kdf: 'pbkdf2-sha256',
    iter: MIN_PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  };
  return new TextEncoder().encode(JSON.stringify(envelope));
}

/** Returns the decrypted JSON; the caller MUST validate it with toStoreV2. */
export async function decryptStore(bytes: Uint8Array, passphrase: string): Promise<unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SyncDecodeError('blob is not valid JSON');
  }
  const env = parseEnvelope(parsed);
  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(env.salt);
    iv = fromBase64(env.iv);
    ciphertext = fromBase64(env.data);
  } catch {
    throw new SyncDecodeError('envelope contains malformed base64');
  }
  const key = await deriveKey(passphrase, salt, env.iter);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw new SyncDecodeError('decryption failed (wrong passphrase?)');
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new SyncDecodeError('decrypted payload is not valid JSON');
  }
}

export function isEnvelope(bytes: Uint8Array): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return false;
  }
  if (!isRecord(parsed)) return false;
  const { v, cipher, kdf, salt, iv, data } = parsed;
  return (
    v === 1 &&
    typeof cipher === 'string' &&
    typeof kdf === 'string' &&
    typeof salt === 'string' &&
    typeof iv === 'string' &&
    typeof data === 'string'
  );
}
