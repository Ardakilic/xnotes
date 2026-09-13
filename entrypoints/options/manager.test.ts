// @vitest-environment happy-dom
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAliases, recordObservation } from '../../src/core/aliases';
import { parseImportFile } from '../../src/core/import-export';
import {
  getAliases,
  getStore,
  renameNote,
  saveAliases,
  saveStore,
  toStoreV2,
  upsertNote,
} from '../../src/core/storage';
import type { ColorKey } from '../../src/core/colors';
import type { NoteRecord, StoreV2 } from '../../src/core/types';
import { buildExport, chooseImportAction, mountManager } from './manager';

function makeNote(
  handle: string,
  text: string,
  color: ColorKey | null,
  updatedAt: number,
  userId?: string,
): NoteRecord {
  const note: NoteRecord = {
    handle,
    handleLower: handle.toLowerCase(),
    text,
    color,
    createdAt: 1,
    updatedAt,
  };
  if (userId !== undefined) note.userId = userId;
  return note;
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

async function mountWithStore(store: StoreV2): Promise<HTMLElement> {
  await saveStore(store);
  const root = document.createElement('div');
  document.body.append(root);
  mountManager(root);
  await vi.waitFor(() => {
    expect(root.querySelectorAll('.note-row, .note-card').length).toBe(
      Object.keys(store.notes).length,
    );
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

function stubPrompt(answer: string | null): void {
  Object.defineProperty(window, 'prompt', {
    value: () => answer,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, 'confirm');
  Reflect.deleteProperty(window, 'alert');
  Reflect.deleteProperty(window, 'prompt');
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

  it('filters by user ID and advertises it in the search placeholder', async () => {
    const root = await mount([
      makeNote('jack', 'hello', null, 100, '12345'),
      makeNote('alice', 'world', null, 200, '67890'),
      makeNote('carol', 'plain', null, 300),
    ]);
    const search = root.querySelector<HTMLInputElement>('.manager-search');
    expect(search).not.toBeNull();
    if (search === null) return;
    expect(search.placeholder).toBe('Search by profile, note text, or user ID');
    search.value = '234';
    search.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.note-row')).toHaveLength(1);
    });
    expect(root.textContent).toContain('@jack');
    expect(root.textContent).not.toContain('@alice');
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

  it('alerts and keeps the edit form when the save write fails', async () => {
    const alerts = stubAlert();
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(() => {
      throw new Error('QUOTA_BYTES quota exceeded');
    });
    button(root, 'Edit').click();
    await vi.waitFor(() => {
      expect(root.querySelector('textarea.edit-text')).not.toBeNull();
    });
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    if (textarea === null) return;
    textarea.value = 'doomed edit';
    button(root, 'Save').click();
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('Could not save'))).toBe(true);
    });
    const survivor = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    expect(survivor?.value).toBe('doomed edit');
    spy.mockRestore();
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

describe('user ID display', () => {
  it('shows the user ID in a table column with an em-dash fallback', async () => {
    const root = await mount([
      makeNote('jack', 'hello', null, 100, '123'),
      makeNote('alice', 'world', null, 200),
    ]);
    expect(root.querySelector('.notes-table thead')?.textContent).toContain('User ID');
    expect(rowWith(root, '@jack').querySelector('td.note-userid')?.textContent).toBe('123');
    expect(rowWith(root, '@alice').querySelector('td.note-userid')?.textContent).toBe('—');
  });

  it('shows the user ID in cards with an em-dash fallback', async () => {
    const root = await mount([
      makeNote('jack', 'hello', null, 100, '123'),
      makeNote('alice', 'world', null, 200),
    ]);
    button(root, 'Cards').click();
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.note-card')).toHaveLength(2);
    });
    const cards = [...root.querySelectorAll<HTMLElement>('.note-card')];
    const jack = cards.find((c) => c.textContent?.includes('@jack'));
    const alice = cards.find((c) => c.textContent?.includes('@alice'));
    expect(jack?.querySelector('.note-userid')?.textContent).toContain('123');
    expect(alice?.querySelector('.note-userid')?.textContent).toContain('—');
  });
});

describe('user ID edit', () => {
  async function openEdit(root: HTMLElement): Promise<HTMLInputElement> {
    button(root, 'Edit').click();
    await vi.waitFor(() => {
      expect(root.querySelector('input.edit-userid')).not.toBeNull();
    });
    const input = root.querySelector<HTMLInputElement>('input.edit-userid');
    if (input === null) throw new Error('user ID input not found');
    return input;
  }

  it('prefills the current user ID and persists a new one through Save', async () => {
    const root = await mount([makeNote('jack', 'hello', null, 100, '123')]);
    const input = await openEdit(root);
    expect(input.value).toBe('123');
    input.value = '456';
    button(root, 'Save').click();
    await vi.waitFor(async () => {
      expect((await getStore()).notes['jack']?.userId).toBe('456');
    });
  });

  it('clears the user ID when the field is emptied', async () => {
    const root = await mount([makeNote('jack', 'hello', null, 100, '123')]);
    const input = await openEdit(root);
    input.value = '';
    button(root, 'Save').click();
    await vi.waitFor(async () => {
      expect((await getStore()).notes['jack']?.userId).toBeUndefined();
    });
  });

  it('rejects a non-digits user ID without saving', async () => {
    const alerts = stubAlert();
    const root = await mount([makeNote('jack', 'hello', null, 100, '123')]);
    const input = await openEdit(root);
    input.value = 'abc';
    button(root, 'Save').click();
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('user ID'))).toBe(true);
    });
    expect((await getStore()).notes['jack']?.userId).toBe('123');
    expect(root.querySelector('textarea.edit-text')).not.toBeNull();
  });
});

describe('handle edit', () => {
  async function openRowEdit(root: HTMLElement, label: string): Promise<void> {
    button(rowWith(root, label), 'Edit').click();
    await vi.waitFor(() => {
      expect(root.querySelector('input.edit-handle')).not.toBeNull();
    });
  }

  function handleInput(root: ParentNode): HTMLInputElement {
    const input = root.querySelector<HTMLInputElement>('input.edit-handle');
    if (input === null) throw new Error('handle input not found');
    return input;
  }

  it('prefills the current handle', async () => {
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    await openRowEdit(root, '@jack');
    expect(handleInput(root).value).toBe('jack');
  });

  it('renames the note carrying text/color/createdAt, resolving identity from the target alias', async () => {
    const root = await mount([{ ...makeNote('jack', 'hello', 'red', 200), userId: '123' }]);
    await saveAliases(recordObservation(emptyAliases(), 'bobby', '123', 50));
    await openRowEdit(root, '@jack');
    handleInput(root).value = 'bobby';
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    if (textarea === null) throw new Error('textarea not found');
    textarea.value = 'edited through rename';
    button(root, 'Save').click();
    await vi.waitFor(async () => {
      expect((await getStore()).notes['bobby']?.text).toBe('edited through rename');
    });
    const store = await getStore();
    expect(store.notes['jack']).toBeUndefined();
    expect(store.tombstones['jack']).toBeDefined();
    expect(store.notes['bobby']).toMatchObject({
      handle: 'bobby',
      text: 'edited through rename',
      color: 'red',
      userId: '123',
      createdAt: 1,
    });
    await vi.waitFor(() => {
      expect(root.querySelector('textarea.edit-text')).toBeNull();
    });
    expect(root.textContent).toContain('@bobby');
  });

  it('rename ignores the stale displayed user ID so the next visit re-learns the new owner', async () => {
    const root = await mount([
      { ...makeNote('oldhandle', 'moved note', null, 100), userId: '111' },
    ]);
    await openRowEdit(root, '@oldhandle');
    handleInput(root).value = 'newhandle';
    const userid = root.querySelector<HTMLInputElement>('input.edit-userid');
    if (userid === null) throw new Error('user ID input not found');
    expect(userid.value).toBe('111');
    button(root, 'Save').click();
    await vi.waitFor(async () => {
      expect((await getStore()).notes['newhandle']).toBeDefined();
    });
    expect((await getStore()).notes['newhandle']?.userId).toBeUndefined();
  });

  it('rejects an invalid handle without saving', async () => {
    const alerts = stubAlert();
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    await openRowEdit(root, '@jack');
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set');
    handleInput(root).value = 'bad handle!';
    button(root, 'Save').click();
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('not valid'))).toBe(true);
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await getStore()).notes['jack']?.text).toBe('hello');
    expect(root.querySelector('textarea.edit-text')).not.toBeNull();
  });

  it('refuses a duplicate handle case-insensitively without writing', async () => {
    const alerts = stubAlert();
    const root = await mount([
      makeNote('jack', 'hello', null, 100),
      makeNote('alice', 'world', null, 200),
    ]);
    await openRowEdit(root, '@jack');
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set');
    handleInput(root).value = 'ALICE';
    button(root, 'Save').click();
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('already has a note'))).toBe(true);
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    const store = await getStore();
    expect(store.notes['jack']?.text).toBe('hello');
    expect(store.notes['alice']?.text).toBe('world');
    expect(store.tombstones['jack']).toBeUndefined();
    expect(root.querySelector('textarea.edit-text')).not.toBeNull();
  });

  it('refuses a duplicate user ID without writing', async () => {
    const alerts = stubAlert();
    const root = await mount([
      { ...makeNote('jack', 'hello', null, 100), userId: '111' },
      { ...makeNote('alice', 'world', null, 200), userId: '222' },
    ]);
    await openRowEdit(root, '@jack');
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set');
    const userid = root.querySelector<HTMLInputElement>('input.edit-userid');
    if (userid === null) throw new Error('user ID input not found');
    userid.value = '222';
    button(root, 'Save').click();
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('already used'))).toBe(true);
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect((await getStore()).notes['jack']?.userId).toBe('111');
    expect(root.querySelector('textarea.edit-text')).not.toBeNull();
  });

  it('saves when handle and user ID are unchanged (self excluded)', async () => {
    const root = await mount([{ ...makeNote('jack', 'hello', null, 100), userId: '123' }]);
    await openRowEdit(root, '@jack');
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    if (textarea === null) throw new Error('textarea not found');
    textarea.value = 'same handle, new text';
    button(root, 'Save').click();
    await vi.waitFor(async () => {
      expect((await getStore()).notes['jack']?.text).toBe('same handle, new text');
    });
    expect((await getStore()).notes['jack']?.userId).toBe('123');
    await vi.waitFor(() => {
      expect(root.querySelector('textarea.edit-text')).toBeNull();
    });
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

  it('keeps open editors and drafts when a delete write fails', async () => {
    stubConfirm([true]);
    const alerts = stubAlert();
    const root = await mount([
      makeNote('jack', 'hello', null, 100),
      makeNote('bob', 'world', null, 200),
    ]);
    button(rowWith(root, '@jack'), 'Edit').click();
    await vi.waitFor(() => {
      expect(root.querySelector('textarea.edit-text')).not.toBeNull();
    });
    const textarea = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    if (textarea === null) return;
    textarea.value = 'unsaved draft';
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(() => {
      throw new Error('QUOTA_BYTES quota exceeded');
    });
    button(rowWith(root, '@bob'), 'Delete').click();
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('Could not delete'))).toBe(true);
    });
    spy.mockRestore();
    const survivor = root.querySelector<HTMLTextAreaElement>('textarea.edit-text');
    expect(survivor?.value).toBe('unsaved draft');
    expect((await getStore()).notes['bob']?.text).toBe('world');
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
  it('names the file xnotes-backup-YYYYMMDD.json and serializes store plus aliases', () => {
    const store = storeWith([makeNote('jack', 'hello', 'teal', 100)]);
    const aliases = recordObservation(emptyAliases(), 'oldhandle', '123', 100);
    const { filename, json } = buildExport(store, aliases);
    expect(filename).toMatch(/^xnotes-backup-\d{8}\.json$/);
    const parsed = JSON.parse(json);
    expect(toStoreV2(parsed)).toEqual(store);
    expect(parseImportFile(json)?.aliases).toEqual({
      oldhandle: { userId: '123', observedAt: 100 },
    });
  });
});

describe('import', () => {
  const backup = storeWith([makeNote('alice', 'from backup', 'red', 500)]);
  const backupAliases = recordObservation(emptyAliases(), 'oldhandle', '123', 100);

  it('chooseImportAction rejects invalid files and honors the choice', () => {
    expect(chooseImportAction(null, 'merge')).toEqual({ kind: 'invalid' });
    expect(chooseImportAction({ store: backup, aliases: backupAliases }, 'abort')).toEqual({
      kind: 'abort',
    });
    expect(chooseImportAction({ store: backup, aliases: backupAliases }, 'merge')).toEqual({
      kind: 'apply',
      mode: 'merge',
      store: backup,
      aliases: backupAliases,
    });
    expect(chooseImportAction({ store: backup, aliases: backupAliases }, 'replace')).toEqual({
      kind: 'apply',
      mode: 'replace',
      store: backup,
      aliases: backupAliases,
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

  it('alerts and leaves the store untouched when the import write fails', async () => {
    stubConfirm([true]);
    const alerts = stubAlert();
    const root = await mount([makeNote('jack', 'local', null, 100)]);
    const spy = vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(() => {
      throw new Error('QUOTA_BYTES quota exceeded');
    });
    await importFile(root, JSON.stringify(backup));
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('Could not import'))).toBe(true);
    });
    spy.mockRestore();
    expect(Object.keys((await getStore()).notes)).toEqual(['jack']);
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

  it('preserves the formerly hint across export into a fresh install', async () => {
    await saveStore(storeWith([{ ...makeNote('oldhandle', 'moved', 'teal', 100), userId: '123' }]));
    await saveAliases(recordObservation(emptyAliases(), 'oldhandle', '123', 100));
    await renameNote('oldhandle', 'newhandle', 'moved', 'teal');
    const store = await getStore();
    const aliases = (await getAliases()).aliases;
    const { json } = buildExport(store, aliases);
    fakeBrowser.reset();
    stubConfirm([true]);
    const root = document.createElement('div');
    document.body.append(root);
    mountManager(root);
    await importFile(root, json);
    await vi.waitFor(() => {
      expect(rowWith(root, '@newhandle').textContent).toContain('formerly @oldhandle');
    });
    expect((await getStore()).tombstones['oldhandle']).toBe(store.tombstones['oldhandle']);
    expect((await getAliases()).aliases).toEqual(aliases);
  });

  it('imports old backups without aliases and merges bindings by newer observation', async () => {
    stubConfirm([true, true]);
    await saveAliases(recordObservation(emptyAliases(), 'jack', '111', 500));
    const root = await mount([makeNote('jack', 'local', null, 100)]);
    await importFile(root, JSON.stringify(backup));
    await vi.waitFor(async () => {
      expect((await getStore()).notes['alice']).toBeDefined();
    });
    expect((await getAliases()).aliases).toEqual({ jack: { userId: '111', observedAt: 500 } });
    await importFile(root, buildExport(backup, backupAliases).json);
    await vi.waitFor(async () => {
      expect((await getAliases()).aliases).toEqual({
        jack: { userId: '111', observedAt: 500 },
        oldhandle: { userId: '123', observedAt: 100 },
      });
    });
  });
});

describe('orphaned notes', () => {
  async function seedOrphan(): Promise<HTMLElement> {
    const store = storeWith([
      { ...makeNote('victim', 'original owner text', 'red', 200), userId: '111' },
    ]);
    await saveAliases(recordObservation(emptyAliases(), 'victim', '222', 300));
    return mountWithStore(store);
  }

  it('lists a withheld note in the orphan section with handle and ID context', async () => {
    const root = await seedOrphan();
    const section = root.querySelector('.orphan-section');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('@victim');
    expect(section?.textContent).toContain('111');
    expect(section?.textContent).toContain('original owner text');
  });

  it('shows no orphan section when nothing is withheld', async () => {
    const root = await mount([makeNote('jack', 'hello', null, 100)]);
    expect(root.querySelector('.orphan-section')).toBeNull();
  });

  it('explicit delete removes the orphan and writes a tombstone', async () => {
    stubConfirm([true]);
    const root = await seedOrphan();
    const section = root.querySelector('.orphan-section');
    expect(section).not.toBeNull();
    if (section === null) return;
    button(section, 'Delete').click();
    await vi.waitFor(async () => {
      const store = await getStore();
      expect(store.notes['victim']).toBeUndefined();
      expect(store.tombstones['victim']).toBeDefined();
    });
  });

  it('explicit reassign binds the content to the chosen handle', async () => {
    stubPrompt('newhome');
    const root = await seedOrphan();
    const section = root.querySelector('.orphan-section');
    expect(section).not.toBeNull();
    if (section === null) return;
    button(section, 'Reassign').click();
    await vi.waitFor(async () => {
      const store = await getStore();
      expect(store.notes['newhome']?.text).toBe('original owner text');
      expect(store.notes['newhome']?.userId).toBeUndefined();
      expect(store.notes['victim']).toBeUndefined();
      expect(store.tombstones['victim']).toBeDefined();
    });
  });

  it('explicit reassign refuses a populated target without writing', async () => {
    stubPrompt('taken');
    const alerts = stubAlert();
    const store = storeWith([
      { ...makeNote('victim', 'original owner text', 'red', 200), userId: '111' },
      makeNote('taken', 'kept text', null, 300),
    ]);
    await saveAliases(recordObservation(emptyAliases(), 'victim', '222', 300));
    const root = await mountWithStore(store);
    const section = root.querySelector('.orphan-section');
    expect(section).not.toBeNull();
    if (section === null) return;
    button(section, 'Reassign').click();
    await vi.waitFor(() => {
      expect(alerts.some((m) => m.includes('already has a note'))).toBe(true);
    });
    const after = await getStore();
    expect(after.notes['taken']?.text).toBe('kept text');
    expect(after.notes['victim']?.text).toBe('original owner text');
    expect(after.tombstones['victim']).toBeUndefined();
  });
});

describe('formerly-known-handle display', () => {
  it('shows the former handle for renamed notes and hides it for direct notes', async () => {
    const store = storeWith([
      { ...makeNote('newhandle', 'moved', 'teal', 400), userId: '123' },
      makeNote('direct', 'plain', null, 300),
    ]);
    store.tombstones['oldhandle'] = 350;
    await saveAliases(
      recordObservation(
        recordObservation(emptyAliases(), 'oldhandle', '123', 100),
        'newhandle',
        '123',
        350,
      ),
    );
    const root = await mountWithStore(store);
    expect(rowWith(root, '@newhandle').textContent).toContain('formerly @oldhandle');
    expect(rowWith(root, '@direct').textContent).not.toContain('formerly @');
  });

  it('renders the table hint as a block below the handle link', async () => {
    const store = storeWith([{ ...makeNote('newhandle', 'moved', 'teal', 400), userId: '123' }]);
    store.tombstones['oldhandle'] = 350;
    await saveAliases(
      recordObservation(
        recordObservation(emptyAliases(), 'oldhandle', '123', 100),
        'newhandle',
        '123',
        350,
      ),
    );
    const root = await mountWithStore(store);
    const marker = rowWith(root, '@newhandle').querySelector('.note-formerly-block');
    expect(marker).not.toBeNull();
    expect(marker?.tagName).toBe('DIV');
    expect(marker?.textContent).toBe('formerly @oldhandle');
    expect(marker?.previousElementSibling?.classList.contains('handle-link')).toBe(true);
  });

  it('renders the card hint as a spaced inline element', async () => {
    const store = storeWith([{ ...makeNote('newhandle', 'moved', 'teal', 400), userId: '123' }]);
    store.tombstones['oldhandle'] = 350;
    await saveAliases(
      recordObservation(
        recordObservation(emptyAliases(), 'oldhandle', '123', 100),
        'newhandle',
        '123',
        350,
      ),
    );
    const root = await mountWithStore(store);
    button(root, 'Cards').click();
    await vi.waitFor(() => {
      expect(root.querySelectorAll('.note-card')).toHaveLength(1);
    });
    const marker = root.querySelector('.note-card .note-formerly');
    expect(marker).not.toBeNull();
    expect(marker?.tagName).toBe('SPAN');
    expect(marker?.textContent).toBe('formerly @oldhandle');
  });
});
