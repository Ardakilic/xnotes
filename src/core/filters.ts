import type { ColorKey } from './colors';
import type { NoteRecord } from './types';

export type ColorFilter = ColorKey | 'none';

export function filterNotes(
  notes: NoteRecord[],
  query: string,
  colors: Set<ColorFilter>,
): NoteRecord[] {
  const q = query.trim().toLowerCase();
  return notes
    .filter((note) => {
      if (
        q !== '' &&
        !note.handle.toLowerCase().includes(q) &&
        !note.text.toLowerCase().includes(q)
      ) {
        return false;
      }
      return colors.size === 0 || colors.has(note.color ?? 'none');
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
