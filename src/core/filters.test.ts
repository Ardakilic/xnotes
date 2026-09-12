import { describe, expect, it } from 'vitest';
import type { ColorKey } from './colors';
import { filterNotes } from './filters';
import type { NoteRecord } from './types';

function note(handle: string, text: string, color: ColorKey | null, updatedAt: number): NoteRecord {
  return { handle, handleLower: handle.toLowerCase(), text, color, createdAt: 0, updatedAt };
}

describe('filterNotes', () => {
  const notes = [
    note('alice', 'ship it', 'red', 300),
    note('bob', 'notes about whales', 'blue', 100),
    note('carol', 'red wagon', null, 200),
  ];

  it('matches by handle', () => {
    expect(filterNotes(notes, 'ali', new Set()).map((n) => n.handle)).toEqual(['alice']);
  });

  it('matches by text', () => {
    expect(filterNotes(notes, 'whales', new Set()).map((n) => n.handle)).toEqual(['bob']);
  });

  it('is case-insensitive in both directions', () => {
    expect(filterNotes(notes, 'ALICE', new Set()).map((n) => n.handle)).toEqual(['alice']);
    expect(filterNotes(notes, 'WHALES', new Set()).map((n) => n.handle)).toEqual(['bob']);
    expect(filterNotes(notes, 'red', new Set()).map((n) => n.handle)).toEqual(['carol']);
  });

  it('matches all notes on empty query', () => {
    expect(filterNotes(notes, '', new Set())).toHaveLength(3);
    expect(filterNotes(notes, '   ', new Set())).toHaveLength(3);
  });

  it('filters by a single color', () => {
    expect(filterNotes(notes, '', new Set(['red'])).map((n) => n.handle)).toEqual(['alice']);
  });

  it('widens the result when more colors are selected', () => {
    const two = filterNotes(notes, '', new Set(['red', 'blue']));
    expect(two.map((n) => n.handle)).toEqual(['alice', 'bob']);
  });

  it('matches uncolored notes via "none"', () => {
    expect(filterNotes(notes, '', new Set(['none'])).map((n) => n.handle)).toEqual(['carol']);
  });

  it('combines query and color filter', () => {
    expect(filterNotes(notes, 'SHIP', new Set(['red'])).map((n) => n.handle)).toEqual(['alice']);
    expect(filterNotes(notes, 'red', new Set(['none'])).map((n) => n.handle)).toEqual(['carol']);
  });

  it('sorts by updatedAt descending', () => {
    expect(filterNotes(notes, '', new Set()).map((n) => n.updatedAt)).toEqual([300, 200, 100]);
  });

  it('filters notes carrying userId without behavior change', () => {
    const identified: NoteRecord[] = [
      { ...note('alice', 'ship it', 'red', 300), userId: '111' },
      { ...note('bob', 'notes about whales', 'blue', 100), userId: '222' },
    ];
    expect(filterNotes(identified, 'bob', new Set()).map((n) => n.handle)).toEqual(['bob']);
    expect(filterNotes(identified, 'whales', new Set()).map((n) => n.handle)).toEqual(['bob']);
    expect(filterNotes(identified, '', new Set(['red'])).map((n) => n.handle)).toEqual(['alice']);
    expect(filterNotes(identified, '', new Set())).toHaveLength(2);
  });
});
