import type { NoteRecord } from '../core/types';
import { parseProfile } from '../core/profile';

const AVATAR_TESTID_PREFIX = 'UserAvatar-Container-';

export function extractHandleFromAvatarTestid(testid: string): string | null {
  if (!testid.startsWith(AVATAR_TESTID_PREFIX)) return null;
  const handle = testid.slice(AVATAR_TESTID_PREFIX.length);
  return handle === '' ? null : handle;
}

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
    const existing = container.querySelector('.xn-badge');
    if (handleLower === null || note === undefined || handleLower === currentHandleLower) {
      existing?.remove();
      return;
    }
    const wanted = note.color === null ? 'xn-badge' : `xn-badge xn-accent-${note.color}`;
    if (existing !== null && existing.className === wanted) return;
    existing?.remove();
    const badge = doc.createElement('span');
    badge.className = wanted;
    container.append(badge);
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

export function injectHoverCardNote(doc: Document, notes: Record<string, NoteRecord>): void {
  const cards = doc.querySelectorAll('[data-testid="HoverCard"]');
  cards.forEach((card) => {
    if (card.querySelector('.xn-hover-note') !== null) return;
    const note = findNotedLink(card, doc, notes);
    if (note === null) return;
    const div = doc.createElement('div');
    div.className = 'xn-hover-note';
    div.textContent = note.text;
    card.append(div);
  });
}
