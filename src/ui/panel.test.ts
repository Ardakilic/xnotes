// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import type { ColorKey } from '../core/colors';
import type { NoteRecord } from '../core/types';
import { createPanel } from './panel';

function makeNote(handle: string, text: string, color: ColorKey | null = null): NoteRecord {
  return { handle, handleLower: handle.toLowerCase(), text, color, createdAt: 100, updatedAt: 200 };
}

function makeHooks(note: NoteRecord | null = null) {
  return {
    loadNote: vi.fn(async (): Promise<NoteRecord | null> => note),
    save: vi.fn(async (): Promise<void> => {}),
    remove: vi.fn(async (): Promise<void> => {}),
    openManager: vi.fn(),
  };
}

function need<T extends Element>(el: T | null): T {
  if (el === null) throw new Error('expected element not found');
  return el;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function panelInEditMode(note: NoteRecord | null) {
  const hooks = makeHooks(note);
  const panel = createPanel('jack', hooks);
  await flush();
  if (note === null) {
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-add')).click();
  } else {
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-edit')).click();
  }
  return { hooks, panel };
}

describe('createPanel', () => {
  it('shows @handle, aria-label, and empty mode when no note exists', async () => {
    const hooks = makeHooks(null);
    const panel = createPanel('Jack', hooks);
    await flush();
    expect(hooks.loadNote).toHaveBeenCalledTimes(1);
    expect(panel.root.getAttribute('aria-label')).toBe('xNotes panel for @Jack');
    expect(panel.root.textContent).toContain('@Jack');
    expect(panel.root.querySelector('button.xn-add')).not.toBeNull();
    expect(panel.root.querySelector('button.xn-manager')).not.toBeNull();
    expect(panel.root.querySelector('textarea')).toBeNull();
    expect(panel.isEditing()).toBe(false);
  });

  it('renders empty-state actions as spaced pill buttons', async () => {
    const panel = createPanel('jack', makeHooks(null));
    await flush();
    const actions = need(panel.root.querySelector('.xn-actions'));
    expect(actions.querySelector('button.xn-add')).not.toBeNull();
    expect(actions.querySelector('button.xn-manager')).not.toBeNull();
  });

  it('loads an existing note into view mode with its accent color', async () => {
    const panel = createPanel('jack', makeHooks(makeNote('jack', 'hello\nworld', 'teal')));
    await flush();
    expect(panel.root.querySelector('.xn-note-text')?.textContent).toBe('hello\nworld');
    expect(panel.root.classList.contains('xn-accent-teal')).toBe(true);
    expect(panel.root.querySelector('button.xn-edit')).not.toBeNull();
    expect(panel.root.querySelector('textarea')).toBeNull();
  });

  it('transitions empty -> edit -> save -> view and persists via hooks.save', async () => {
    const hooks = makeHooks(null);
    const panel = createPanel('jack', hooks);
    await flush();
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-add')).click();
    expect(panel.isEditing()).toBe(true);
    const editor = need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor'));
    // ponytail: happy-dom returns rows as a string — assert the attribute
    expect(editor.getAttribute('rows')).toBe('3');
    expect(panel.root.querySelectorAll('button.xn-swatch').length).toBe(12);
    need(panel.root.querySelector<HTMLButtonElement>('button[title="Teal"]')).click();
    editor.value = 'hello\nworld';
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-save')).click();
    await flush();
    expect(hooks.save).toHaveBeenCalledTimes(1);
    expect(hooks.save).toHaveBeenCalledWith('hello\nworld', 'teal');
    expect(panel.isEditing()).toBe(false);
    expect(panel.root.querySelector('.xn-note-text')?.textContent).toBe('hello\nworld');
    expect(panel.root.classList.contains('xn-accent-teal')).toBe(true);
    expect(panel.root.querySelector('textarea')).toBeNull();
  });

  it('keeps edit mode and the draft when save fails, showing an error', async () => {
    const hooks = {
      ...makeHooks(null),
      save: vi.fn(async (): Promise<void> => {
        throw new Error('quota exceeded');
      }),
    };
    const panel = createPanel('jack', hooks);
    await flush();
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-add')).click();
    const editor = need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor'));
    editor.value = 'precious draft';
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-save')).click();
    await flush();
    expect(panel.isEditing()).toBe(true);
    const survivor = need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor'));
    expect(survivor.value).toBe('precious draft');
    expect(panel.root.querySelector('.xn-error')?.textContent).toContain('Could not save');
  });

  it('toggles swatch aria-pressed and can select none', async () => {
    const { panel } = await panelInEditMode(null);
    const teal = need(panel.root.querySelector<HTMLButtonElement>('button[title="Teal"]'));
    const none = need(panel.root.querySelector<HTMLButtonElement>('button[title="None"]'));
    expect(teal.getAttribute('aria-pressed')).toBe('false');
    expect(none.getAttribute('aria-pressed')).toBe('true');
    teal.click();
    expect(teal.getAttribute('aria-pressed')).toBe('true');
    expect(none.getAttribute('aria-pressed')).toBe('false');
    none.click();
    expect(teal.getAttribute('aria-pressed')).toBe('false');
    expect(none.getAttribute('aria-pressed')).toBe('true');
  });

  it('saves on Enter without Shift', async () => {
    const { hooks, panel } = await panelInEditMode(null);
    const editor = need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor'));
    editor.value = 'x';
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    await flush();
    expect(hooks.save).toHaveBeenCalledTimes(1);
    expect(hooks.save).toHaveBeenCalledWith('x', null);
    expect(panel.isEditing()).toBe(false);
  });

  it('does not save on Shift+Enter', async () => {
    const { hooks, panel } = await panelInEditMode(null);
    const editor = need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor'));
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      cancelable: true,
    });
    editor.dispatchEvent(event);
    await flush();
    expect(hooks.save).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(panel.isEditing()).toBe(true);
  });

  it('suppresses save while composing (isComposing)', async () => {
    const { hooks, panel } = await panelInEditMode(null);
    const editor = need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor'));
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, isComposing: true }),
    );
    await flush();
    expect(hooks.save).not.toHaveBeenCalled();
    expect(panel.isEditing()).toBe(true);
  });

  it('transitions view -> edit -> delete -> empty and calls hooks.remove', async () => {
    const hooks = makeHooks(makeNote('jack', 'doomed', 'red'));
    const panel = createPanel('jack', hooks);
    await flush();
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-edit')).click();
    expect(panel.root.querySelector('button.xn-delete')).not.toBeNull();
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-delete')).click();
    await flush();
    expect(hooks.remove).toHaveBeenCalledTimes(1);
    expect(panel.isEditing()).toBe(false);
    expect(panel.root.querySelector('button.xn-add')).not.toBeNull();
    expect(panel.root.querySelector('.xn-note-text')).toBeNull();
    expect(panel.root.querySelector('button.xn-delete')).toBeNull();
  });

  it('hides the Delete button when editing a new note', async () => {
    const { panel } = await panelInEditMode(null);
    expect(panel.root.querySelector('button.xn-delete')).toBeNull();
  });

  it('refresh while editing preserves the in-progress textarea content', async () => {
    const { panel } = await panelInEditMode(makeNote('jack', 'original', null));
    const editor = need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor'));
    editor.value = 'in progress';
    panel.refresh(makeNote('jack', 'external update', 'blue'));
    expect(panel.isEditing()).toBe(true);
    expect(need(panel.root.querySelector<HTMLTextAreaElement>('textarea.xn-editor')).value).toBe(
      'in progress',
    );
  });

  it('refresh while not editing updates the displayed note', async () => {
    const panel = createPanel('jack', makeHooks(makeNote('jack', 'v1', null)));
    await flush();
    expect(panel.root.querySelector('.xn-note-text')?.textContent).toBe('v1');
    panel.refresh(makeNote('jack', 'v2', 'green'));
    expect(panel.root.querySelector('.xn-note-text')?.textContent).toBe('v2');
    expect(panel.root.classList.contains('xn-accent-green')).toBe(true);
    panel.refresh(null);
    expect(panel.root.querySelector('button.xn-add')).not.toBeNull();
    expect(panel.root.querySelector('.xn-note-text')).toBeNull();
  });

  it('opens the manager via the All notes button', async () => {
    const hooks = makeHooks(null);
    const panel = createPanel('jack', hooks);
    await flush();
    need(panel.root.querySelector<HTMLButtonElement>('button.xn-manager')).click();
    expect(hooks.openManager).toHaveBeenCalledTimes(1);
  });

  it('destroy stops re-renders from pending hooks', async () => {
    let resolveLoad: ((note: NoteRecord | null) => void) | undefined;
    const hooks = {
      loadNote: vi.fn(
        () =>
          new Promise<NoteRecord | null>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
      save: vi.fn(async (): Promise<void> => {}),
      remove: vi.fn(async (): Promise<void> => {}),
      openManager: vi.fn(),
    };
    const panel = createPanel('jack', hooks);
    panel.destroy();
    if (resolveLoad === undefined) throw new Error('loadNote was not called');
    resolveLoad(makeNote('jack', 'late', null));
    await flush();
    expect(panel.root.querySelector('.xn-note-text')).toBeNull();
  });

  it('shows the formerly-known-handle hint in view mode after a rename', async () => {
    const panel = createPanel('newhandle', makeHooks(makeNote('newhandle', 'moved note', 'teal')), {
      formerHandle: 'oldhandle',
    });
    await flush();
    expect(panel.root.querySelector('.xn-note-text')?.textContent).toBe('moved note');
    expect(panel.root.querySelector('.xn-former-handle')?.textContent).toContain('oldhandle');
  });

  it('shows no hint without a rename', async () => {
    const panel = createPanel('jack', makeHooks(makeNote('jack', 'direct', null)));
    await flush();
    expect(panel.root.querySelector('.xn-former-handle')).toBeNull();
    const same = createPanel('jack', makeHooks(makeNote('jack', 'direct', null)), {
      formerHandle: 'JACK',
    });
    await flush();
    expect(same.root.querySelector('.xn-former-handle')).toBeNull();
  });

  it('renders the empty state when a withheld note arrives as null', async () => {
    const panel = createPanel('victim', makeHooks(null));
    await flush();
    expect(panel.root.querySelector('button.xn-add')).not.toBeNull();
    expect(panel.root.querySelector('.xn-note-text')).toBeNull();
    expect(panel.root.querySelector('textarea')).toBeNull();
  });
});
