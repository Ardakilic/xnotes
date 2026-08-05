import { describe, expect, it } from 'vitest';
import type { ColorKey } from '../core/colors';
import type { NoteRecord, StoreV2 } from '../core/types';
import { canonicalNote, merge, TOMBSTONE_MAX_AGE_MS } from './merge';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_750_000_000_000;

function makeNote(handle: string, updatedAt: number, text = 'text', createdAt = 1): NoteRecord {
  return { handle, handleLower: handle.toLowerCase(), text, color: null, createdAt, updatedAt };
}

function storeWith(
  notes: Record<string, NoteRecord> = {},
  tombstones: Record<string, number> = {},
): StoreV2 {
  return { schemaVersion: 2, notes, tombstones };
}

describe('merge', () => {
  it('newer note wins', () => {
    const merged = merge(
      storeWith({ a: makeNote('a', 200, 'new') }),
      storeWith({ a: makeNote('a', 100, 'old') }),
      NOW,
    );
    expect(merged.notes['a']?.text).toBe('new');
    expect(merged.notes['a']?.updatedAt).toBe(200);
  });

  it('delete beats an older edit in both directions', () => {
    const note = storeWith({ a: makeNote('a', NOW - 200) });
    const tomb = storeWith({}, { a: NOW - 100 });
    const expected = storeWith({}, { a: NOW - 100 });
    expect(merge(tomb, note, NOW)).toEqual(expected);
    expect(merge(note, tomb, NOW)).toEqual(expected);
  });

  it('edit beats an older delete', () => {
    const merged = merge(
      storeWith({}, { a: NOW - 200 }),
      storeWith({ a: makeNote('a', NOW - 100, 'back') }),
      NOW,
    );
    expect(merged.notes['a']?.text).toBe('back');
    expect(merged.tombstones['a']).toBeUndefined();
  });

  it('tombstone wins a timestamp tie', () => {
    const ts = NOW - 100;
    const merged = merge(storeWith({ a: makeNote('a', ts) }), storeWith({}, { a: ts }), NOW);
    expect(merged.notes['a']).toBeUndefined();
    expect(merged.tombstones['a']).toBe(ts);
  });

  it('breaks note-vs-note ties by canonical serialization, commutatively', () => {
    const noteA = makeNote('a', 150, 'aaa');
    const noteB = makeNote('a', 150, 'zzz');
    const storeA = storeWith({ a: noteA });
    const storeB = storeWith({ a: noteB });
    const expected = canonicalNote(noteA) > canonicalNote(noteB) ? noteA : noteB;
    expect(merge(storeA, storeB, NOW).notes['a']).toEqual(expected);
    expect(merge(storeA, storeB, NOW)).toEqual(merge(storeB, storeA, NOW));
  });

  it('is idempotent: merge(x, x) deep-equals x', () => {
    const x = storeWith({ a: makeNote('a', 200) }, { b: NOW - DAY_MS });
    expect(merge(x, x, NOW)).toEqual(x);
  });

  it('keeps a tombstone exactly 90 days old and drops one 1 ms older', () => {
    const exactly = NOW - TOMBSTONE_MAX_AGE_MS;
    expect(merge(storeWith({}, { a: exactly }), storeWith(), NOW).tombstones['a']).toBe(exactly);
    const over = NOW - TOMBSTONE_MAX_AGE_MS - 1;
    expect(merge(storeWith({}, { a: over }), storeWith(), NOW).tombstones['a']).toBeUndefined();
  });

  it('is lossless: every input handle survives as note or tombstone unless GC-ed', () => {
    const local = storeWith(
      { a: makeNote('a', 200) },
      { b: NOW - DAY_MS, old: NOW - TOMBSTONE_MAX_AGE_MS - DAY_MS },
    );
    const remote = storeWith({ c: makeNote('c', 100) }, { d: NOW - 2 * DAY_MS });
    const merged = merge(local, remote, NOW);
    for (const handle of ['a', 'b', 'c', 'd']) {
      const survived =
        merged.notes[handle] !== undefined || merged.tombstones[handle] !== undefined;
      expect(survived, `handle ${handle}`).toBe(true);
    }
    expect(merged.notes['old']).toBeUndefined();
    expect(merged.tombstones['old']).toBeUndefined();
  });
});

describe('merge randomized properties', () => {
  const HANDLES = ['a', 'b', 'c', 'd', 'e'];
  const COLORS: readonly (ColorKey | null)[] = [null, 'red', 'teal'];

  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function randomStore(rand: () => number): StoreV2 {
    const notes: Record<string, NoteRecord> = {};
    const tombstones: Record<string, number> = {};
    for (const handle of HANDLES) {
      const roll = rand();
      if (roll < 0.3) continue;
      if (roll < 0.75) {
        notes[handle] = {
          handle,
          handleLower: handle,
          text: `t${Math.floor(rand() * 4)}`,
          color: COLORS[Math.floor(rand() * COLORS.length)] ?? null,
          createdAt: 1,
          updatedAt: 1 + Math.floor(rand() * 1000),
        };
      } else {
        tombstones[handle] = NOW - Math.floor(rand() * 30 * DAY_MS);
      }
    }
    return storeWith(notes, tombstones);
  }

  it('is commutative across 50 random store pairs', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const a = randomStore(lcg(seed));
      const b = randomStore(lcg(seed * 7919 + 13));
      expect(merge(a, b, NOW), `seed ${seed}`).toEqual(merge(b, a, NOW));
    }
  });

  it('is idempotent across 50 random stores', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const x = randomStore(lcg(seed * 104729 + 7));
      expect(merge(x, x, NOW), `seed ${seed}`).toEqual(x);
    }
  });
});
