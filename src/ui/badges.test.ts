// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/"}

import { beforeEach, describe, expect, it } from 'vitest';
import type { ColorKey } from '../core/colors';
import type { NoteRecord } from '../core/types';
import { decorateAvatars, extractHandleFromAvatarTestid, injectHoverCardNote } from './badges';

function makeNote(handle: string, color: ColorKey | null, text = 'hello'): NoteRecord {
  return { handle, handleLower: handle.toLowerCase(), text, color, createdAt: 1, updatedAt: 2 };
}

describe('extractHandleFromAvatarTestid', () => {
  it('extracts the handle part', () => {
    expect(extractHandleFromAvatarTestid('UserAvatar-Container-jack')).toBe('jack');
    expect(extractHandleFromAvatarTestid('UserAvatar-Container-Some_User1')).toBe('Some_User1');
  });

  it('returns null for empty handles and other testids', () => {
    expect(extractHandleFromAvatarTestid('UserAvatar-Container-')).toBeNull();
    expect(extractHandleFromAvatarTestid('HoverCard')).toBeNull();
    expect(extractHandleFromAvatarTestid('')).toBeNull();
  });
});

describe('decorateAvatars', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div data-testid="UserAvatar-Container-jack"></div>
      <div data-testid="UserAvatar-Container-elon"></div>
      <div data-testid="UserAvatar-Container-nonote"></div>
    `;
  });

  it('badges noted handles only, idempotently', () => {
    const notes = { jack: makeNote('jack', 'teal'), elon: makeNote('elon', null) };
    decorateAvatars(document, notes, null);
    decorateAvatars(document, notes, null);
    const jack = document.querySelector('[data-testid="UserAvatar-Container-jack"]');
    expect(jack?.querySelectorAll('.xn-badge').length).toBe(1);
    expect(jack?.querySelector('.xn-badge')?.className).toBe('xn-badge xn-accent-teal');
    expect(document.querySelectorAll('.xn-badge').length).toBe(2);
    expect(
      document.querySelector('[data-testid="UserAvatar-Container-nonote"] .xn-badge'),
    ).toBeNull();
  });

  it('never badges the current profile and removes its stale badge', () => {
    const notes = { jack: makeNote('jack', 'teal') };
    decorateAvatars(document, notes, null);
    expect(
      document.querySelector('[data-testid="UserAvatar-Container-jack"] .xn-badge'),
    ).not.toBeNull();
    decorateAvatars(document, notes, 'jack');
    expect(
      document.querySelector('[data-testid="UserAvatar-Container-jack"] .xn-badge'),
    ).toBeNull();
  });

  it('removes stale badges when notes disappear', () => {
    decorateAvatars(document, { jack: makeNote('jack', 'red') }, null);
    expect(document.querySelectorAll('.xn-badge').length).toBe(1);
    decorateAvatars(document, {}, null);
    expect(document.querySelectorAll('.xn-badge').length).toBe(0);
  });

  it('updates the badge class when the note color changes', () => {
    decorateAvatars(document, { jack: makeNote('jack', 'red') }, null);
    decorateAvatars(document, { jack: makeNote('jack', 'blue') }, null);
    const jack = document.querySelector('[data-testid="UserAvatar-Container-jack"]');
    expect(jack?.querySelectorAll('.xn-badge').length).toBe(1);
    expect(jack?.querySelector('.xn-badge')?.className).toBe('xn-badge xn-accent-blue');
  });
});

describe('injectHoverCardNote', () => {
  it('injects note text once for a noted profile link (idempotent)', () => {
    document.body.innerHTML =
      '<div data-testid="HoverCard"><a href="https://x.com/jack">Jack</a></div>';
    const notes = { jack: makeNote('jack', null, 'multi\nline') };
    injectHoverCardNote(document, notes);
    injectHoverCardNote(document, notes);
    const injected = document.querySelectorAll('.xn-hover-note');
    expect(injected.length).toBe(1);
    expect(injected.item(0)?.textContent).toBe('multi\nline');
  });

  it('resolves relative profile links against the document base', () => {
    document.body.innerHTML = '<div data-testid="HoverCard"><a href="/jack">Jack</a></div>';
    injectHoverCardNote(document, { jack: makeNote('jack', null) });
    expect(document.querySelectorAll('.xn-hover-note').length).toBe(1);
  });

  it('skips hover cards without a noted profile link', () => {
    document.body.innerHTML =
      '<div data-testid="HoverCard"><a href="https://x.com/home">Home</a></div>';
    injectHoverCardNote(document, { jack: makeNote('jack', null) });
    expect(document.querySelectorAll('.xn-hover-note').length).toBe(0);
  });
});
