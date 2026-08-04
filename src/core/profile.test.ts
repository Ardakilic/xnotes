import { describe, expect, it } from 'vitest';
import { parseProfile, PROFILE_SUBTABS, RESERVED } from './profile';

describe('parseProfile', () => {
  it('detects a plain profile', () => {
    expect(parseProfile(new URL('https://x.com/jack'))).toEqual({ handle: 'jack' });
  });

  it('detects a subtab profile', () => {
    expect(parseProfile(new URL('https://x.com/jack/with_replies'))).toEqual({ handle: 'jack' });
  });

  it('accepts every profile subtab as second segment', () => {
    for (const subtab of PROFILE_SUBTABS) {
      expect(parseProfile(new URL(`https://x.com/jack/${subtab}`))).toEqual({ handle: 'jack' });
    }
  });

  it('rejects every reserved route', () => {
    for (const route of RESERVED) {
      expect(parseProfile(new URL(`https://x.com/${route}`))).toBeNull();
    }
  });

  it('rejects reserved routes regardless of case', () => {
    for (const route of RESERVED) {
      expect(parseProfile(new URL(`https://x.com/${route.toUpperCase()}`))).toBeNull();
    }
    expect(parseProfile(new URL('https://x.com/i/flow/login'))).toBeNull();
  });

  it('rejects an unknown second segment', () => {
    expect(parseProfile(new URL('https://x.com/jack/unknownthing'))).toBeNull();
  });

  it('accepts a 15-char handle and rejects 16 chars', () => {
    expect(parseProfile(new URL('https://x.com/abcdefghijklmno'))).toEqual({
      handle: 'abcdefghijklmno',
    });
    expect(parseProfile(new URL('https://x.com/abcdefghijklmnop'))).toBeNull();
  });

  it('rejects handles with invalid characters', () => {
    expect(parseProfile(new URL('https://x.com/bad-handle'))).toBeNull();
    expect(parseProfile(new URL('https://x.com/bad.handle'))).toBeNull();
    expect(parseProfile(new URL('https://x.com/bad$handle'))).toBeNull();
  });

  it('rejects non-X hosts', () => {
    expect(parseProfile(new URL('https://example.com/jack'))).toBeNull();
    expect(parseProfile(new URL('https://notx.com/jack'))).toBeNull();
    expect(parseProfile(new URL('https://x.com.evil.com/jack'))).toBeNull();
  });

  it('is case-insensitive for host and subtab', () => {
    expect(parseProfile(new URL('https://X.COM/jack'))).toEqual({ handle: 'jack' });
    expect(parseProfile(new URL('https://WWW.X.COM/jack'))).toEqual({ handle: 'jack' });
    expect(parseProfile(new URL('https://www.Twitter.com/jack'))).toEqual({ handle: 'jack' });
    expect(parseProfile(new URL('https://x.com/jack/MEDIA'))).toEqual({ handle: 'jack' });
  });

  it('preserves the original handle casing', () => {
    expect(parseProfile(new URL('https://x.com/Jack'))).toEqual({ handle: 'Jack' });
    expect(parseProfile(new URL('https://x.com/SomeUser_1'))).toEqual({ handle: 'SomeUser_1' });
  });

  it('ignores segments beyond the second', () => {
    expect(parseProfile(new URL('https://x.com/jack/media/12345'))).toEqual({ handle: 'jack' });
  });

  it('rejects root and empty paths', () => {
    expect(parseProfile(new URL('https://x.com/'))).toBeNull();
    expect(parseProfile(new URL('https://x.com'))).toBeNull();
  });
});
