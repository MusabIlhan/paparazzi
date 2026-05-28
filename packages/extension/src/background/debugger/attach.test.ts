import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attachedTabs, tabStates } from './state';
import { resolveTabWithDebugger } from './attach';

interface MockChrome {
  tabs: {
    get: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
  };
  debugger: {
    attach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
  };
}

function installChromeMock(): MockChrome {
  const mock: MockChrome = {
    tabs: {
      get: vi.fn(),
      query: vi.fn(),
    },
    debugger: {
      attach: vi.fn().mockResolvedValue(undefined),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    },
  };
  vi.stubGlobal('chrome', mock);
  return mock;
}

describe('resolveTabWithDebugger', () => {
  let chromeMock: MockChrome;

  beforeEach(() => {
    attachedTabs.clear();
    tabStates.clear();
    chromeMock = installChromeMock();
  });

  it('falls back to the active tab when tabId is omitted', async () => {
    chromeMock.tabs.query.mockResolvedValue([
      { id: 7, url: 'https://a.example', title: 'A' },
    ]);

    const tab = await resolveTabWithDebugger();

    expect(chromeMock.tabs.query).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
    expect(tab.id).toBe(7);
    expect(chromeMock.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');
    expect(attachedTabs.has(7)).toBe(true);
  });

  it('looks up a specific tab when tabId is provided', async () => {
    chromeMock.tabs.get.mockResolvedValue({
      id: 99,
      url: 'https://b.example',
      title: 'B',
    });

    const tab = await resolveTabWithDebugger(99);

    expect(chromeMock.tabs.get).toHaveBeenCalledWith(99);
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
    expect(tab.id).toBe(99);
    expect(attachedTabs.has(99)).toBe(true);
  });

  it('skips re-attaching when debugger is already attached', async () => {
    attachedTabs.add(99);
    chromeMock.tabs.get.mockResolvedValue({ id: 99, url: '', title: '' });

    await resolveTabWithDebugger(99);

    expect(chromeMock.debugger.attach).not.toHaveBeenCalled();
  });

  it('throws a helpful error for an invalid tabId', async () => {
    chromeMock.tabs.get.mockRejectedValue(new Error('No tab with id'));

    await expect(resolveTabWithDebugger(404)).rejects.toThrow(
      /Tab 404 not found.*list_tabs/i
    );
  });

  it('throws when no active tab exists and no tabId is given', async () => {
    chromeMock.tabs.query.mockResolvedValue([]);

    await expect(resolveTabWithDebugger()).rejects.toThrow('No active tab');
  });

  it('throws when the resolved tab has no id', async () => {
    chromeMock.tabs.get.mockResolvedValue({
      // intentionally missing `id` to exercise the "has no id" branch
      url: 'https://c.example',
      title: 'C',
    });

    await expect(resolveTabWithDebugger(77)).rejects.toThrow(/Tab 77 has no id/);
  });

  it('dedupes concurrent attaches for the same tab', async () => {
    let resolveAttach: () => void = () => undefined;
    const attachStarted = new Promise<void>((resolve) => {
      chromeMock.debugger.attach.mockImplementation(
        () =>
          new Promise<void>((res) => {
            resolveAttach = res;
            resolve();
          })
      );
    });

    chromeMock.tabs.get.mockResolvedValue({
      id: 42,
      url: 'https://d.example',
      title: 'D',
    });

    // Fire two parallel resolveTabWithDebugger calls. Only one should reach
    // chrome.debugger.attach — without dedup, the second would race past the
    // attachedTabs.has() check and Chrome would reject it.
    const first = resolveTabWithDebugger(42);
    const second = resolveTabWithDebugger(42);

    await attachStarted;
    resolveAttach();

    await Promise.all([first, second]);

    expect(chromeMock.debugger.attach).toHaveBeenCalledTimes(1);
  });
});
