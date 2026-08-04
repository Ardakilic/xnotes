// @vitest-environment happy-dom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStore, saveStore, upsertNote } from '../../src/core/storage';
import type { ColorKey } from '../../src/core/colors';
import type { NoteRecord, StoreV2 } from '../../src/core/types';
import { buildExport, chooseImportAction, mountManager } from './manager';

function makeNote(
  handle: string,
  text: string,
  color: ColorKey | null,
  updatedAt: number,
): NoteRecord {
  return { handle, handleLower: handle.toLowerCase(), text, color, createdAt: 1, updatedAt };
}

function storeWith(notes: NoteRecord[]): StoreV2 {
  const store: StoreV2 = { schemaVersion: 2, notes: {}, tombstones: {} };
  for (const note of notes) store.notes[note.handleLower] = note;
  return store;
}

async function mount(notes: NoteRecord[]): Promise<HTMLElement> {
  await saveStore(storeWith(notes));
  const root = document.createElement('div');
  document.body.append(root);
  mountManager(root);
  await vi.waitFor(() => {
    expect(root.querySelectorAll('.note-row, .note-card').length).toBe(notes.length);
  });
  return root;
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  );
  if (found === undefined) throw new Error(`button "${label}" not found`);
  return found;
}

function rowWith(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('.note-row')].find((r) =>
    r.textContent?.includes(text),
  );
  if (found === undefined) throw new Error(`row containing "${text}" not found`);
  return found;
}

async function importFile(root: HTMLElement, content: string): Promise<void> {
  const input = root.querySelector<HTMLInputElement>('input.import-file');
  expect(input).not.toBeNull();
  if (input === null) return;
  const file = new File([content], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

// ponytail: happy-dom ships no window.confirm/alert, so tests define their own
function stubConfirm(queue: boolean[]): void {
  Object.defineProperty(window, 'confirm', {
    value: () => queue.shift() ?? false,
    configurable: true,
    writable: true,
  });
}

function stubAlert(): string[] {
  const alerts: string[] = [];
  Object.defineProperty(window, 'alert', {
    value: (message: string) => {
      alerts.push(message);
    },
    configurable: true,
    writable: true,
  });
  return alerts;
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, 'confirm');
  Reflect.deleteProperty(window, 'alert');
  vi.restoreAllMocks();
});

describe('manager list', () => {
  it('renders every note with a profile link opening in a new tab', async () => {
    const root = await mount([
      makeNote('jack', 'hello', 'teal', 100),
      makeNote('alice', 'world', null, 200),
    ]);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.handle-link')];
    expect(links).toHaveLength(2);
    const jack = links.find((l) => l.textContent === '@jack');
    expect(jack?.getAttribute('href')).toBe('https://x.com/jack');
    expect(jack?.target).toBe('_blank');
    expect(jack?.rel).toBe('noopener noreferrer');
    expect(root.querySelector('.manager-count')?.textContent).toBe('2 notes');
  });

  it('shows an empty state pointing to X when no notes are stored', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountManager(root);
    await vi.waitFor(() => {
      expect(root.querySelector('.empty-state')?.textContent).toContain('No notes yet');
    });
  });
});

describe('search and color filter wiring', () => {
  it('filters by search text and shows an "N of M" count', async () => {
    const root = await mount([
      makeNote('jack', 'hello', null, 100),
      makeNote('alice', 'world', null, 200),
    ]);
    const search = root.querySelector<HTMLInputElement>('.manager-search');
    expect(search).not.toBeNull();
    if (search === null) return;
    search.value = 'JACK';
    search.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.note-row')).toHaveLength(1);
    });
    expect(root.querySelector('.manager-count')?.textContent).toBe('1 of 2 notes');
    expect(root.textContent).toContain('@jack');
  });

  it('toggles color chips and widens with multi-select', async () => {
    const root = await mount([
      makeNote('jack', 'hello', 'red', 100),
      makeNote('alice', 'world', 'blue', 200),
      makeNote('carol', 'plain', null, 300),
    ]);
    const chipBar = root.querySelector('.chip-bar');
    expect(chipBar).not.toBeNull();
    if (chipBar === null) return;
    button(chipBar, 'Red').click();
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.note-row')).toHaveLength(1);
    });
    expect(button(chipBar, 'Red').getAttribute('aria-pressed')).toBe('true');
    button(chipBar, 'Blue').click();
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.note-row')).toHaveLength(2);
    });
  });
});

describe('inline edit', () => {
  it('persists edits through Save', async () => {
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    button(rowWith(root, '@jack'), 'Edit').click();
    await vi.waitFor(() => {
      expect(root.querySelector('textarea.edit-text')).not.toBeNull();
    });
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    expect(textarea).not.toBeNull();
    if (textarea === null) return;
    textarea.value = 'edited text';
    button(root, 'Save').click();
    await vi.waitFor(async () => {
      expect((await getStore()).notes['jack']?.text).toBe('edited text');
    });
  });

  it('keeps an in-progress edit when the store changes underneath', async () => {
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    button(root, 'Edit').click();
    await vi.waitFor(() => {
      expect(root.querySelector('textarea.edit-text')).not.toBeNull();
    });
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    expect(textarea).not.toBeNull();
    if (textarea === null) return;
    textarea.value = 'typing in progress';
    await upsertNote('bob', 'arrived via sync', null, 600);
    await vi.waitFor(() => {
      expect(root.textContent).toContain('arrived via sync');
    });
    const survivor = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    expect(survivor?.value).toBe('typing in progress');
  });
});

describe('delete', () => {
  it('deletes after confirmation and writes a tombstone', async () => {
    stubConfirm([true]);
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    button(root, 'Delete').click();
    await vi.waitFor(async () => {
      const store = await getStore();
      expect(store.notes['jack']).toBeUndefined();
      expect(store.tombstones['jack']).toBeDefined();
    });
  });

  it('aborts when the confirmation is declined', async () => {
    stubConfirm([]);
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    button(root, 'Delete').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await getStore()).notes['jack']).toBeDefined();
  });
});

describe('export', () => {
  it('names the file xnotes-backup-YYYYMMDD.json and serializes the store', () => {
    const store = storeWith([makeNote('jack', 'hello', 'teal', 100)]);
    const { filename, json } = buildExport(store);
    expect(filename).toMatch(/^xnotes-backup-\d{8}\.json$/);
    expect(JSON.parse(json) as unknown).toEqual(store);
  });
});

describe('import', () => {
  const backup = storeWith([makeNote('alice', 'from backup', 'red', 500)]);

  it('chooseImportAction rejects invalid files and honors the choice', () => {
    expect(chooseImportAction(null, 'merge')).toEqual({ kind: 'invalid' });
    expect(chooseImportAction(backup, 'abort')).toEqual({ kind: 'abort' });
    expect(chooseImportAction(backup, 'merge')).toEqual({
      kind: 'apply',
      mode: 'merge',
      store: backup,
    });
    expect(chooseImportAction(backup, 'replace')).toEqual({
      kind: 'apply',
      mode: 'replace',
      store: backup,
    });
  });

  it('merges the backup when the first confirm is accepted', async () => {
    stubConfirm([true]);
    const root = await mount([makeNote('jack', 'local', null, 100)]);
    await importFile(root, JSON.stringify(backup));
    await vi.waitFor(async () => {
      const store = await getStore();
      expect(store.notes['jack']).toBeDefined();
      expect(store.notes['alice']?.text).toBe('from backup');
    });
  });

  it('resolves same-handle import conflicts by timestamp in both directions', async () => {
    stubConfirm([true, true]);
    const root = await mount([makeNote('alice', 'local older', null, 100)]);
    await importFile(
      root,
      JSON.stringify(storeWith([makeNote('alice', 'backup newer', null, 900)])),
    );
    await vi.waitFor(async () => {
      expect((await getStore()).notes['alice']?.text).toBe('backup newer');
    });
    await importFile(
      root,
      JSON.stringify(storeWith([makeNote('alice', 'backup older', null, 50)])),
    );
    await vi.waitFor(async () => {
      expect((await getStore()).notes['alice']?.text).toBe('backup newer');
    });
  });

  it('replaces everything when merge is declined and replace confirmed', async () => {
    stubConfirm([false, true]);
    const root = await mount([makeNote('jack', 'local', null, 100)]);
    await importFile(root, JSON.stringify(backup));
    await vi.waitFor(async () => {
      const store = await getStore();
      expect(store.notes['jack']).toBeUndefined();
      expect(store.notes['alice']).toBeDefined();
    });
  });

  it('aborts when both confirms are declined', async () => {
    stubConfirm([]);
    const root = await mount([makeNote('jack', 'local', null, 100)]);
    await importFile(root, JSON.stringify(backup));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const store = await getStore();
    expect(Object.keys(store.notes)).toEqual(['jack']);
  });

  it('rejects invalid files with an alert and leaves the store untouched', async () => {
    const alerts = stubAlert();
    const root = await mount([makeNote('jack', 'local', null, 100)]);
    await importFile(root, 'this is not json');
    await vi.waitFor(() => {
      expect(alerts).toContain('Not a valid xNotes backup file');
    });
    expect(Object.keys((await getStore()).notes)).toEqual(['jack']);
  });
});
