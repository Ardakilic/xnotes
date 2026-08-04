import type { NoteRecord } from '../core/types';
import { parseProfile } from '../core/profile';

const AVATAR_TESTID_PREFIX = 'UserAvatar-Container-';

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
  padding: 4px 8px;
  font-size: 13px;
  white-space: pre-wrap;
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
