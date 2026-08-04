import { browser } from 'wxt/browser';
import { parseProfile } from '../../src/core/profile';
import { deleteNote, getStore, subscribeToStoreChanges, upsertNote } from '../../src/core/storage';
import { isDarkBackground } from '../../src/core/theme';
import { decorateAvatars, injectHoverCardNote } from '../../src/ui/badges';
import { createNavToken, startNavWatcher } from '../../src/ui/nav';
import { createPanel, type Panel, type PanelHooks } from '../../src/ui/panel';
import './style.css';

const ANCHOR_SELECTOR = '[data-testid="primaryColumn"] [data-testid="UserName"]';
const ANCHOR_POLL_MS = 250;
const ANCHOR_TIMEOUT_MS = 4000;
const TICK_MS = 2000;

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

    function hooksFor(handle: string): PanelHooks {
      const handleLower = handle.toLowerCase();
      return {
        loadNote: async () => {
          const store = await getStore();
          return store.notes[handleLower] ?? null;
        },
        save: (text, color) => upsertNote(handle, text, color),
        remove: () => deleteNote(handle),
        openManager: () => {
          window.open(browser.runtime.getURL('/options.html'), '_blank');
        },
      };
    }

    async function mountPanel(token: { stale(): boolean }, handle: string): Promise<void> {
      const deadline = Date.now() + ANCHOR_TIMEOUT_MS;
      let anchor: Element | null = null;
      for (;;) {
        if (stopped || token.stale()) return;
        anchor = document.querySelector(ANCHOR_SELECTOR);
        if (anchor !== null || Date.now() >= deadline) break;
        await sleep(ANCHOR_POLL_MS);
      }
      if (anchor === null || stopped || token.stale()) return;
      const created = createPanel(handle, hooksFor(handle));
      panel = created;
      currentHandle = handle;
      anchor.insertAdjacentElement('afterend', created.root);
    }

    function applyTheme(): void {
      const background = getComputedStyle(document.body).backgroundColor;
      document.documentElement.classList.toggle('xn-dark', isDarkBackground(background));
    }

    async function decorateTick(): Promise<void> {
      if (stopped || !contextAlive()) return;
      // ponytail: re-read storage every tick — cheap local read, no cache needed
      const store = await getStore();
      if (stopped) return;
      const profile = parseProfile(new URL(location.href));
      decorateAvatars(
        document,
        store.notes,
        profile === null ? null : profile.handle.toLowerCase(),
      );
      injectHoverCardNote(document, store.notes);
    }

    function onNav(url: URL): void {
      applyTheme();
      teardownPanel();
      const token = createNavToken();
      const profile = parseProfile(url);
      if (profile !== null) void mountPanel(token, profile.handle);
      void decorateTick();
    }

    const unsubscribe = subscribeToStoreChanges(() => {
      if (panel === null || currentHandle === null) return;
      const panelNow = panel;
      const handle = currentHandle;
      void getStore().then((store) => {
        if (stopped || panel !== panelNow || currentHandle !== handle) return;
        panelNow.refresh(store.notes[handle.toLowerCase()] ?? null);
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
