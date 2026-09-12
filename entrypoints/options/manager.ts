import { COLOR_KEYS, COLOR_LABELS } from '../../src/core/colors';
import type { ColorKey } from '../../src/core/colors';
import { getAlias, lookupByUserId, type AliasStore } from '../../src/core/aliases';
import { filterNotes } from '../../src/core/filters';
import type { ColorFilter } from '../../src/core/filters';
import { formatTimestamp } from '../../src/core/format';
import { exportStoreJson, parseImportFile } from '../../src/core/import-export';
import {
  deleteNote,
  getAliases,
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

/**
 * A note is orphaned when its handle's recorded binding disagrees with the
 * note's own identity: both the alias and `note.userId` are known and
 * differ. Surfaces hijack-withheld notes; never auto-resolves.
 */
export function isOrphanNote(note: NoteRecord, aliases: AliasStore): boolean {
  if (note.userId === undefined) return false;
  const alias = getAlias(aliases, note.handleLower);
  return alias !== null && alias.userId !== note.userId;
}

/**
 * Formerly-known-handle display for a renamed note: other handles bound to
 * the note's user ID whose keys carry a tombstone (the rename source).
 * First sorted match wins; `null` when the note arrived directly.
 */
export function formerHandleFor(
  note: NoteRecord,
  aliases: AliasStore,
  tombstones: Record<string, number>,
): string | null {
  if (note.userId === undefined) return null;
  const others = lookupByUserId(aliases, note.userId)
    .filter((candidate) => candidate !== note.handleLower && tombstones[candidate] !== undefined)
    .sort();
  return others[0] ?? null;
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

  /** Reload store and aliases, then re-render. Aliases are local-only reads. */
  async function refresh(): Promise<void> {
    renderList(await getStore(), await getAliases());
  }

  /**
   * Render the main list (unchanged filter/sort; orphans stay listed there)
   * plus a separate orphan section when orphans exist. The orphan section
   * is unfiltered so withheld notes are never hidden by the search filter.
   */
  function renderList(store: StoreV2, aliases: AliasStore): void {
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
      appendOrphanSection(store, aliases);
      return;
    }
    if (view === 'table') renderTable(notes, store, aliases);
    else renderCards(notes, store, aliases);
    appendOrphanSection(store, aliases);
  }

  /** Append the orphan section when withheld notes exist; no-op otherwise. */
  function appendOrphanSection(store: StoreV2, aliases: AliasStore): void {
    const orphans = Object.values(store.notes)
      .filter((note) => isOrphanNote(note, aliases))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (orphans.length === 0) return;
    listWrap.append(buildOrphanSection(orphans));
  }

  /**
   * Build the orphan review section: each row shows the last-known handle,
   * the recorded user ID context, and explicit Delete/Reassign actions.
   * Never auto-resolves.
   */
  function buildOrphanSection(orphans: NoteRecord[]): HTMLElement {
    const section = el('section', 'orphan-section');
    section.append(el('h2', 'orphan-heading', 'Orphaned notes'));
    section.append(
      el(
        'p',
        'orphan-expl',
        'These notes were withheld from their profile because the handle now ' +
          'belongs to a different account. Delete or reassign them — nothing happens automatically.',
      ),
    );
    for (const note of orphans) {
      const row = el('div', 'orphan-row');
      row.append(profileLink(note.handle));
      row.append(el('span', 'orphan-id', `ID ${note.userId ?? 'unknown'}`));
      row.append(el('span', 'orphan-text', note.text));
      const actions = el('div', 'note-actions');
      actions.append(buildReassignButton(note), buildDeleteButton(note));
      row.append(actions);
      section.append(row);
    }
    return section;
  }

  /** Formerly-known-handle marker for a row, or `null` when direct. */
  function formerMarker(note: NoteRecord, store: StoreV2, aliases: AliasStore): HTMLElement | null {
    const former = formerHandleFor(note, aliases, store.tombstones);
    return former === null ? null : el('span', 'former-handle', `formerly @${former}`);
  }

  function editSlot(note: NoteRecord): HTMLElement | null {
    if (editing !== null && editing.handleLower === note.handleLower) return editing.el;
    return null;
  }

  /** Render the main table; renamed notes show their former handle. */
  function renderTable(notes: NoteRecord[], store: StoreV2, aliases: AliasStore): void {
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
      const marker = formerMarker(note, store, aliases);
      if (marker !== null) handleTd.append(marker);
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

  /** Render the main card grid; renamed notes show their former handle. */
  function renderCards(notes: NoteRecord[], store: StoreV2, aliases: AliasStore): void {
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
      const cardMarker = formerMarker(note, store, aliases);
      if (cardMarker !== null) head.append(cardMarker);
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

  function buildReassignButton(note: NoteRecord): HTMLButtonElement {
    const button = el('button', undefined, 'Reassign');
    button.type = 'button';
    button.addEventListener('click', () => {
      void doReassign(note);
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

  /**
   * Explicit orphan reassign: copy the orphan's text/color under the chosen
   * handle, then tombstone the orphan key so the entry resolves. Same-handle
   * choice is a no-op. Fail-soft with alerts like other manager actions.
   */
  async function doReassign(note: NoteRecord): Promise<void> {
    const answer = prompt(`Move note for @${note.handle} to which handle?`);
    if (answer === null) return;
    const target = answer.trim().replace(/^@/, '').trim();
    if (target === '') return;
    if (!/^[A-Za-z0-9_]{1,15}$/.test(target)) {
      alert('That handle is not valid.');
      return;
    }
    if (target.toLowerCase() === note.handleLower) return;
    try {
      await upsertNote(target, note.text, note.color);
      await deleteNote(note.handle);
    } catch {
      alert('Could not reassign — the store was not written. Please try again.');
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
