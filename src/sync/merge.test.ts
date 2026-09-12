import { describe, expect, it } from 'vitest';
import type { ColorKey } from '../core/colors';
import type { NoteRecord, StoreV2 } from '../core/types';
import { canonicalNote, merge, TOMBSTONE_MAX_AGE_MS } from './merge';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_750_000_000_000;

function makeNote(
  handle: string,
  updatedAt: number,
  text = 'text',
  createdAt = 1,
  userId?: string,
): NoteRecord {
  const note: NoteRecord = {
    handle,
    handleLower: handle.toLowerCase(),
    text,
    color: null,
    createdAt,
    updatedAt,
  };
  if (userId !== undefined) note.userId = userId;
  return note;
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

  it('keeps a __proto__-handle note as an own key (null-prototype result maps)', () => {
    const proto = makeNote('__proto__', 300, 'proto note');
    const localNotes: Record<string, NoteRecord> = Object.create(null);
    localNotes['a'] = makeNote('a', 100);
    localNotes['__proto__'] = proto;
    const remoteNotes: Record<string, NoteRecord> = Object.create(null);
    remoteNotes['b'] = makeNote('b', 200);
    remoteNotes['__proto__'] = proto;
    const local: StoreV2 = {
      schemaVersion: 2,
      notes: localNotes,
      tombstones: Object.create(null),
    };
    const remote: StoreV2 = {
      schemaVersion: 2,
      notes: remoteNotes,
      tombstones: Object.create(null),
    };
    const merged = merge(local, remote, NOW);
    expect(Object.prototype.hasOwnProperty.call(merged.notes, '__proto__')).toBe(true);
    expect(merged.notes['__proto__']).toEqual(proto);
    expect(JSON.parse(JSON.stringify(merged)).notes['__proto__']).toEqual(
      JSON.parse(JSON.stringify(proto)),
    );
  });

  it('keeps a __proto__-handle tombstone as an own key', () => {
    const localTombstones: Record<string, number> = Object.create(null);
    localTombstones['__proto__'] = NOW - DAY_MS;
    const local: StoreV2 = {
      schemaVersion: 2,
      notes: Object.create(null),
      tombstones: localTombstones,
    };
    const remote: StoreV2 = {
      schemaVersion: 2,
      notes: Object.create(null),
      tombstones: Object.create(null),
    };
    const merged = merge(local, remote, NOW);
    expect(Object.prototype.hasOwnProperty.call(merged.tombstones, '__proto__')).toBe(true);
    expect(merged.tombstones['__proto__']).toBe(NOW - DAY_MS);
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

describe('merge with userId', () => {
  it('orders present-vs-absent ties deterministically in both directions', () => {
    const withId = makeNote('a', 150, 'same', 1, '123');
    const withoutId = makeNote('a', 150, 'same');
    const storeA = storeWith({ a: withId });
    const storeB = storeWith({ a: withoutId });
    const expected = canonicalNote(withId) > canonicalNote(withoutId) ? withId : withoutId;
    expect(merge(storeA, storeB, NOW).notes['a']).toEqual(expected);
    expect(merge(storeA, storeB, NOW)).toEqual(merge(storeB, storeA, NOW));
  });

  it('orders mismatched userIds deterministically in both directions', () => {
    const noteA = makeNote('a', 150, 'same', 1, '111');
    const noteB = makeNote('a', 150, 'same', 1, '222');
    const storeA = storeWith({ a: noteA });
    const storeB = storeWith({ a: noteB });
    const expected = canonicalNote(noteA) > canonicalNote(noteB) ? noteA : noteB;
    expect(merge(storeA, storeB, NOW).notes['a']).toEqual(expected);
    expect(merge(storeA, storeB, NOW)).toEqual(merge(storeB, storeA, NOW));
  });

  it('is idempotent with userIds present', () => {
    const x = storeWith({ a: makeNote('a', 200, 'text', 1, '123') }, { b: NOW - DAY_MS });
    expect(merge(x, x, NOW)).toEqual(x);
  });

  it('is commutative and idempotent with userIds across random stores', () => {
    function lcg(seed: number): () => number {
      let state = seed >>> 0;
      return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }
    const ids: (string | undefined)[] = [undefined, '111', '222'];
    function randomStore(rand: () => number): StoreV2 {
      const notes: Record<string, NoteRecord> = {};
      for (const handle of ['a', 'b', 'c']) {
        const text = `t${Math.floor(rand() * 4)}`;
        const updatedAt = 1 + Math.floor(rand() * 1000);
        const userId = ids[Math.floor(rand() * ids.length)];
        notes[handle] = makeNote(handle, updatedAt, text, 1, userId);
      }
      return storeWith(notes, {});
    }
    for (let seed = 1; seed <= 50; seed++) {
      const a = randomStore(lcg(seed));
      const b = randomStore(lcg(seed * 7919 + 13));
      expect(merge(a, b, NOW), `commutative seed ${seed}`).toEqual(merge(b, a, NOW));
      expect(merge(a, a, NOW), `idempotent seed ${seed}`).toEqual(a);
    }
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
