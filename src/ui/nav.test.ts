// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNavToken, startNavWatcher } from './nav';

describe('createNavToken', () => {
  it('reports fresh until a newer token exists', () => {
    const first = createNavToken();
    expect(first.stale()).toBe(false);
    const second = createNavToken();
    expect(first.stale()).toBe(true);
    expect(second.stale()).toBe(false);
    const third = createNavToken();
    expect(second.stale()).toBe(true);
    expect(third.stale()).toBe(false);
  });

  it('assigns monotonically increasing ids', () => {
    const a = createNavToken();
    const b = createNavToken();
    expect(b.id).toBeGreaterThan(a.id);
  });
});

describe('startNavWatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires on href change via the interval backstop', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const stop = startNavWatcher(cb);
    history.pushState({}, '', '/interval-path');
    vi.advanceTimersByTime(800);
    expect(cb).toHaveBeenCalledTimes(1);
    const url = cb.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    expect(url?.pathname).toBe('/interval-path');
    vi.advanceTimersByTime(2000);
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
  });

  it('fires on popstate and hashchange listeners', () => {
    const cb = vi.fn();
    const stop = startNavWatcher(cb);
    history.pushState({}, '', '/popstate-path');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(cb).toHaveBeenCalledTimes(1);
    history.pushState({}, '', '/hash-path');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1]?.[0]?.pathname).toBe('/hash-path');
    stop();
  });

  it('does not fire while href is unchanged', () => {
    const cb = vi.fn();
    const stop = startNavWatcher(cb);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it('tears down completely: no callbacks after stop', () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    const stop = startNavWatcher(cb);
    stop();
    history.pushState({}, '', '/after-stop');
    vi.advanceTimersByTime(10000);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(cb).not.toHaveBeenCalled();
  });
});
