const DEBOUNCE_MS = 150;
const BACKSTOP_MS = 700;

export function startNavWatcher(callback: (url: URL) => void): () => void {
  let lastHref = location.href;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const check = (): void => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    callback(new URL(location.href));
  };

  const scheduleCheck = (): void => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(check, DEBOUNCE_MS);
  };

  const observer = new MutationObserver(scheduleCheck);
  if (document.body !== null) {
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }

  const interval = setInterval(check, BACKSTOP_MS);
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    observer.disconnect();
    clearInterval(interval);
    window.removeEventListener('popstate', check);
    window.removeEventListener('hashchange', check);
  };
}

let tokenCounter = 0;

export function createNavToken(): { id: number; stale(): boolean } {
  tokenCounter += 1;
  const id = tokenCounter;
  return { id, stale: () => tokenCounter > id };
}
