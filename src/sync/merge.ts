import type { NoteRecord, StoreV2 } from '../core/types';

export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

type Candidate = { kind: 'note'; ts: number; note: NoteRecord } | { kind: 'tombstone'; ts: number };

/** JSON with a fixed (alphabetical) key order — position-independent tie-breaker. */
export function canonicalNote(n: NoteRecord): string {
  return JSON.stringify({
    color: n.color,
    createdAt: n.createdAt,
    handle: n.handle,
    handleLower: n.handleLower,
    text: n.text,
    updatedAt: n.updatedAt,
  });
}

/** True when `a` should win over `b`. A strict weak ordering, symmetric in argument position. */
function beats(a: Candidate, b: Candidate): boolean {
  if (a.ts !== b.ts) return a.ts > b.ts;
  if (a.kind !== b.kind) return a.kind === 'tombstone';
  if (a.kind === 'tombstone' || b.kind === 'tombstone') return false;
  return canonicalNote(a.note) > canonicalNote(b.note);
}

function pickWinner(candidates: Candidate[]): Candidate | undefined {
  if (candidates.length === 0) return undefined;
  const [first, ...rest] = candidates;
  let best = first!;
  for (const c of rest) if (beats(c, best)) best = c;
  return best;
}

/**
 * Pure last-write-wins merge over the union of both stores.
 * Commutative, idempotent, lossless. Tombstones older than 90 days are dropped.
 */
export function merge(local: StoreV2, remote: StoreV2, now: number = Date.now()): StoreV2 {
  const handles = new Set<string>([
    ...Object.keys(local.notes),
    ...Object.keys(remote.notes),
    ...Object.keys(local.tombstones),
    ...Object.keys(remote.tombstones),
  ]);

  const notes: Record<string, NoteRecord> = Object.create(null);
  const tombstones: Record<string, number> = Object.create(null);

  for (const handle of handles) {
    const candidates: Candidate[] = [];
    const localNote = local.notes[handle];
    if (localNote) candidates.push({ kind: 'note', ts: localNote.updatedAt, note: localNote });
    const remoteNote = remote.notes[handle];
    if (remoteNote) candidates.push({ kind: 'note', ts: remoteNote.updatedAt, note: remoteNote });
    const localTomb = local.tombstones[handle];
    if (localTomb !== undefined) candidates.push({ kind: 'tombstone', ts: localTomb });
    const remoteTomb = remote.tombstones[handle];
    if (remoteTomb !== undefined) candidates.push({ kind: 'tombstone', ts: remoteTomb });

    const winner = pickWinner(candidates);
    if (!winner) continue;
    if (winner.kind === 'tombstone') {
      if (now - winner.ts <= TOMBSTONE_MAX_AGE_MS) tombstones[handle] = winner.ts;
    } else {
      notes[handle] = winner.note;
    }
  }

  return { schemaVersion: 2, notes, tombstones };
}
