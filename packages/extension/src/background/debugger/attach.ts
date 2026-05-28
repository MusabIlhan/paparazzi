/**
 * Debugger attachment management.
 */

import { attachedTabs, getOrCreateTabState, clearTabState } from './state';

// Dedupe concurrent attaches: if two requests race against an unattached tab,
// both pass `attachedTabs.has(tabId)`, both invoke chrome.debugger.attach, and
// Chrome rejects the second with "Another debugger is already attached".
const pendingAttaches = new Map<number, Promise<void>>();

/**
 * Attach debugger to a tab and enable all CDP domains.
 */
export async function attachToTab(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) {
    return;
  }

  const existing = pendingAttaches.get(tabId);
  if (existing) {
    return existing;
  }

  const attachPromise = (async () => {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      attachedTabs.add(tabId);
      getOrCreateTabState(tabId);

      // Enable all the CDP domains we need
      await Promise.all([
        chrome.debugger.sendCommand({ tabId }, 'Runtime.enable'),
        chrome.debugger.sendCommand({ tabId }, 'Network.enable'),
        chrome.debugger.sendCommand({ tabId }, 'DOM.enable'),
        chrome.debugger.sendCommand({ tabId }, 'Performance.enable'),
      ]);

      console.log('[Paparazzi] Debugger attached to tab:', tabId);
    } catch (err) {
      console.error('[Paparazzi] Failed to attach debugger:', err);
      throw err;
    } finally {
      pendingAttaches.delete(tabId);
    }
  })();

  pendingAttaches.set(tabId, attachPromise);
  return attachPromise;
}

/**
 * Detach debugger from a tab.
 */
export async function detachFromTab(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) {
    return;
  }

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Ignore - tab might be closed
  }

  clearTabState(tabId);
  console.log('[Paparazzi] Debugger detached from tab:', tabId);
}

/**
 * Check if debugger is attached to a tab.
 */
export function isAttached(tabId: number): boolean {
  return attachedTabs.has(tabId);
}

/**
 * Resolve the target tab for a request and ensure the debugger is attached.
 *
 * - If `tabId` is provided, looks up that specific tab (across all windows).
 * - Otherwise falls back to the active tab in the current window.
 */
export async function resolveTabWithDebugger(
  tabId?: number
): Promise<chrome.tabs.Tab & { id: number }> {
  let tab: chrome.tabs.Tab | undefined;

  if (tabId !== undefined) {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error(
        `Tab ${tabId} not found. Call list_tabs to see available tabs.`
      );
    }
  } else {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }

  if (!tab?.id) {
    throw new Error(
      tabId !== undefined
        ? `Tab ${tabId} has no id`
        : 'No active tab found'
    );
  }

  await attachToTab(tab.id);

  return tab as chrome.tabs.Tab & { id: number };
}
