import { browser } from 'wxt/browser';
import {
  emptyAliases,
  getAlias,
  lookupByUserId,
  recordObservation,
  type AliasStore,
} from '../../src/core/aliases';
import { sendBackground } from '../../src/core/messages';
import { parseProfile } from '../../src/core/profile';
import {
  deleteNote,
  getAliases,
  getStore,
  saveAliases,
  saveStore,
  subscribeToStoreChanges,
  upsertNote,
} from '../../src/core/storage';
import { isDarkBackground } from '../../src/core/theme';
import type { NoteRecord, StoreV2 } from '../../src/core/types';
import { learnUserId } from '../../src/core/user-id';
import { decorateAvatars, injectHoverCardNote, withoutWithheldNotes } from '../../src/ui/badges';
import { createNavToken, startNavWatcher } from '../../src/ui/nav';
import { createPanel, type Panel, type PanelHooks } from '../../src/ui/panel';
import './style.css';

const ANCHOR_SELECTOR = '[data-testid="primaryColumn"] [data-testid="UserName"]';
const ANCHOR_POLL_MS = 250;
const ANCHOR_TIMEOUT_MS = 4000;
const TICK_MS = 2000;

/**
 * Outcome of one identity-learning pass for a visited profile handle.
 * Fail-soft throughout: unknown IDs and storage errors yield the unknown
 * result instead of throwing.
 */
export interface LearnOutcome {
  observedId: string | null;
  renamedFrom: string | null;
  withheld: boolean;
}

/**
 * Normalize a handle the same way the alias store keys it.
 */
function normalizeLower(handle: string): string {
  return handle.trim().replace(/^@/, '').trim().toLowerCase();
}

/**
 * Learn the stable user ID for a visited profile handle and apply the
 * rename/hijack policy. Records the observation so the alias reflects the
 * current holder (overwrite on hijack is deliberate); moves a note from a
 * previously-bound handle on rename (preserving text/color/createdAt,
 * tombstoning the old key, clearing any tombstone on the revisited handle,
 * never overwriting an existing new-handle note);
 * backfills userId-less notes without overwriting: no prior binding stamps
 * the observed ID (first-visit backfill), an agreeing binding stamps the
 * observed ID, a disagreeing binding pins the prior owner ID so the
 * withhold survives the alias overwrite (stale pins are resolved by
 * explicit user review in the manager, never auto-deleted). Unknown IDs
 * touch nothing. Aborts all alias and note mutations when the alias-store
 * read itself failed (`ok: false`), returning the unknown outcome instead of
 * clobbering real aliases with a near-empty store. Never throws.
 */
export async function learnIdentityForProfile(
  handle: string,
  doc: Document,
): Promise<LearnOutcome> {
  const unknown: LearnOutcome = { observedId: null, renamedFrom: null, withheld: false };
  let observedId: string | null;
  try {
    observedId = learnUserId(doc, handle);
  } catch {
    return unknown;
  }
  if (observedId === null) return unknown;
  const handleLower = normalizeLower(handle);
  if (handleLower === '') return unknown;
  let aliases: AliasStore;
  let store: StoreV2;
  try {
    const aliasRead = await getAliases();
    if (!aliasRead.ok) return unknown;
    aliases = aliasRead.aliases;
    store = await getStore();
  } catch {
    return unknown;
  }
  const aliasBefore = getAlias(aliases, handleLower);
  const updatedAliases = recordObservation(aliases, handle, observedId);
  try {
    await saveAliases(updatedAliases);
  } catch {
    return unknown;
  }
  const now = Date.now();
  let renamedFrom: string | null = null;
  try {
    const current = store.notes[handleLower] ?? null;
    if (current === null) {
      let best: NoteRecord | null = null;
      const others = lookupByUserId(updatedAliases, observedId).filter(
        (candidate) => candidate !== handleLower,
      );
      for (const [key, note] of Object.entries(store.notes)) {
        if (key !== handleLower && note.userId === observedId && !others.includes(key)) {
          others.push(key);
        }
      }
      for (const candidate of others) {
        const note = store.notes[candidate] ?? null;
        if (note === null) continue;
        if (note.userId !== undefined && note.userId !== observedId) continue;
        if (best === null || note.updatedAt > best.updatedAt) best = note;
      }
      if (best !== null) {
        const bestLower = best.handleLower;
        store.notes[handleLower] = {
          handle,
          handleLower,
          text: best.text,
          color: best.color,
          createdAt: best.createdAt,
          updatedAt: now,
          userId: observedId,
        };
        delete store.notes[bestLower];
        store.tombstones[bestLower] = now;
        delete store.tombstones[handleLower];
        await saveStore(store);
        renamedFrom = best.handle;
      }
    } else if (current.userId === undefined) {
      current.userId = aliasBefore?.userId ?? observedId;
      await saveStore(store);
    }
  } catch {
    return { observedId, renamedFrom, withheld: false };
  }
  const visible = store.notes[handleLower] ?? null;
  const recorded = visible?.userId ?? aliasBefore?.userId;
  const withheld = visible !== null && recorded !== undefined && recorded !== observedId;
  return { observedId, renamedFrom, withheld };
}

/**
 * Read the note visible on a profile: the stored note unless its recorded
 * user ID disagrees with the currently observed page ID (hijack withhold
 * shows the empty state). A note with no user ID and an observed ID is
 * stamped with the observed ID (same trust as the first-visit learn
 * backfill: same handle, same observed source) and shown; a present,
 * disagreeing user ID is still withheld without writing. Fail-soft on DOM
 * reads and on the backfill write; storage reads behave like before.
 */
export async function loadVisibleNote(handleLower: string): Promise<NoteRecord | null> {
  const store = await getStore();
  const note = store.notes[handleLower] ?? null;
  let observed: string | null;
  try {
    observed = learnUserId(document, handleLower);
  } catch {
    return note;
  }
  if (observed === null) return note;
  if (note !== null && note.userId === observed) return note;
  let best: NoteRecord | null = null;
  for (const candidate of Object.values(store.notes)) {
    if (candidate.userId !== observed) continue;
    if (best === null || candidate.updatedAt > best.updatedAt) best = candidate;
  }
  if (best !== null) return best;
  if (note === null) return null;
  if (note.userId === undefined) {
    note.userId = observed;
    try {
      await saveStore(store);
    } catch {
      // ponytail: fail-soft — the note still shows; the next visit retries the stamp
    }
    return note;
  }
  return null;
}

export async function retryLearnWhenUnknown(
  handle: string,
  doc: Document,
  first: LearnOutcome,
  token?: { stale(): boolean },
): Promise<LearnOutcome | null> {
  if (first.observedId !== null) return null;
  if (token !== undefined && token.stale()) return null;
  let second: LearnOutcome;
  try {
    second = await learnIdentityForProfile(handle, doc);
  } catch {
    return null;
  }
  if (token !== undefined && token.stale()) return null;
  return second;
}

function contextAlive(): boolean {
  try {
    return Boolean(browser.runtime?.id);
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default defineContentScript({
  matches: [
    'https://x.com/*',
    'https://www.x.com/*',
    'https://twitter.com/*',
    'https://www.twitter.com/*',
  ],
  main(ctx) {
    let panel: Panel | null = null;
    let currentHandle: string | null = null;
    let stopped = false;
    let stopNav: (() => void) | null = null;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    /**
     * Serialized queue for identity-learning passes. Rapid SPA navigations
     * must not overlap read-modify-write cycles (a rename move could be
     * lost); each nav's learn-then-mount step runs in arrival order. Chained
     * with both fulfillment and rejection handlers so one failure never
     * stalls later navs. Panel teardown stays synchronous in `onNav`.
     */
    let learnChain: Promise<void> = Promise.resolve();

    function teardownPanel(): void {
      if (panel !== null) {
        panel.root.remove();
        panel.destroy();
        panel = null;
      }
      currentHandle = null;
    }

    function stopAll(): void {
      if (stopped) return;
      stopped = true;
      if (stopNav !== null) stopNav();
      if (tickInterval !== null) clearInterval(tickInterval);
      unsubscribe();
      teardownPanel();
    }

    /**
     * Panel hooks for one profile handle. Loads route through the shared
     * withhold check; saves stamp the observed ID when known (an explicit
     * user write, so overwriting a withheld orphan resolves it by action).
     */
    function hooksFor(handle: string): PanelHooks {
      const handleLower = handle.toLowerCase();
      return {
        loadNote: () => loadVisibleNote(handleLower),
        save: (text, color) => {
          let userId: string | undefined;
          try {
            userId = learnUserId(document, handle) ?? undefined;
          } catch {
            userId = undefined;
          }
          return upsertNote(handle, text, color, undefined, userId);
        },
        remove: () => deleteNote(handle),
        openManager: () => {
          sendBackground({ type: 'open-options' }).catch(() => {});
        },
      };
    }

    /**
     * Wait for the profile name anchor, then mount the panel, carrying the
     * formerly-known handle (from a rename move) into the panel hint.
     */
    async function mountPanel(
      token: { stale(): boolean },
      handle: string,
      formerHandle?: string | null,
    ): Promise<void> {
      const deadline = Date.now() + ANCHOR_TIMEOUT_MS;
      let anchor: Element | null = null;
      for (;;) {
        if (stopped || token.stale()) return;
        anchor = document.querySelector(ANCHOR_SELECTOR);
        if (anchor !== null || Date.now() >= deadline) break;
        await sleep(ANCHOR_POLL_MS);
      }
      if (anchor === null || stopped || token.stale()) return;
      const created = createPanel(handle, hooksFor(handle), {
        formerHandle: formerHandle ?? null,
      });
      panel = created;
      currentHandle = handle;
      anchor.insertAdjacentElement('afterend', created.root);
    }

    function applyTheme(): void {
      const background = getComputedStyle(document.body).backgroundColor;
      document.documentElement.classList.toggle('xn-dark', isDarkBackground(background));
    }

    /**
     * Badge/hover refresh. Reads aliases fail-soft (a failed alias read
     * renders as empty for display only) and hides hijack-withheld notes
     * from avatars and hover cards, keeping existing handle matching.
     */
    async function decorateTick(): Promise<void> {
      if (stopped || !contextAlive()) return;
      applyTheme();
      // ponytail: re-read storage every tick — cheap local read, no cache needed
      const store = await getStore();
      if (stopped) return;
      const aliasRead = await getAliases();
      const aliases = aliasRead.ok ? aliasRead.aliases : emptyAliases();
      const visible = withoutWithheldNotes(store.notes, aliases);
      if (stopped) return;
      const profile = parseProfile(new URL(location.href));
      decorateAvatars(document, visible, profile === null ? null : profile.handle.toLowerCase());
      injectHoverCardNote(document, visible);
    }

    /** SPA navigation: learn identity first so panel state is fresh, then mount. */
    function onNav(url: URL): void {
      applyTheme();
      teardownPanel();
      const token = createNavToken();
      const profile = parseProfile(url);
      if (profile !== null) {
        const handle = profile.handle;
        const step = async (): Promise<void> => {
          let first: LearnOutcome;
          try {
            first = await learnIdentityForProfile(handle, document);
          } catch {
            first = { observedId: null, renamedFrom: null, withheld: false };
          }
          try {
            await mountPanel(token, handle, first.renamedFrom);
          } catch {
            // ponytail: fail-soft — a mount failure must not break the queue
          }
          const second = await retryLearnWhenUnknown(handle, document, first, token);
          if (second === null || token.stale()) return;
          if (second.renamedFrom !== null) {
            teardownPanel();
            if (token.stale()) return;
            try {
              await mountPanel(token, handle, second.renamedFrom);
            } catch {
              // ponytail: fail-soft — a mount failure must not break the queue
            }
          } else if (second.observedId !== null && panel !== null && currentHandle === handle) {
            const refreshed = await loadVisibleNote(handle.toLowerCase());
            if (token.stale() || panel === null || currentHandle !== handle) return;
            panel.refresh(refreshed);
          }
        };
        learnChain = learnChain.then(step, step);
      }
      void decorateTick();
    }

    const unsubscribe = subscribeToStoreChanges(() => {
      if (panel === null || currentHandle === null) return;
      const panelNow = panel;
      const handle = currentHandle;
      void loadVisibleNote(handle.toLowerCase()).then((note) => {
        if (stopped || panel !== panelNow || currentHandle !== handle) return;
        panelNow.refresh(note);
      });
    });

    applyTheme();
    stopNav = startNavWatcher(onNav);
    onNav(new URL(location.href));
    tickInterval = setInterval(() => {
      if (!contextAlive()) {
        stopAll();
        return;
      }
      void decorateTick();
    }, TICK_MS);

    ctx.onInvalidated(() => stopAll());
  },
});
