// @vitest-environment happy-dom

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAliases, getAlias, recordObservation } from '../../src/core/aliases';
import { getAliases, getStore, saveAliases, saveStore } from '../../src/core/storage';
import { merge } from '../../src/sync/merge';
import { createPanel } from '../../src/ui/panel';
import { formerHandleFor, isOrphanNote } from '../options/manager';
import type { LearnOutcome } from './index';
import type { StoreV2 } from '../../src/core/types';

let learnIdentityForProfile: (handle: string, doc: Document) => Promise<LearnOutcome>;

beforeAll(async () => {
  if (Reflect.get(globalThis, 'defineContentScript') === undefined) {
    Reflect.set(globalThis, 'defineContentScript', (config: unknown) => config);
  }
  const mod = await import('./index');
  learnIdentityForProfile = mod.learnIdentityForProfile;
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
