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
    expect(jack?.querySelectorAll('span[data-xn-shadow]').length).toBe(1);
    expect(document.querySelectorAll('span[data-xn-shadow]').length).toBe(2);
    expect(
      document.querySelector('[data-testid="UserAvatar-Container-nonote"] span[data-xn-shadow]'),
    ).toBeNull();
  });

  it('never badges the current profile and removes its stale badge', () => {
    const notes = { jack: makeNote('jack', 'teal') };
    decorateAvatars(document, notes, null);
    expect(
      document.querySelector('[data-testid="UserAvatar-Container-jack"] span[data-xn-shadow]'),
    ).not.toBeNull();
    decorateAvatars(document, notes, 'jack');
    expect(
      document.querySelector('[data-testid="UserAvatar-Container-jack"] span[data-xn-shadow]'),
    ).toBeNull();
  });

  it('removes stale badges when notes disappear', () => {
    decorateAvatars(document, { jack: makeNote('jack', 'red') }, null);
    expect(document.querySelectorAll('span[data-xn-shadow]').length).toBe(1);
    decorateAvatars(document, {}, null);
    expect(document.querySelectorAll('span[data-xn-shadow]').length).toBe(0);
  });

  it('does not expose note text or color in the light DOM', () => {
    decorateAvatars(document, { jack: makeNote('jack', 'teal', 'secret text') }, null);
    const jack = document.querySelector('[data-testid="UserAvatar-Container-jack"]');
    const host = jack?.querySelector('span[data-xn-shadow]');
    expect(host).not.toBeNull();
    expect(host?.getAttribute('class')).toBeNull();
    expect(host?.textContent).toBe('');
    expect(jack?.textContent).not.toContain('secret text');
    expect(jack?.textContent).not.toContain('teal');
  });
});

describe('injectHoverCardNote', () => {
  it('injects note text once for a noted profile link (idempotent)', () => {
    document.body.innerHTML =
      '<div data-testid="HoverCard"><a href="https://x.com/jack">Jack</a></div>';
    const notes = { jack: makeNote('jack', null, 'multi\nline') };
    injectHoverCardNote(document, notes);
    injectHoverCardNote(document, notes);
    const hosts = document.querySelectorAll('div[data-xn-hover]');
    expect(hosts.length).toBe(1);
    expect(hosts.item(0)?.textContent).toBe('');
  });

  it('does not expose note text in the light DOM', () => {
    document.body.innerHTML =
      '<div data-testid="HoverCard"><a href="https://x.com/jack">Jack</a></div>';
    injectHoverCardNote(document, { jack: makeNote('jack', null, 'secret note') });
    const card = document.querySelector('[data-testid="HoverCard"]');
    expect(card?.textContent).not.toContain('secret note');
  });

  it('resolves relative profile links against the document base', () => {
    document.body.innerHTML = '<div data-testid="HoverCard"><a href="/jack">Jack</a></div>';
    injectHoverCardNote(document, { jack: makeNote('jack', null) });
    expect(document.querySelectorAll('div[data-xn-hover]').length).toBe(1);
  });

  it('insets the host inside the card padding so the note clears the border', () => {
    document.body.innerHTML =
      '<div data-testid="HoverCard"><a href="https://x.com/jack">Jack</a></div>';
    injectHoverCardNote(document, { jack: makeNote('jack', null) });
    const host = document.querySelector('div[data-xn-hover]');
    expect(host).not.toBeNull();
    if (host instanceof HTMLElement) {
      expect(host.style.display).toBe('block');
      expect(host.style.padding).toBe('0px 16px 12px');
    }
  });

  it('skips hover cards without a noted profile link', () => {
    document.body.innerHTML =
      '<div data-testid="HoverCard"><a href="https://x.com/home">Home</a></div>';
    injectHoverCardNote(document, { jack: makeNote('jack', null) });
    expect(document.querySelectorAll('div[data-xn-hover]').length).toBe(0);
  });
});
