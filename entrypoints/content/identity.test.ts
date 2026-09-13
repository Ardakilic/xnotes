// @vitest-environment happy-dom

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAliases, getAlias, recordObservation } from '../../src/core/aliases';
import { getAliases, getStore, renameNote, saveAliases, saveStore } from '../../src/core/storage';
import { merge } from '../../src/sync/merge';
import { createPanel } from '../../src/ui/panel';
import { formerHandleFor, isOrphanNote } from '../options/manager';
import type { LearnOutcome } from './index';
import type { NoteRecord, StoreV2 } from '../../src/core/types';

let learnIdentityForProfile: (handle: string, doc: Document) => Promise<LearnOutcome>;
let loadVisibleNote: (handleLower: string) => Promise<NoteRecord | null>;
let retryLearnWhenUnknown: (
  handle: string,
  doc: Document,
  first: LearnOutcome,
  token?: { stale(): boolean },
) => Promise<LearnOutcome | null>;

beforeAll(async () => {
  if (Reflect.get(globalThis, 'defineContentScript') === undefined) {
    Reflect.set(globalThis, 'defineContentScript', (config: unknown) => config);
  }
  const mod = await import('./index');
  learnIdentityForProfile = mod.learnIdentityForProfile;
  loadVisibleNote = mod.loadVisibleNote;
  retryLearnWhenUnknown = mod.retryLearnWhenUnknown;
});

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '';
});

function setJsonLd(payload: string): void {
  document.body.innerHTML = `<script type="application/ld+json">${payload}</script>`;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('rename policy', () => {
  it('moves the note preserving content, advances updatedAt, tombstones the old key', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        oldhandle: {
          handle: 'OldHandle',
          handleLower: 'oldhandle',
          text: 'keep me',
          color: 'teal',
          createdAt: 100,
          updatedAt: 200,
          userId: '123',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'oldhandle', '123', 50));
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"newhandle"}}');

    const outcome = await learnIdentityForProfile('newhandle', document);

    expect(outcome.observedId).toBe('123');
    expect(outcome.renamedFrom).toBe('OldHandle');
    expect(outcome.withheld).toBe(false);
    const store = await getStore();
    const moved = store.notes['newhandle'];
    expect(moved?.text).toBe('keep me');
    expect(moved?.color).toBe('teal');
    expect(moved?.createdAt).toBe(100);
    expect(moved?.userId).toBe('123');
    expect(moved?.updatedAt).toBeGreaterThan(200);
    expect(store.notes['oldhandle']).toBeUndefined();
    expect(store.tombstones['oldhandle']).toBeDefined();
  });

  it('converges across sync: renamed store beats a stale remote holding the old key', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        oldhandle: {
          handle: 'OldHandle',
          handleLower: 'oldhandle',
          text: 'keep me',
          color: 'teal',
          createdAt: 100,
          updatedAt: 200,
          userId: '123',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'oldhandle', '123', 50));
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"newhandle"}}');
    await learnIdentityForProfile('newhandle', document);

    const renamed = await getStore();
    const staleRemote: StoreV2 = {
      schemaVersion: 2,
      notes: {
        oldhandle: {
          handle: 'OldHandle',
          handleLower: 'oldhandle',
          text: 'keep me',
          color: 'teal',
          createdAt: 100,
          updatedAt: 200,
          userId: '123',
        },
      },
      tombstones: {},
    };
    const forward = merge(renamed, staleRemote);
    const backward = merge(staleRemote, renamed);
    expect(forward).toEqual(backward);
    expect(forward.notes['newhandle']?.text).toBe('keep me');
    expect(forward.notes['oldhandle']).toBeUndefined();
    expect(forward.tombstones['oldhandle']).toBeDefined();
  });

  it('exposes the formerly-known handle for a renamed note', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        oldhandle: {
          handle: 'OldHandle',
          handleLower: 'oldhandle',
          text: 'keep me',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '123',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'oldhandle', '123', 50));
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"newhandle"}}');
    await learnIdentityForProfile('newhandle', document);

    const store = await getStore();
    const moved = store.notes['newhandle'];
    expect(moved).toBeDefined();
    if (moved === undefined) return;
    expect(formerHandleFor(moved, (await getAliases()).aliases, store.tombstones)).toBe(
      'oldhandle',
    );
  });
});

describe('hijack policy', () => {
  async function seedHijack(): Promise<void> {
    await saveStore({
      schemaVersion: 2,
      notes: {
        victim: {
          handle: 'victim',
          handleLower: 'victim',
          text: 'original owner text',
          color: 'red',
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'victim', '111', 50));
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"victim"}}');
  }

  it('withholds the note without a tombstone and preserves the orphan', async () => {
    await seedHijack();
    const outcome = await learnIdentityForProfile('victim', document);

    expect(outcome.observedId).toBe('222');
    expect(outcome.renamedFrom).toBeNull();
    expect(outcome.withheld).toBe(true);
    const store = await getStore();
    expect(store.notes['victim']?.text).toBe('original owner text');
    expect(store.notes['victim']?.userId).toBe('111');
    expect(store.tombstones['victim']).toBeUndefined();
    expect(Object.keys(store.notes)).toEqual(['victim']);
  });

  it('surfaces the withheld note as an orphan after the alias overwrite', async () => {
    await seedHijack();
    await learnIdentityForProfile('victim', document);

    const store = await getStore();
    const aliases = (await getAliases()).aliases;
    expect(getAlias(aliases, 'victim')?.userId).toBe('222');
    const note = store.notes['victim'];
    expect(note).toBeDefined();
    if (note === undefined) return;
    expect(isOrphanNote(note, aliases)).toBe(true);
  });

  it('renders the empty panel state for a withheld note', async () => {
    await seedHijack();
    const outcome = await learnIdentityForProfile('victim', document);
    expect(outcome.withheld).toBe(true);

    const panel = createPanel('victim', {
      loadNote: vi.fn(async () => null),
      save: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      openManager: vi.fn(),
    });
    await flush();
    expect(panel.root.querySelector('button.xn-add')).not.toBeNull();
    expect(panel.root.querySelector('.xn-note-text')).toBeNull();
    expect(panel.root.querySelector('textarea')).toBeNull();
    expect(panel.root.textContent).not.toContain('original owner text');
  });
});

describe('manager rename re-learn', () => {
  it('rename onto an unrelated handle withholds instead of re-learning the new owner', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        oldhandle: {
          handle: 'oldhandle',
          handleLower: 'oldhandle',
          text: 'moved note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'oldhandle', '111', 50));
    expect(await renameNote('oldhandle', 'newhandle', 'moved note', null, 300)).toBe('renamed');
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"newhandle"}}');
    const outcome = await learnIdentityForProfile('newhandle', document);
    expect(outcome.observedId).toBe('222');
    expect(outcome.withheld).toBe(true);
    const store = await getStore();
    const moved = store.notes['newhandle'];
    expect(moved?.userId).toBe('111');
    expect(moved).toBeDefined();
    if (moved === undefined) return;
    expect(isOrphanNote(moved, (await getAliases()).aliases)).toBe(true);
  });

  it('rename onto the same owner stays visible', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        oldhandle: {
          handle: 'oldhandle',
          handleLower: 'oldhandle',
          text: 'moved note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'oldhandle', '111', 50));
    expect(await renameNote('oldhandle', 'newhandle', 'moved note', null, 300)).toBe('renamed');
    setJsonLd('{"mainEntity":{"identifier":"111","alternateName":"newhandle"}}');
    const outcome = await learnIdentityForProfile('newhandle', document);
    expect(outcome.observedId).toBe('111');
    expect(outcome.withheld).toBe(false);
    const store = await getStore();
    expect(store.notes['newhandle']?.userId).toBe('111');
  });
});

describe('userId backfill', () => {
  it('backfills the observed ID on first visit with no prior binding', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        newbie: {
          handle: 'newbie',
          handleLower: 'newbie',
          text: 'saved before id known',
          color: null,
          createdAt: 100,
          updatedAt: 200,
        },
      },
      tombstones: {},
    });
    await saveAliases(emptyAliases());
    setJsonLd('{"mainEntity":{"identifier":"999","alternateName":"newbie"}}');

    const outcome = await learnIdentityForProfile('newbie', document);

    expect(outcome.observedId).toBe('999');
    expect(outcome.withheld).toBe(false);
    const store = await getStore();
    expect(store.notes['newbie']?.userId).toBe('999');
    expect(store.tombstones['newbie']).toBeUndefined();
    expect(getAlias((await getAliases()).aliases, 'newbie')?.userId).toBe('999');
  });

  it('pins the prior owner ID when the binding disagrees with the observed ID', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        recycled: {
          handle: 'recycled',
          handleLower: 'recycled',
          text: 'saved before id known',
          color: null,
          createdAt: 100,
          updatedAt: 200,
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'recycled', '111', 50));
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"recycled"}}');

    const outcome = await learnIdentityForProfile('recycled', document);

    expect(outcome.observedId).toBe('222');
    expect(outcome.withheld).toBe(true);
    const store = await getStore();
    const note = store.notes['recycled'];
    expect(note?.userId).toBe('111');
    expect(store.tombstones['recycled']).toBeUndefined();
    expect(note).toBeDefined();
    if (note === undefined) return;
    expect(isOrphanNote(note, (await getAliases()).aliases)).toBe(true);
  });

  it('stamps the observed ID when the binding agrees', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        regular: {
          handle: 'regular',
          handleLower: 'regular',
          text: 'saved before id known',
          color: null,
          createdAt: 100,
          updatedAt: 200,
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'regular', '333', 50));
    setJsonLd('{"mainEntity":{"identifier":"333","alternateName":"regular"}}');

    const outcome = await learnIdentityForProfile('regular', document);

    expect(outcome.observedId).toBe('333');
    expect(outcome.withheld).toBe(false);
    const store = await getStore();
    expect(store.notes['regular']?.userId).toBe('333');
    expect(store.tombstones['regular']).toBeUndefined();
  });
});

describe('renamed-note visit backfill on panel load', () => {
  async function seedTheo(): Promise<void> {
    await saveStore({
      schemaVersion: 2,
      notes: {
        theo: {
          handle: 'theo',
          handleLower: 'theo',
          text: 'theo note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'theo', '111', 50));
    expect(await renameNote('theo', 'theo88', 'theo note', null, 300)).toBe('renamed');
  }

  it('rename theo->theo88 then visiting the same account stays visible and bound', async () => {
    await seedTheo();
    setJsonLd('{"mainEntity":{"identifier":"111","alternateName":"theo88"}}');
    const outcome = await learnIdentityForProfile('theo88', document);
    expect(outcome.observedId).toBe('111');
    expect(outcome.withheld).toBe(false);
    const store = await getStore();
    expect(store.notes['theo88']?.text).toBe('theo note');
    expect(store.notes['theo88']?.userId).toBe('111');
    expect(await loadVisibleNote('theo88')).not.toBeNull();
    expect((await loadVisibleNote('theo88'))?.text).toBe('theo note');
  });

  it('panel load backfills an ID-less renamed note when learn missed the visit', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        theo: {
          handle: 'theo',
          handleLower: 'theo',
          text: 'theo note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(emptyAliases());
    expect(await renameNote('theo', 'theo88', 'theo note', null, 300)).toBe('renamed');
    expect((await getStore()).notes['theo88']?.userId).toBeUndefined();
    setJsonLd('{"mainEntity":{"identifier":"111","alternateName":"theo88"}}');

    const note = await loadVisibleNote('theo88');

    expect(note?.text).toBe('theo note');
    expect((await getStore()).notes['theo88']?.userId).toBe('111');
  });

  it('panel load backfills an ID-less note created while logged out once logged in', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        newbie: {
          handle: 'newbie',
          handleLower: 'newbie',
          text: 'saved while logged out',
          color: null,
          createdAt: 100,
          updatedAt: 200,
        },
      },
      tombstones: {},
    });
    await saveAliases(emptyAliases());
    setJsonLd('{"mainEntity":{"identifier":"999","alternateName":"newbie"}}');

    const note = await loadVisibleNote('newbie');

    expect(note?.text).toBe('saved while logged out');
    expect((await getStore()).notes['newbie']?.userId).toBe('999');
  });

  it('panel load still withholds a conflicting-ID note without overwriting it', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        victim: {
          handle: 'victim',
          handleLower: 'victim',
          text: 'original owner text',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'victim', '111', 50));
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"victim"}}');

    expect(await loadVisibleNote('victim')).toBeNull();
    const store = await getStore();
    expect(store.notes['victim']?.text).toBe('original owner text');
    expect(store.notes['victim']?.userId).toBe('111');
    expect(store.tombstones['victim']).toBeUndefined();
  });
});

describe('manager typo rename follow-back', () => {
  it('rename theo->theo88 then visiting theo follows the note back with a former-handle hint', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        theo: {
          handle: 'theo',
          handleLower: 'theo',
          text: 'theo note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '786',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'theo', '786', 50));
    expect(await renameNote('theo', 'theo88', 'theo note', null, 300)).toBe('renamed');
    setJsonLd('{"mainEntity":{"identifier":"786","alternateName":"theo"}}');

    const outcome = await learnIdentityForProfile('theo', document);

    expect(outcome.observedId).toBe('786');
    expect(outcome.withheld).toBe(false);
    expect(outcome.renamedFrom).toBe('theo88');
    const store = await getStore();
    const moved = store.notes['theo'];
    expect(moved?.text).toBe('theo note');
    expect(moved?.userId).toBe('786');
    expect(store.notes['theo88']).toBeUndefined();
    expect(store.tombstones['theo88']).toBeDefined();
    expect(store.tombstones['theo']).toBeUndefined();
    expect(await loadVisibleNote('theo')).not.toBeNull();
    if (moved === undefined) return;
    expect(formerHandleFor(moved, (await getAliases()).aliases, store.tombstones)).toBe('theo88');
  });
});

describe('fresh-import follow', () => {
  it('follows the note via direct userId scan with empty aliases', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        theo88: {
          handle: 'theo88',
          handleLower: 'theo88',
          text: 'theo note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '786',
        },
      },
      tombstones: {},
    });
    await saveAliases(emptyAliases());
    setJsonLd('{"mainEntity":{"identifier":"786","alternateName":"theo"}}');

    const outcome = await learnIdentityForProfile('theo', document);

    expect(outcome.observedId).toBe('786');
    expect(outcome.renamedFrom).toBe('theo88');
    expect(outcome.withheld).toBe(false);
    const store = await getStore();
    expect(store.notes['theo']?.text).toBe('theo note');
    expect(store.notes['theo']?.userId).toBe('786');
    expect(store.notes['theo88']).toBeUndefined();
    expect(store.tombstones['theo88']).toBeDefined();
    expect(store.tombstones['theo']).toBeUndefined();
    expect(await loadVisibleNote('theo')).not.toBeNull();
    expect((await loadVisibleNote('theo'))?.text).toBe('theo note');
  });

  it('does not move a mismatched-ID note onto the visited handle', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        victim: {
          handle: 'victim',
          handleLower: 'victim',
          text: 'original owner text',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(emptyAliases());
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"theo"}}');

    const outcome = await learnIdentityForProfile('theo', document);

    expect(outcome.observedId).toBe('222');
    expect(outcome.renamedFrom).toBeNull();
    const store = await getStore();
    expect(store.notes['victim']?.userId).toBe('111');
    expect(store.notes['theo']).toBeUndefined();
  });
});

describe('visit-time race retry', () => {
  it('miss writes nothing then retry follows after DOM ready', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        theo88: {
          handle: 'theo88',
          handleLower: 'theo88',
          text: 'theo note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '786',
        },
      },
      tombstones: {},
    });
    await saveAliases(emptyAliases());
    document.body.innerHTML = '';

    const first = await learnIdentityForProfile('theo', document);

    expect(first).toEqual({ observedId: null, renamedFrom: null, withheld: false });
    expect((await getStore()).notes['theo88']?.text).toBe('theo note');
    expect((await getStore()).notes['theo']).toBeUndefined();
    expect((await getAliases()).aliases['theo']).toBeUndefined();

    setJsonLd('{"mainEntity":{"identifier":"786","alternateName":"theo"}}');
    const second = await retryLearnWhenUnknown('theo', document, first);

    expect(second?.observedId).toBe('786');
    expect(second?.renamedFrom).toBe('theo88');
    expect(await loadVisibleNote('theo')).not.toBeNull();
    const store = await getStore();
    expect(store.notes['theo']?.text).toBe('theo note');
    expect(store.notes['theo88']).toBeUndefined();
    expect(store.tombstones['theo88']).toBeDefined();
  });

  it('retry skips when first already observed and respects stale token', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        theo88: {
          handle: 'theo88',
          handleLower: 'theo88',
          text: 'theo note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '786',
        },
      },
      tombstones: {},
    });
    await saveAliases(emptyAliases());
    setJsonLd('{"mainEntity":{"identifier":"786","alternateName":"theo"}}');

    const first = await learnIdentityForProfile('theo', document);

    expect(first.observedId).toBe('786');
    expect(await retryLearnWhenUnknown('theo', document, first)).toBeNull();
    const missed: LearnOutcome = { observedId: null, renamedFrom: null, withheld: false };
    expect(await retryLearnWhenUnknown('theo', document, missed, { stale: () => true })).toBeNull();
  });
});

describe('alias read status', () => {
  it('returns the unknown outcome and writes nothing when the alias read fails', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        victim: {
          handle: 'victim',
          handleLower: 'victim',
          text: 'original owner text',
          color: 'red',
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    await saveAliases(recordObservation(emptyAliases(), 'victim', '111', 50));
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"victim"}}');
    const getSpy = vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation(() => {
      throw new Error('storage read failed');
    });
    const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');
    const outcome = await learnIdentityForProfile('victim', document);
    expect(outcome).toEqual({ observedId: null, renamedFrom: null, withheld: false });
    expect(setSpy).not.toHaveBeenCalled();
    getSpy.mockRestore();
    setSpy.mockRestore();
    const store = await getStore();
    expect(store.notes['victim']?.text).toBe('original owner text');
    expect(store.notes['victim']?.userId).toBe('111');
  });
});

describe('loadVisibleNote userId primary', () => {
  it('returns the ID-matching note when the handle key is absent without writing', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        oldhandle: {
          handle: 'oldhandle',
          handleLower: 'oldhandle',
          text: 'synced note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '123',
        },
      },
      tombstones: {},
    });
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"newhandle"}}');

    const note = await loadVisibleNote('newhandle');

    expect(note?.text).toBe('synced note');
    expect(note?.userId).toBe('123');
    const store = await getStore();
    expect(store.notes['newhandle']).toBeUndefined();
    expect(store.notes['oldhandle']?.text).toBe('synced note');
  });

  it('returns the ID-matching note when the handle note disagrees', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        victim: {
          handle: 'victim',
          handleLower: 'victim',
          text: 'hijacker key text',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
        theo: {
          handle: 'theo',
          handleLower: 'theo',
          text: 'true owner note',
          color: null,
          createdAt: 100,
          updatedAt: 300,
          userId: '222',
        },
      },
      tombstones: {},
    });
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"victim"}}');

    const note = await loadVisibleNote('victim');

    expect(note?.text).toBe('true owner note');
    expect(note?.userId).toBe('222');
  });

  it('prefers the exact handle match over a newer ID match', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        current: {
          handle: 'current',
          handleLower: 'current',
          text: 'exact note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '123',
        },
        other: {
          handle: 'other',
          handleLower: 'other',
          text: 'newer note',
          color: null,
          createdAt: 100,
          updatedAt: 500,
          userId: '123',
        },
      },
      tombstones: {},
    });
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"current"}}');

    const note = await loadVisibleNote('current');

    expect(note?.text).toBe('exact note');
  });

  it('picks the newest updatedAt among non-exact ID matches', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        older: {
          handle: 'older',
          handleLower: 'older',
          text: 'older note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '123',
        },
        newer: {
          handle: 'newer',
          handleLower: 'newer',
          text: 'newer note',
          color: null,
          createdAt: 100,
          updatedAt: 500,
          userId: '123',
        },
      },
      tombstones: {},
    });
    setJsonLd('{"mainEntity":{"identifier":"123","alternateName":"current"}}');

    const note = await loadVisibleNote('current');

    expect(note?.text).toBe('newer note');
  });

  it('falls back to the handle note when the ID is unfetchable', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        victim: {
          handle: 'victim',
          handleLower: 'victim',
          text: 'handle note',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });

    const note = await loadVisibleNote('victim');

    expect(note?.text).toBe('handle note');
  });

  it('withholds a disagreeing handle note when no ID matches anywhere', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        victim: {
          handle: 'victim',
          handleLower: 'victim',
          text: 'original owner text',
          color: null,
          createdAt: 100,
          updatedAt: 200,
          userId: '111',
        },
      },
      tombstones: {},
    });
    setJsonLd('{"mainEntity":{"identifier":"222","alternateName":"victim"}}');

    expect(await loadVisibleNote('victim')).toBeNull();
    const store = await getStore();
    expect(store.notes['victim']?.text).toBe('original owner text');
    expect(store.notes['victim']?.userId).toBe('111');
  });

  it('backfills an ID-less handle note when no ID matches anywhere', async () => {
    await saveStore({
      schemaVersion: 2,
      notes: {
        newbie: {
          handle: 'newbie',
          handleLower: 'newbie',
          text: 'saved before id known',
          color: null,
          createdAt: 100,
          updatedAt: 200,
        },
      },
      tombstones: {},
    });
    setJsonLd('{"mainEntity":{"identifier":"999","alternateName":"newbie"}}');

    const note = await loadVisibleNote('newbie');

    expect(note?.text).toBe('saved before id known');
    expect((await getStore()).notes['newbie']?.userId).toBe('999');
  });
});
