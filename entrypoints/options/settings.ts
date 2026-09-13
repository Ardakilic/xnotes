import { browser } from 'wxt/browser';
import { getSettings, saveSettings } from '../../src/core/storage';
import { sendBackground } from '../../src/core/messages';
import type { BackendSettings, S3Settings, WebdavSettings } from '../../src/core/types';
import { parseEndpointUrl, validateBackend } from '../../src/sync/settings';
import type { ValidationResult } from '../../src/sync/settings';
import { S3Adapter } from '../../src/sync/s3';
import { WebdavAdapter } from '../../src/sync/webdav';

export function endpointOrigin(endpoint: string): string | null {
  const url = parseEndpointUrl(endpoint);
  return url === null ? null : url.origin;
}

export function endpointPermissionPattern(endpoint: string): string | null {
  const url = parseEndpointUrl(endpoint);
  if (url === null) return null;
  return `${url.protocol}//${url.hostname}/*`;
}

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

function labeled(
  labelText: string,
  input: HTMLInputElement | HTMLSelectElement,
  errorSlot: HTMLElement,
  hintText: string = '',
): HTMLElement {
  const label = el('label', 'field');
  if (input instanceof HTMLInputElement && input.type === 'checkbox') {
    label.classList.add('field-checkbox');
  }
  label.append(labelText, input, errorSlot);
  if (hintText !== '') label.append(el('span', 'field-hint', hintText));
  return label;
}

function externalLink(label: string, href: string): HTMLAnchorElement {
  const link = el('a', undefined, label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

export function mountSettings(root: HTMLElement): void {
  const errorSlots = new Map<string, HTMLElement>();
  let initialEncryptionEnabled = false;

  function field(
    backend: string,
    key: string,
    labelText: string,
    input: HTMLInputElement,
    hintText: string = '',
  ): HTMLElement {
    const slot = el('span', 'field-error');
    errorSlots.set(`${backend}:${key}`, slot);
    return labeled(labelText, input, slot, hintText);
  }

  const backendSelect = el('select', 'backend-select');
  const backendOptions: [string, string][] = [
    ['none', 'None (local only)'],
    ['webdav', 'WebDAV'],
    ['s3', 'S3'],
  ];
  for (const [value, label] of backendOptions) {
    const option = el('option', undefined, label);
    option.value = value;
    backendSelect.append(option);
  }

  const webdavEndpoint = el('input');
  webdavEndpoint.type = 'url';
  webdavEndpoint.placeholder = 'https://dav.example.com';
  const webdavUsername = el('input');
  webdavUsername.type = 'text';
  const webdavPassword = el('input');
  webdavPassword.type = 'password';
  const webdavPath = el('input');
  webdavPath.type = 'text';
  webdavPath.placeholder = '/xnotes/notes.json';

  const webdavFields = el('fieldset', 'backend-fields');
  webdavFields.append(
    el('legend', undefined, 'WebDAV'),
    field('webdav', 'endpoint', 'Endpoint', webdavEndpoint),
    field('webdav', 'username', 'Username', webdavUsername),
    field('webdav', 'password', 'Password', webdavPassword),
    field('webdav', 'path', 'Blob path', webdavPath),
  );

  const s3Endpoint = el('input');
  s3Endpoint.type = 'url';
  s3Endpoint.placeholder = 'https://s3.us-east-004.backblazeb2.com';
  const s3Region = el('input');
  s3Region.type = 'text';
  const s3Bucket = el('input');
  s3Bucket.type = 'text';
  const s3Prefix = el('input');
  s3Prefix.type = 'text';
  s3Prefix.placeholder = 'xnotes/';
  const s3AccessKey = el('input');
  s3AccessKey.type = 'text';
  const s3SecretKey = el('input');
  s3SecretKey.type = 'password';
  const s3PathStyle = el('input');
  s3PathStyle.type = 'checkbox';
  const s3ForceHead = el('input');
  s3ForceHead.type = 'checkbox';

  const s3Fields = el('fieldset', 'backend-fields');
  s3Fields.append(
    el('legend', undefined, 'S3'),
    field('s3', 'endpoint', 'Endpoint', s3Endpoint),
    field('s3', 'region', 'Region', s3Region),
    field('s3', 'bucket', 'Bucket', s3Bucket),
    field(
      's3',
      'prefix',
      'Key prefix',
      s3Prefix,
      'Prepended to object keys like a folder (e.g. xnotes/); leave empty to store at the bucket root.',
    ),
    field('s3', 'accessKey', 'Access key', s3AccessKey),
    field('s3', 'secretKey', 'Secret key', s3SecretKey),
    labeled(
      'Path-style URLs (self-hosted endpoints)',
      s3PathStyle,
      el('span', 'field-error'),
      'On sends https://endpoint/bucket/key, off sends https://bucket.endpoint/key. ' +
        'S3-compatible stores (Backblaze B2, MinIO) often need on; AWS S3 prefers off.',
    ),
    labeled(
      'Provider lacks conditional writes (e.g. Backblaze B2)',
      s3ForceHead,
      el('span', 'field-error'),
    ),
  );

  const intervalInput = el('input', 'sync-interval');
  intervalInput.type = 'number';
  intervalInput.min = '1';
  intervalInput.value = '5';

  const encryptionToggle = el('input', 'encryption-toggle');
  encryptionToggle.type = 'checkbox';
  const passphraseInput = el('input', 'passphrase-input');
  passphraseInput.type = 'password';
  passphraseInput.autocomplete = 'new-password';

  const messageArea = el('div', 'settings-message');
  const testResult = el('div', 'settings-test-result');
  const testBtn = el('button', undefined, 'Test connection');
  testBtn.type = 'button';
  const saveBtn = el('button', undefined, 'Save');
  saveBtn.type = 'button';

  const syncOnly = el('div', 'sync-only');
  syncOnly.append(
    labeled('Sync interval (minutes)', intervalInput, el('span', 'field-error')),
    labeled('Encrypt notes before sync', encryptionToggle, el('span', 'field-error')),
    labeled('Passphrase', passphraseInput, el('span', 'field-error')),
    el(
      'p',
      'passphrase-note',
      'The passphrase is kept in memory only and must be re-entered after a browser restart. To change it, enter a new one and save — the next sync re-encrypts your notes.',
    ),
    testBtn,
    testResult,
  );

  const footer = el('footer', 'settings-footer');
  footer.append(
    'crafted by Arda Kılıçdağı · ',
    externalLink('Website', 'https://arda.pw'),
    ' · ',
    externalLink('X', 'https://x.com/ardadev'),
    ' · ',
    externalLink('Source code', 'https://github.com/Ardakilic/xnotes'),
  );

  root.append(
    labeled('Sync backend', backendSelect, el('span', 'field-error')),
    webdavFields,
    s3Fields,
    syncOnly,
    saveBtn,
    messageArea,
    footer,
  );

  const allControls: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [
    backendSelect,
    webdavEndpoint,
    webdavUsername,
    webdavPassword,
    webdavPath,
    s3Endpoint,
    s3Region,
    s3Bucket,
    s3Prefix,
    s3AccessKey,
    s3SecretKey,
    s3PathStyle,
    s3ForceHead,
    intervalInput,
    encryptionToggle,
    passphraseInput,
    testBtn,
    saveBtn,
  ];
  allControls.forEach((c) => (c.disabled = true));

  function syncVisibility(): void {
    webdavFields.hidden = backendSelect.value !== 'webdav';
    s3Fields.hidden = backendSelect.value !== 's3';
    syncOnly.hidden = backendSelect.value === 'none';
  }

  backendSelect.addEventListener('change', syncVisibility);

  function readForm(): BackendSettings | null {
    if (backendSelect.value === 'webdav') {
      const settings: WebdavSettings = {
        backend: 'webdav',
        endpoint: webdavEndpoint.value.trim(),
        username: webdavUsername.value,
        password: webdavPassword.value,
        path: webdavPath.value.trim(),
      };
      return settings;
    }
    if (backendSelect.value === 's3') {
      const settings: S3Settings = {
        backend: 's3',
        endpoint: s3Endpoint.value.trim(),
        region: s3Region.value.trim(),
        bucket: s3Bucket.value.trim(),
        prefix: s3Prefix.value.trim(),
        accessKey: s3AccessKey.value,
        secretKey: s3SecretKey.value,
        pathStyle: s3PathStyle.checked,
        forceHeadFallback: s3ForceHead.checked,
      };
      return settings;
    }
    return null;
  }

  function readInterval(): number {
    const parsed = Number(intervalInput.value);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.floor(parsed);
  }

  function showValidation(result: ValidationResult, backend: string): void {
    for (const slot of errorSlots.values()) slot.textContent = '';
    for (const [key, message] of Object.entries(result.errors)) {
      const slot = errorSlots.get(`${backend}:${key}`);
      if (slot !== undefined) slot.textContent = message;
    }
  }

  function showMessage(text: string, kind: 'info' | 'error' | 'warning'): void {
    messageArea.textContent = text;
    messageArea.className = `settings-message settings-${kind}`;
  }

  function showTestResult(text: string, ok: boolean): void {
    testResult.textContent = text;
    testResult.className = ok
      ? 'settings-test-result settings-info'
      : 'settings-test-result settings-error';
  }

  async function requestOriginPermission(endpoint: string): Promise<boolean> {
    const pattern = endpointPermissionPattern(endpoint);
    if (pattern === null) return false;
    try {
      return await browser.permissions.request({ origins: [pattern] });
    } catch {
      return false;
    }
  }

  testBtn.addEventListener('click', () => {
    void (async () => {
      const backend = readForm();
      if (backend === null) {
        showTestResult('Choose a backend type first.', false);
        return;
      }
      const validation = validateBackend(backend);
      showValidation(validation, backend.backend);
      if (!validation.ok) {
        showTestResult('Fix the highlighted fields first.', false);
        return;
      }
      if (!(await requestOriginPermission(backend.endpoint))) {
        showTestResult(
          'Host permission denied — cannot test without access to the endpoint.',
          false,
        );
        return;
      }
      const adapter =
        backend.backend === 'webdav' ? new WebdavAdapter(backend) : new S3Adapter(backend);
      try {
        await adapter.probe();
        showTestResult('Connection OK.', true);
      } catch (error) {
        showTestResult(
          error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          false,
        );
      }
    })();
  });

  saveBtn.addEventListener('click', () => {
    void (async () => {
      const backend = readForm();
      let warningText = '';
      if (backend !== null) {
        const validation = validateBackend(backend);
        showValidation(validation, backend.backend);
        if (!validation.ok) {
          showMessage('Save blocked — fix the highlighted fields.', 'error');
          return;
        }
        if (!(await requestOriginPermission(backend.endpoint))) {
          showMessage(
            'Host permission denied. The backend was NOT activated — xNotes needs access to the sync endpoint to reach it.',
            'error',
          );
          return;
        }
        warningText = validation.warnings.join(' ');
      } else {
        for (const slot of errorSlots.values()) slot.textContent = '';
      }
      await saveSettings({
        backend,
        syncIntervalMinutes: readInterval(),
        encryptionEnabled: encryptionToggle.checked,
      });
      if (encryptionToggle.checked && passphraseInput.value !== '') {
        await sendBackground({ type: 'set-passphrase', passphrase: passphraseInput.value });
      }
      // ponytail: also sent when switching to "none" so the background re-reads settings and stops scheduling
      await sendBackground({ type: 'backend-activated' });
      if (encryptionToggle.checked !== initialEncryptionEnabled || passphraseInput.value !== '') {
        await sendBackground({ type: 'encryption-changed' });
      }
      passphraseInput.value = '';
      const base = backend === null ? 'Saved — local-only mode.' : 'Saved.';
      showMessage(
        warningText === '' ? base : `${base} ${warningText}`,
        warningText === '' ? 'info' : 'warning',
      );
    })();
  });

  void (async () => {
    const settings = await getSettings();
    const backend = settings.backend;
    if (backend !== null) {
      backendSelect.value = backend.backend;
      if (backend.backend === 'webdav') {
        webdavEndpoint.value = backend.endpoint;
        webdavUsername.value = backend.username;
        webdavPassword.value = backend.password;
        webdavPath.value = backend.path;
      } else {
        s3Endpoint.value = backend.endpoint;
        s3Region.value = backend.region;
        s3Bucket.value = backend.bucket;
        s3Prefix.value = backend.prefix;
        s3AccessKey.value = backend.accessKey;
        s3SecretKey.value = backend.secretKey;
        s3PathStyle.checked = backend.pathStyle;
        s3ForceHead.checked = backend.forceHeadFallback;
      }
    }
    intervalInput.value = String(settings.syncIntervalMinutes);
    encryptionToggle.checked = settings.encryptionEnabled;
    initialEncryptionEnabled = settings.encryptionEnabled;
    syncVisibility();
    allControls.forEach((c) => (c.disabled = false));
  })();
}
