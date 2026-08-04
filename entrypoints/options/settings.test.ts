// @vitest-environment happy-dom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSettings } from '../../src/core/storage';
import { endpointOrigin, endpointPermissionPattern, mountSettings } from './settings';

describe('endpointOrigin', () => {
  it('extracts the origin from valid endpoints', () => {
    expect(endpointOrigin('https://dav.example.com')).toBe('https://dav.example.com');
    expect(endpointOrigin('http://192.168.1.10:5244')).toBe('http://192.168.1.10:5244');
    expect(endpointOrigin('https://dav.example.com/folder/')).toBe('https://dav.example.com');
  });

  it('returns null for malformed or non-http endpoints', () => {
    expect(endpointOrigin('not a url')).toBeNull();
    expect(endpointOrigin('ftp://dav.example.com')).toBeNull();
    expect(endpointOrigin('')).toBeNull();
  });
});

describe('endpointPermissionPattern', () => {
  it('omits the port from the permission pattern', () => {
    expect(endpointPermissionPattern('https://dav.example.com:8443/path')).toBe(
      'https://dav.example.com/*',
    );
    expect(endpointPermissionPattern('http://localhost:5244')).toBe('http://localhost/*');
  });

  it('uses the origin without path for the pattern', () => {
    expect(endpointPermissionPattern('https://dav.example.com/folder/')).toBe(
      'https://dav.example.com/*',
    );
  });

  it('returns null for malformed endpoints', () => {
    expect(endpointPermissionPattern('not a url')).toBeNull();
  });
});

describe('mountSettings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('loads saved settings into the form, hiding the s3 fields and the passphrase', async () => {
    await saveSettings({
      backend: {
        backend: 'webdav',
        endpoint: 'https://dav.example.com',
        username: 'user',
        password: 'pass',
        path: '/xnotes/notes.json',
      },
      syncIntervalMinutes: 10,
      encryptionEnabled: true,
    });
    const root = document.createElement('div');
    document.body.append(root);
    mountSettings(root);
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLSelectElement>('.backend-select')?.value).toBe('webdav');
      expect(root.querySelector<HTMLInputElement>('.sync-interval')?.value).toBe('10');
    });
    const endpoint = [...root.querySelectorAll<HTMLInputElement>('input')].find(
      (input) => input.value === 'https://dav.example.com',
    );
    expect(endpoint).toBeDefined();
    expect(root.querySelector<HTMLInputElement>('.passphrase-input')?.value).toBe('');
    expect(root.querySelector<HTMLInputElement>('.encryption-toggle')?.checked).toBe(true);
    const fieldsets = root.querySelectorAll<HTMLFieldSetElement>('fieldset.backend-fields');
    expect(fieldsets[0]?.hidden).toBe(false);
    expect(fieldsets[1]?.hidden).toBe(true);
  });

  it('saves settings without ever persisting the passphrase', async () => {
    const seen: string[] = [];
    fakeBrowser.runtime.onMessage.addListener(
      (msg: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
        if (typeof msg === 'object' && msg !== null && 'type' in msg) {
          seen.push(String(msg.type));
        }
        sendResponse({ ok: true });
        return true;
      },
    );
    // ponytail: request is overloaded (promise | callback) — spyOn types the callback overload
    vi.spyOn(fakeBrowser.permissions, 'request').mockImplementation(() => Promise.resolve(true));

    const root = document.createElement('div');
    document.body.append(root);
    mountSettings(root);
    await vi.waitFor(() => {
      expect(root.querySelectorAll<HTMLFieldSetElement>('fieldset.backend-fields')[0]?.hidden).toBe(
        true,
      );
    });
    const select = root.querySelector<HTMLSelectElement>('.backend-select');
    expect(select).not.toBeNull();
    if (select === null) return;
    select.value = 'webdav';
    const inputs = root.querySelectorAll<HTMLFieldSetElement>('fieldset.backend-fields')[0];
    expect(inputs).toBeDefined();
    if (inputs === undefined) return;
    const fields = inputs.querySelectorAll<HTMLInputElement>('input');
    fields[0]!.value = 'https://dav.example.com';
    fields[1]!.value = 'user';
    fields[2]!.value = 'pass';
    const toggle = root.querySelector<HTMLInputElement>('.encryption-toggle');
    const passphrase = root.querySelector<HTMLInputElement>('.passphrase-input');
    expect(toggle).not.toBeNull();
    expect(passphrase).not.toBeNull();
    if (toggle === null || passphrase === null) return;
    toggle.checked = true;
    passphrase.value = 'hunter2-secret';

    const save = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save',
    );
    expect(save).toBeDefined();
    if (save === undefined) return;
    save.click();

    await vi.waitFor(() => {
      expect(seen).toContain('backend-activated');
    });
    expect(seen).toContain('set-passphrase');
    expect(seen).toContain('encryption-changed');
    const stored = JSON.stringify(await fakeBrowser.storage.local.get(null));
    expect(stored).not.toContain('hunter2-secret');
    expect(root.querySelector<HTMLInputElement>('.passphrase-input')?.value).toBe('');
  });

  it('does not clobber S3 endpoint error slot when WebDAV endpoint is invalid', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountSettings(root);
    await vi.waitFor(() => {
      expect(root.querySelectorAll<HTMLFieldSetElement>('fieldset.backend-fields')[0]?.hidden).toBe(
        true,
      );
    });
    const select = root.querySelector<HTMLSelectElement>('.backend-select');
    if (select === null) return;
    select.value = 'webdav';
    select.dispatchEvent(new Event('change'));
    const webdavFields = root.querySelectorAll<HTMLFieldSetElement>('fieldset.backend-fields')[0];
    if (webdavFields === undefined) return;
    const webdavInputs = webdavFields.querySelectorAll<HTMLInputElement>('input');
    webdavInputs[0]!.value = 'not-a-url';
    webdavInputs[1]!.value = 'user';
    webdavInputs[2]!.value = 'pass';
    const save = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save',
    );
    if (save === undefined) return;
    vi.spyOn(fakeBrowser.permissions, 'request').mockImplementation(() => Promise.resolve(true));
    save.click();
    await vi.waitFor(() => {
      const webdavError = webdavFields.querySelector<HTMLElement>('.field-error');
      expect(webdavError?.textContent).not.toBe('');
    });
    select.value = 's3';
    select.dispatchEvent(new Event('change'));
    const s3Fields = root.querySelectorAll<HTMLFieldSetElement>('fieldset.backend-fields')[1];
    if (s3Fields === undefined) return;
    const s3Error = s3Fields.querySelectorAll<HTMLElement>('.field-error')[0];
    expect(s3Error?.textContent).toBe('');
  });
});
