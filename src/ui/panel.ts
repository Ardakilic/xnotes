import { COLOR_KEYS, COLOR_LABELS, type ColorKey } from '../core/colors';
import type { NoteRecord } from '../core/types';

export interface PanelHooks {
  loadNote(): Promise<NoteRecord | null>;
  save(text: string, color: ColorKey | null): Promise<void>;
  remove(): Promise<void>;
  openManager(): void;
}

export interface Panel {
  root: HTMLElement;
  destroy(): void;
  refresh(note: NoteRecord | null): void;
  isEditing(): boolean;
}

type Mode = 'empty' | 'view' | 'edit';

export function createPanel(handle: string, hooks: PanelHooks): Panel {
  const root = document.createElement('div');
  root.className = 'xn-panel';
  root.setAttribute('aria-label', `xNotes panel for @${handle}`);

  const title = document.createElement('div');
  title.className = 'xn-panel-title';
  title.textContent = `@${handle}`;

  const body = document.createElement('div');
  body.className = 'xn-panel-body';

  root.append(title, body);

  let mode: Mode = 'empty';
  let disposed = false;

  function clearAccent(): void {
    for (const key of COLOR_KEYS) root.classList.remove(`xn-accent-${key}`);
  }

  function managerLink(): HTMLAnchorElement {
    const link = document.createElement('a');
    link.className = 'xn-manager';
    link.href = '#';
    link.textContent = 'All notes';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      hooks.openManager();
    });
    return link;
  }

  function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function renderEmpty(): void {
    mode = 'empty';
    clearAccent();
    body.replaceChildren(
      button('Add note', 'xn-add', () => renderEdit(null)),
      managerLink(),
    );
  }

  function renderView(note: NoteRecord): void {
    mode = 'view';
    clearAccent();
    if (note.color !== null) root.classList.add(`xn-accent-${note.color}`);
    const text = document.createElement('div');
    text.className = 'xn-note-text';
    text.textContent = note.text;
    const actions = document.createElement('div');
    actions.className = 'xn-actions';
    actions.append(
      button('Edit', 'xn-edit', () => renderEdit(note)),
      managerLink(),
    );
    body.replaceChildren(text, actions);
  }

  function renderEdit(note: NoteRecord | null): void {
    mode = 'edit';
    clearAccent();

    const editor = document.createElement('textarea');
    editor.rows = 3;
    editor.className = 'xn-editor';
    editor.value = note === null ? '' : note.text;
    editor.setAttribute('aria-label', `Note for @${handle}`);

    let selected: ColorKey | null = note === null ? null : note.color;

    const swatches = document.createElement('div');
    swatches.className = 'xn-swatches';
    const swatchButtons: Array<{ key: ColorKey | null; el: HTMLButtonElement }> = [];

    function updateSwatches(): void {
      for (const swatch of swatchButtons) {
        swatch.el.setAttribute('aria-pressed', String(swatch.key === selected));
      }
    }

    function addSwatch(key: ColorKey | null): void {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = key === null ? 'xn-swatch xn-swatch-none' : `xn-swatch xn-accent-${key}`;
      el.title = key === null ? 'None' : COLOR_LABELS[key];
      el.setAttribute('aria-label', el.title);
      el.addEventListener('click', () => {
        selected = key;
        updateSwatches();
      });
      swatchButtons.push({ key, el });
      swatches.append(el);
    }

    for (const key of COLOR_KEYS) addSwatch(key);
    addSwatch(null);
    updateSwatches();

    async function doSave(): Promise<void> {
      const text = editor.value;
      const color = selected;
      await hooks.save(text, color);
      if (disposed) return;
      if (text.trim() === '') {
        renderEmpty();
        return;
      }
      const now = Date.now();
      renderView({
        handle,
        handleLower: handle.toLowerCase(),
        text,
        color,
        createdAt: note === null ? now : note.createdAt,
        updatedAt: now,
      });
    }

    editor.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      void doSave();
    });

    const actions = document.createElement('div');
    actions.className = 'xn-actions';
    actions.append(
      button('Save', 'xn-save', () => void doSave()),
      button('Cancel', 'xn-cancel', () => {
        if (note === null) renderEmpty();
        else renderView(note);
      }),
    );
    if (note !== null) {
      actions.append(
        button('Delete', 'xn-delete', () => {
          void hooks.remove().then(() => {
            if (!disposed) renderEmpty();
          });
        }),
      );
    }

    body.replaceChildren(editor, swatches, actions);
  }

  function refresh(note: NoteRecord | null): void {
    if (disposed || mode === 'edit') return;
    if (note === null) renderEmpty();
    else renderView(note);
  }

  renderEmpty();
  void hooks.loadNote().then((note) => {
    if (disposed || mode === 'edit') return;
    if (note === null) renderEmpty();
    else renderView(note);
  });

  return {
    root,
    destroy(): void {
      disposed = true;
      body.replaceChildren();
    },
    refresh,
    isEditing: () => mode === 'edit',
  };
}
