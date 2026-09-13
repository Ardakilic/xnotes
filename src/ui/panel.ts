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

/**
 * Optional display context for the panel. `formerHandle` names the
 * previously-known handle a renamed note was moved from, if any.
 */
export interface PanelOptions {
  formerHandle?: string | null;
}

type Mode = 'empty' | 'view' | 'edit';

/**
 * Create the profile note panel for `handle`. Withholding needs no panel
 * logic: a withheld note arrives as `null` from the hooks and renders the
 * empty state. When `options.formerHandle` is set, view mode shows a
 * formerly-known-handle hint under the title.
 */
export function createPanel(handle: string, hooks: PanelHooks, options?: PanelOptions): Panel {
  const formerHandle =
    options?.formerHandle !== undefined &&
    options.formerHandle !== null &&
    options.formerHandle !== '' &&
    options.formerHandle.toLowerCase() !== handle.toLowerCase()
      ? options.formerHandle
      : null;
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
  let revision = 0;
  let mutationInFlight = false;

  function clearAccent(): void {
    for (const key of COLOR_KEYS) root.classList.remove(`xn-accent-${key}`);
  }

  function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function managerButton(): HTMLButtonElement {
    return button('All notes', 'xn-manager', () => hooks.openManager());
  }

  function setMutationControlsEnabled(enabled: boolean): void {
    root
      .querySelectorAll<HTMLButtonElement>('button.xn-save, button.xn-cancel, button.xn-delete')
      .forEach((b) => {
        b.disabled = !enabled;
      });
  }

  function showError(message: string): void {
    root.querySelector('.xn-error')?.remove();
    const error = document.createElement('div');
    error.className = 'xn-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    body.append(error);
  }

  function renderEmpty(): void {
    mode = 'empty';
    clearAccent();
    const actions = document.createElement('div');
    actions.className = 'xn-actions';
    actions.append(
      button('Add note', 'xn-add', () => renderEdit(null)),
      managerButton(),
    );
    body.replaceChildren(actions);
  }

  /** Render view mode, prepending the formerly-known-handle hint when set. */
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
      managerButton(),
    );
    if (formerHandle === null) {
      body.replaceChildren(text, actions);
      return;
    }
    const hint = document.createElement('div');
    hint.className = 'xn-former-handle';
    hint.textContent = `Previously @${formerHandle}`;
    body.replaceChildren(hint, text, actions);
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
      if (mutationInFlight || disposed) return;
      const text = editor.value;
      const color = selected;
      mutationInFlight = true;
      setMutationControlsEnabled(false);
      try {
        await hooks.save(text, color);
        if (disposed) return;
        revision++;
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
      } catch {
        if (!disposed) showError('Could not save — the note was not written. Please try again.');
      } finally {
        mutationInFlight = false;
        if (!disposed) setMutationControlsEnabled(true);
      }
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
        if (mutationInFlight) return;
        if (note === null) renderEmpty();
        else renderView(note);
      }),
    );
    if (note !== null) {
      actions.append(
        button('Delete', 'xn-delete', () => {
          if (mutationInFlight || disposed) return;
          void (async () => {
            mutationInFlight = true;
            setMutationControlsEnabled(false);
            try {
              await hooks.remove();
              if (disposed) return;
              revision++;
              renderEmpty();
            } catch {
              if (!disposed)
                showError('Could not delete — the note was not removed. Please try again.');
            } finally {
              mutationInFlight = false;
              if (!disposed) setMutationControlsEnabled(true);
            }
          })();
        }),
      );
    }

    body.replaceChildren(editor, swatches, actions);
  }

  function refresh(note: NoteRecord | null): void {
    if (disposed || mode === 'edit') return;
    revision++;
    if (note === null) renderEmpty();
    else renderView(note);
  }

  renderEmpty();
  const loadRevision = revision;
  void hooks.loadNote().then((note) => {
    if (disposed || mode === 'edit' || revision !== loadRevision) return;
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
