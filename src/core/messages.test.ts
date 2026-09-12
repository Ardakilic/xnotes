import { describe, expect, it } from 'vitest';
import { parseBackgroundRequest } from './messages';

describe('parseBackgroundRequest', () => {
  it('parses each simple message type', () => {
    expect(parseBackgroundRequest({ type: 'sync-now' })).toEqual({ type: 'sync-now' });
    expect(parseBackgroundRequest({ type: 'get-sync-status' })).toEqual({
      type: 'get-sync-status',
    });
    expect(parseBackgroundRequest({ type: 'overwrite-remote-plaintext' })).toEqual({
      type: 'overwrite-remote-plaintext',
    });
    expect(parseBackgroundRequest({ type: 'encryption-changed' })).toEqual({
      type: 'encryption-changed',
    });
    expect(parseBackgroundRequest({ type: 'backend-activated' })).toEqual({
      type: 'backend-activated',
    });
    expect(parseBackgroundRequest({ type: 'open-options' })).toEqual({ type: 'open-options' });
  });

  it('parses set-passphrase with a string or null', () => {
    expect(parseBackgroundRequest({ type: 'set-passphrase', passphrase: 'hunter2' })).toEqual({
      type: 'set-passphrase',
      passphrase: 'hunter2',
    });
    expect(parseBackgroundRequest({ type: 'set-passphrase', passphrase: null })).toEqual({
      type: 'set-passphrase',
      passphrase: null,
    });
  });

  it('rejects invalid payloads', () => {
    expect(parseBackgroundRequest(null)).toBeNull();
    expect(parseBackgroundRequest('sync-now')).toBeNull();
    expect(parseBackgroundRequest([])).toBeNull();
    expect(parseBackgroundRequest({})).toBeNull();
    expect(parseBackgroundRequest({ type: 'unknown' })).toBeNull();
    expect(parseBackgroundRequest({ type: 'open-options', extra: 1 })).toEqual({
      type: 'open-options',
    });
    expect(parseBackgroundRequest({ type: 'set-passphrase', passphrase: 42 })).toBeNull();
  });
});
