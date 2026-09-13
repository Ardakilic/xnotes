import type { NoteRecord } from '../core/types';
import { COLOR_KEYS } from '../core/colors';
import { getAlias, type AliasStore } from '../core/aliases';
import { parseProfile } from '../core/profile';

const AVATAR_TESTID_PREFIX = 'UserAvatar-Container-';

/**
 * Filter out hijack-withheld notes: exclude an entry only when the note's
 * `userId` is known AND the alias for its handle is known AND they differ.
 * Entries are preserved when either side is unknown. Pure; never throws.
 */
export function withoutWithheldNotes(
  notes: Record<string, NoteRecord>,
  aliases: AliasStore,
): Record<string, NoteRecord> {
  const visible: Record<string, NoteRecord> = Object.create(null);
  for (const [key, note] of Object.entries(notes)) {
    if (note.userId !== undefined) {
      const alias = getAlias(aliases, note.handleLower);
      if (alias !== null && alias.userId !== note.userId) continue;
    }
    visible[key] = note;
  }
  return visible;
}

export function extractHandleFromAvatarTestid(testid: string): string | null {
  if (!testid.startsWith(AVATAR_TESTID_PREFIX)) return null;
  const handle = testid.slice(AVATAR_TESTID_PREFIX.length);
  return handle === '' ? null : handle;
}

const BADGE_STYLE = `
.xn-badge {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-left: 2px;
  pointer-events: none;
}
`;

export function decorateAvatars(
  doc: Document,
  notes: Record<string, NoteRecord>,
  currentHandleLower: string | null,
): void {
  const containers = doc.querySelectorAll('[data-testid^="UserAvatar-Container-"]');
  containers.forEach((container) => {
    const testid = container.getAttribute('data-testid') ?? '';
    const handle = extractHandleFromAvatarTestid(testid);
    const handleLower = handle === null ? null : handle.toLowerCase();
    const note = handleLower === null ? undefined : notes[handleLower];
    const existing = container.querySelector('span[data-xn-shadow]');
    if (handleLower === null || note === undefined || handleLower === currentHandleLower) {
      existing?.remove();
      return;
    }
    const colorClass = note.color === null ? '' : `xn-accent-${note.color}`;
    if (existing !== null) {
      const root = existing.shadowRoot;
      if (root !== null) {
        const badge = root.querySelector('.xn-badge');
        if (badge !== null) badge.className = `xn-badge ${colorClass}`.trim();
      }
      return;
    }
    const host = doc.createElement('span');
    host.setAttribute('data-xn-shadow', '');
    host.style.cssText = 'display:inline-block;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = BADGE_STYLE;
    const badge = doc.createElement('span');
    badge.className = `xn-badge ${colorClass}`.trim();
    root.append(style, badge);
    container.append(host);
  });
}

function findNotedLink(
  card: Element,
  doc: Document,
  notes: Record<string, NoteRecord>,
): NoteRecord | null {
  const links = card.querySelectorAll('a[href]');
  for (let i = 0; i < links.length; i += 1) {
    const link = links.item(i);
    if (link === null) continue;
    const href = link.getAttribute('href');
    if (href === null || href === '') continue;
    let url: URL;
    try {
      url = new URL(href, doc.baseURI);
    } catch {
      continue;
    }
    const profile = parseProfile(url);
    if (profile === null) continue;
    const note = notes[profile.handle.toLowerCase()];
    if (note !== undefined) return note;
  }
  return null;
}

const HOVER_STYLE = `
.xn-hover-note {
  box-sizing: border-box;
  max-width: 260px;
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  border-left: 4px solid var(--xn-accent, #cfd9de);
  background: var(--xn-hover-bg, rgba(15, 20, 25, 0.05));
  color: var(--xn-hover-fg, #536471);
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
:host-context(.xn-dark) .xn-hover-note {
  border-left-color: var(--xn-accent, #2f3336);
}
`;

export function injectHoverCardNote(doc: Document, notes: Record<string, NoteRecord>): void {
  const cards = doc.querySelectorAll('[data-testid="HoverCard"]');
  cards.forEach((card) => {
    if (card.querySelector('div[data-xn-hover]') !== null) return;
    const note = findNotedLink(card, doc, notes);
    if (note === null) return;
    const host = doc.createElement('div');
    host.setAttribute('data-xn-hover', '');
    host.style.cssText = 'display:block;padding:0 16px 12px;';
    for (const key of COLOR_KEYS) host.classList.remove(`xn-accent-${key}`);
    const colorClass = note.color === null ? '' : `xn-accent-${note.color}`;
    if (colorClass !== '') host.classList.add(colorClass);
    const root = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = HOVER_STYLE;
    const div = doc.createElement('div');
    div.className = 'xn-hover-note';
    div.textContent = note.text;
    root.append(style, div);
    card.append(host);
  });
}
