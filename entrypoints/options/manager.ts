import { COLOR_KEYS, COLOR_LABELS } from '../../src/core/colors';
import type { ColorKey } from '../../src/core/colors';
import { filterNotes } from '../../src/core/filters';
import type { ColorFilter } from '../../src/core/filters';
import { formatTimestamp } from '../../src/core/format';
import { exportStoreJson, parseImportFile } from '../../src/core/import-export';
import {
  deleteNote,
  getStore,
  getView,
  saveStore,
  saveView,
  subscribeToStoreChanges,
  upsertNote,
} from '../../src/core/storage';
import { merge } from '../../src/sync/merge';
import type { ManagerView, NoteRecord, StoreV2 } from '../../src/core/types';

export type ImportChoice = 'merge' | 'replace' | 'abort';

export type ImportAction =
  | { kind: 'invalid' }
  | { kind: 'abort' }
  | { kind: 'apply'; mode: 'merge' | 'replace'; store: StoreV2 };

export function chooseImportAction(parsed: StoreV2 | null, choice: ImportChoice): ImportAction {
  if (parsed === null) return { kind: 'invalid' };
  if (choice === 'abort') return { kind: 'abort' };
  return { kind: 'apply', mode: choice, store: parsed };
}

export function buildExport(store: StoreV2): { filename: string; json: string } {
  return exportStoreJson(store);
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

function profileLink(handle: string): HTMLAnchorElement {
  const link = el('a', 'handle-link', `@${handle}`);
  link.href = `https://x.com/${handle}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function colorChip(color: ColorKey | null, small: boolean): HTMLElement {
  const chip = el(
    'span',
    small ? `chip chip-small chip-${color ?? 'none'}` : `chip chip-${color ?? 'none'}`,
    color ?? 'none',
  );
  return chip;
}

function askImportChoice(): ImportChoice {
  if (confirm('Merge with existing notes? Click Cancel to REPLACE everything.')) return 'merge';
  if (confirm('REPLACE all existing notes with the backup? This cannot be undone.')) {
    return 'replace';
  }
  return 'abort';
}

export function mountManager(root: HTMLElement): void {
  let query = '';
  const colors = new Set<ColorFilter>();
  let view: ManagerView = 'table';
  let editing: { handleLower: string; el: HTMLElement } | null = null;

  const countLine = el('p', 'manager-count');
  const search = el('input', 'manager-search');
  search.type = 'search';
  search.placeholder = 'Search by profile or note text';
  const chipBar = el('div', 'chip-bar');
  const tableBtn = el('button', 'view-btn', 'Table');
  const cardsBtn = el('button', 'view-btn', 'Cards');
  const exportBtn = el('button', undefined, 'Export JSON');
  const importBtn = el('button', undefined, 'Import JSON');
  const fileInput = el('input', 'import-file');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  const listWrap = el('div', 'manager-list');

  const toolbar = el('div', 'manager-toolbar');
  toolbar.append(search, exportBtn, importBtn, fileInput);
  const viewRow = el('div', 'view-row');
  viewRow.append(chipBar, tableBtn, cardsBtn);
  root.append(toolbar, viewRow, countLine, listWrap);

  const chipColors: ColorFilter[] = [...COLOR_KEYS, 'none'];
  for (const color of chipColors) {
    const chip = el(
      'button',
      `chip chip-${color}`,
      color === 'none' ? 'None' : COLOR_LABELS[color],
    );
    chip.type = 'button';
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      if (colors.has(color)) {
        colors.delete(color);
        chip.setAttribute('aria-pressed', 'false');
      } else {
        colors.add(color);
        chip.setAttribute('aria-pressed', 'true');
      }
      void refresh();
    });
    chipBar.append(chip);
  }

  function syncViewButtons(): void {
    tableBtn.setAttribute('aria-pressed', String(view === 'table'));
    cardsBtn.setAttribute('aria-pressed', String(view === 'cards'));
  }

  tableBtn.type = 'button';
  cardsBtn.type = 'button';
  exportBtn.type = 'button';
  importBtn.type = 'button';
  tableBtn.addEventListener('click', () => {
    view = 'table';
    void saveView('table');
    syncViewButtons();
    void refresh();
  });
  cardsBtn.addEventListener('click', () => {
    view = 'cards';
    void saveView('cards');
    syncViewButtons();
    void refresh();
  });

  async function refresh(): Promise<void> {
    renderList(await getStore());
  }

  function renderList(store: StoreV2): void {
    const all = Object.values(store.notes);
    const notes = filterNotes(all, query, colors);
    const filtered = query.trim() !== '' || colors.size > 0;
    countLine.textContent = filtered
      ? `${notes.length} of ${all.length} notes`
      : `${all.length} notes`;
    if (all.length === 0) {
      const empty = el('p', 'empty-state', 'No notes yet — visit a profile on ');
      const link = el('a', undefined, 'X');
      link.href = 'https://x.com';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      empty.append(link, ' to start noting.');
      listWrap.replaceChildren(empty);
      return;
    }
    if (notes.length === 0) {
      listWrap.replaceChildren(el('p', 'empty-state', 'No notes match the current filters.'));
      return;
    }
    if (view === 'table') renderTable(notes);
    else renderCards(notes);
  }

  function editSlot(note: NoteRecord): HTMLElement | null {
    if (editing !== null && editing.handleLower === note.handleLower) return editing.el;
    return null;
  }

  function renderTable(notes: NoteRecord[]): void {
    const table = el('table', 'notes-table');
    const headRow = el('tr');
    for (const label of ['Profile', 'Note', 'Color', 'Updated', ''])
      headRow.append(el('th', undefined, label));
    const thead = el('thead');
    thead.append(headRow);
    const tbody = el('tbody');
    for (const note of notes) {
      const form = editSlot(note);
      if (form !== null) {
        const td = el('td');
        td.colSpan = 5;
        td.append(form);
        const tr = el('tr', 'edit-row');
        tr.append(td);
        tbody.append(tr);
        continue;
      }
      const tr = el('tr', 'note-row');
      const handleTd = el('td');
      handleTd.append(profileLink(note.handle));
      const textTd = el('td', 'note-text', note.text);
      const colorTd = el('td');
      colorTd.append(colorChip(note.color, true));
      const updatedTd = el('td', 'note-updated', formatTimestamp(note.updatedAt));
      const actionsTd = el('td', 'note-actions');
      actionsTd.append(buildEditButton(note), buildDeleteButton(note));
      tr.append(handleTd, textTd, colorTd, updatedTd, actionsTd);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    listWrap.replaceChildren(table);
  }

  function renderCards(notes: NoteRecord[]): void {
    const grid = el('div', 'notes-cards');
    for (const note of notes) {
      const form = editSlot(note);
      if (form !== null) {
        grid.append(form);
        continue;
      }
      const card = el('div', 'note-card');
      const head = el('div', 'note-card-head');
      head.append(
        profileLink(note.handle),
        el('span', 'note-updated', formatTimestamp(note.updatedAt)),
      );
      card.append(head, el('p', 'note-text', note.text), colorChip(note.color, true));
      const actions = el('div', 'note-actions');
      actions.append(buildEditButton(note), buildDeleteButton(note));
      card.append(actions);
      grid.append(card);
    }
    listWrap.replaceChildren(grid);
  }

  function buildEditButton(note: NoteRecord): HTMLButtonElement {
    const button = el('button', undefined, 'Edit');
    button.type = 'button';
    button.addEventListener('click', () => startEdit(note));
    return button;
  }

  function buildDeleteButton(note: NoteRecord): HTMLButtonElement {
    const button = el('button', 'danger', 'Delete');
    button.type = 'button';
    button.addEventListener('click', () => {
      void doDelete(note);
    });
    return button;
  }

  function startEdit(note: NoteRecord): void {
    const form = el('div', 'edit-form');
    const textarea = el('textarea', 'edit-text');
    textarea.value = note.text;
    let selected: ColorKey | null = note.color;
    const swatches = el('div', 'swatches');
    const options: (ColorKey | null)[] = [...COLOR_KEYS, null];
    for (const color of options) {
      const swatch = el('button', `chip chip-${color ?? 'none'}`);
      swatch.type = 'button';
      swatch.setAttribute('aria-label', color ?? 'No color');
      swatch.setAttribute('aria-pressed', String(color === selected));
      swatch.addEventListener('click', () => {
        selected = color;
        for (const other of swatches.children) other.setAttribute('aria-pressed', 'false');
        swatch.setAttribute('aria-pressed', 'true');
      });
      swatches.append(swatch);
    }
    const saveBtn = el('button', undefined, 'Save');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => {
      void upsertNote(note.handle, textarea.value, selected)
        .then(() => {
          editing = null;
          void refresh();
        })
        .catch(() => {
          alert('Could not save — the note was not written. Please try again.');
        });
    });
    const cancelBtn = el('button', undefined, 'Cancel');
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => {
      editing = null;
      void refresh();
    });
    form.append(textarea, swatches, saveBtn, cancelBtn);
    editing = { handleLower: note.handleLower, el: form };
    void refresh();
  }

  async function doDelete(note: NoteRecord): Promise<void> {
    if (!confirm(`Delete the note for @${note.handle}?`)) return;
    try {
      await deleteNote(note.handle);
    } catch {
      alert('Could not delete — the note was not removed. Please try again.');
      return;
    }
    if (editing !== null && editing.handleLower === note.handleLower) editing = null;
    await refresh();
  }

  async function doExport(): Promise<void> {
    const { filename, json } = buildExport(await getStore());
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = el('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(): Promise<void> {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file === undefined) return;
    const text = await file.text();
    const parsed = parseImportFile(text);
    const choice = parsed === null ? 'abort' : askImportChoice();
    const action = chooseImportAction(parsed, choice);
    if (action.kind === 'invalid') {
      alert('Not a valid xNotes backup file');
      return;
    }
    if (action.kind === 'abort') return;
    try {
      if (action.mode === 'merge') await saveStore(merge(await getStore(), action.store));
      else await saveStore(action.store);
    } catch {
      alert('Could not import — the store was not written. Please try again.');
      return;
    }
    await refresh();
  }

  search.addEventListener('input', () => {
    query = search.value;
    void refresh();
  });
  exportBtn.addEventListener('click', () => {
    void doExport();
  });
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void doImport();
  });

  subscribeToStoreChanges(() => {
    void refresh();
  });

  syncViewButtons();
  void (async () => {
    view = await getView();
    syncViewButtons();
    await refresh();
  })();
}
