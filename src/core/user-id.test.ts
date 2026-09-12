// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { learnUserId, parseBannerUserId, parseJsonLdUserId } from './user-id';

function setJsonLd(payload: string): void {
  document.body.innerHTML = `<script type="application/ld+json">${payload}</script>`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('parseJsonLdUserId', () => {
  it('learns a valid JSON-LD identifier when the embedded handle matches', () => {
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"somehandle"}}');
    expect(parseJsonLdUserId(document, 'somehandle')).toBe('123');
  });

  it('drops a stale-head mismatch where the embedded handle differs', () => {
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"somehandle"}}');
    expect(parseJsonLdUserId(document, 'otherhandle')).toBeNull();
  });

  it('returns null for malformed or missing JSON and missing identifiers', () => {
    setJsonLd('this is not json');
    expect(parseJsonLdUserId(document, 'somehandle')).toBeNull();
    document.body.innerHTML = '';
    expect(parseJsonLdUserId(document, 'somehandle')).toBeNull();
    setJsonLd('{"mainEntity":{"alternateName":"somehandle"}}');
    expect(parseJsonLdUserId(document, 'somehandle')).toBeNull();
  });

  it('rejects non-digit identifiers', () => {
    setJsonLd('{"mainEntity":{"identifier":"abc","alternateName":"somehandle"}}');
    expect(parseJsonLdUserId(document, 'somehandle')).toBeNull();
    setJsonLd('{"mainEntity":{"identifier":"12a","alternateName":"somehandle"}}');
    expect(parseJsonLdUserId(document, 'somehandle')).toBeNull();
  });
});

describe('parseBannerUserId', () => {
  it('learns the numeric banner segment', () => {
    document.body.innerHTML = '<img src="https://pbs.twimg.com/profile_banners/456/xyz">';
    expect(parseBannerUserId(document, 'somehandle')).toBe('456');
  });

  it('returns null without banner evidence', () => {
    expect(parseBannerUserId(document, 'somehandle')).toBeNull();
  });
});

describe('learnUserId', () => {
  it('prefers JSON-LD over the banner fallback', () => {
    document.body.innerHTML =
      '<script type="application/ld+json">{"mainEntity":{"identifier":"123","alternateName":"somehandle"}}</script>' +
      '<img src="https://pbs.twimg.com/profile_banners/456/xyz">';
    expect(learnUserId(document, 'somehandle')).toBe('123');
  });

  it('falls back to the banner when JSON-LD is unusable', () => {
    document.body.innerHTML =
      '<script type="application/ld+json">this is not json</script>' +
      '<img src="https://pbs.twimg.com/profile_banners/456/xyz">';
    expect(learnUserId(document, 'somehandle')).toBe('456');
  });

  it('returns null when nothing usable exists (handle-only behavior)', () => {
    expect(learnUserId(document, 'somehandle')).toBeNull();
  });
});
