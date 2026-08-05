import { browser } from 'wxt/browser';

const ORIGINS = [
  'https://x.com/*',
  'https://twitter.com/*',
  'https://www.x.com/*',
  'https://www.twitter.com/*',
];

export function mountOnboarding(root: HTMLElement): void {
  void (async () => {
    let granted = true;
    try {
      granted = await browser.permissions.contains({ origins: ORIGINS });
    } catch {
      // ponytail: fail-soft — no banner when the permissions API is unavailable
    }
    if (granted) return;

    const banner = document.createElement('div');
    banner.className = 'onboarding';
    const text = document.createElement('p');
    text.textContent =
      'xNotes needs access to x.com / twitter.com to show notes on profiles. Your notes stay local until you configure sync.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Grant access';
    button.addEventListener('click', () => {
      void (async () => {
        let ok = false;
        try {
          ok = await browser.permissions.request({ origins: ORIGINS });
        } catch {
          ok = false;
        }
        if (ok) banner.remove();
        else text.textContent = 'Permission was not granted — notes on profiles stay disabled.';
      })();
    });
    banner.append(text, button);
    root.append(banner);
  })();
}
