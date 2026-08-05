import './style.css';
import { browser } from 'wxt/browser';
import { formatTimestamp } from '../../src/core/format';
import { sendBackground } from '../../src/core/messages';
import type { BackgroundResponse, SyncStatusResponse } from '../../src/core/messages';
import { mountOnboarding } from '../options/onboarding';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string = '',
  text: string = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function isStatusResponse(response: BackgroundResponse): response is SyncStatusResponse {
  return 'state' in response;
}

function optionsLink(label: string, hash: string): HTMLAnchorElement {
  const link = el('a', undefined, label);
  link.href = browser.runtime.getURL(`/options.html${hash}`);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

async function fetchStatus(): Promise<SyncStatusResponse | null> {
  try {
    const response = await sendBackground({ type: 'get-sync-status' });
    return isStatusResponse(response) ? response : null;
  } catch {
    return null;
  }
}

async function rerender(root: HTMLElement, action: Promise<unknown>): Promise<void> {
  try {
    await action;
  } catch {
    // ponytail: the refreshed status line surfaces any failure
  }
  await renderPopup(root);
}

export async function renderPopup(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  const status = await fetchStatus();
  if (status === null) {
    root.append(el('p', 'popup-error', 'Cannot reach the extension background.'));
    return;
  }
  const links = el('div', 'popup-links');
  links.append(optionsLink('All notes', '#notes'), optionsLink('Sync settings', '#settings'));
  if (!status.backendConfigured) {
    root.append(
      el(
        'p',
        'popup-local',
        'Local-only mode — notes stay on this device. Configure sync in settings.',
      ),
      links,
    );
    return;
  }
  root.append(
    el('p', `popup-status popup-status-${status.state.status}`, `Status: ${status.state.status}`),
  );
  root.append(
    el(
      'p',
      'popup-last-sync',
      `Last sync: ${status.state.lastSyncAt === null ? 'never' : formatTimestamp(status.state.lastSyncAt)}`,
    ),
  );
  if (status.state.status === 'error' && status.state.lastError !== null) {
    root.append(el('p', 'popup-error', status.state.lastError));
  }
  const syncNow = el('button', undefined, 'Sync now');
  syncNow.addEventListener('click', () => {
    void rerender(root, sendBackground({ type: 'sync-now' }));
  });
  root.append(syncNow);
  if (status.state.lastError !== null && status.state.lastError.includes('confirm overwrite')) {
    const overwrite = el('button', 'danger', 'Overwrite remote plaintext');
    overwrite.addEventListener('click', () => {
      void rerender(root, sendBackground({ type: 'overwrite-remote-plaintext' }));
    });
    root.append(overwrite);
  }
  if (status.encryptionEnabled && !status.passphraseSet) {
    const input = el('input', 'popup-passphrase');
    input.type = 'password';
    input.placeholder = 'Passphrase';
    const unlock = el('button', undefined, 'Unlock');
    unlock.addEventListener('click', () => {
      void rerender(root, sendBackground({ type: 'set-passphrase', passphrase: input.value }));
    });
    root.append(input, unlock);
  }
  root.append(links);
}

const onboardingSlot = document.querySelector<HTMLDivElement>('#onboarding');
if (onboardingSlot !== null) mountOnboarding(onboardingSlot);

const popupRoot = document.querySelector<HTMLDivElement>('#popup');
if (popupRoot !== null) void renderPopup(popupRoot);
