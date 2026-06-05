import { ConnectionManager } from './connection-manager';
import { takeScreenshot } from './screenshot/index';
import {
  resolveTabWithDebugger,
  getConsoleLogs,
  getNetworkRequests,
  getExceptions,
  evaluateJS,
  getDOMSnapshot,
  getPerformanceMetrics,
  getStorageData,
} from './debugger/index';
import {
  DEFAULT_WS_PORT,
  WS_PORT_RANGE_SIZE,
  type RequestMessage,
  type TakeScreenshotParams,
  type GetConsoleLogsParams,
  type ConsoleLogsResult,
  type ActiveTabResult,
  type ListTabsResult,
  type RefreshPageParams,
  type RefreshPageResult,
} from '@paparazzi/shared';

// Configuration
const KEEPALIVE_ALARM = 'paparazzi-keepalive';
const KEEPALIVE_INTERVAL_MINUTES = 0.5; // 30 seconds

/**
 * Handle incoming requests from the MCP server.
 */
async function handleRequest(request: RequestMessage): Promise<unknown> {
  console.log('[Paparazzi] Handling request:', request.action);

  switch (request.action) {
    case 'takeScreenshot':
      return handleTakeScreenshot(request.params as TakeScreenshotParams, request.tabId);

    case 'getConsoleLogs':
      return handleGetConsoleLogs(request.params as GetConsoleLogsParams, request.tabId);

    case 'getActiveTab':
      return handleGetActiveTab();

    case 'listTabs':
      return handleListTabs();

    case 'getNetworkRequests':
      return handleGetNetworkRequests(request.params as { clear?: boolean }, request.tabId);

    case 'getExceptions':
      return handleGetExceptions(request.params as { clear?: boolean }, request.tabId);

    case 'evaluateJS':
      return handleEvaluateJS(request.params as { expression: string }, request.tabId);

    case 'getDOMSnapshot':
      return handleGetDOMSnapshot(request.params as { selector?: string }, request.tabId);

    case 'getPerformanceMetrics':
      return handleGetPerformanceMetrics(request.tabId);

    case 'getStorageData':
      return handleGetStorageData(request.tabId);

    case 'refreshPage':
      return handleRefreshPage(request.params as RefreshPageParams, request.tabId);

    default:
      throw new Error(`Unknown action: ${request.action}`);
  }
}

/**
 * Take a screenshot of the target tab.
 */
async function handleTakeScreenshot(
  params: TakeScreenshotParams | undefined,
  tabId?: number
) {
  const tab = await resolveTabWithDebugger(tabId);
  return takeScreenshot(tab, params ?? {});
}

/**
 * Get console logs from the target tab using debugger API.
 */
async function handleGetConsoleLogs(
  params?: GetConsoleLogsParams,
  tabId?: number
): Promise<ConsoleLogsResult> {
  const tab = await resolveTabWithDebugger(tabId);

  const logs = getConsoleLogs(tab.id, {
    levels: params?.levels,
    clear: params?.clear,
  });

  console.log('[Paparazzi] Returning', logs.length, 'logs');
  return { logs };
}

/**
 * Get network requests from the target tab.
 */
async function handleGetNetworkRequests(
  params?: { clear?: boolean },
  tabId?: number
) {
  const tab = await resolveTabWithDebugger(tabId);
  const requests = getNetworkRequests(tab.id, { clear: params?.clear });
  console.log('[Paparazzi] Returning', requests.length, 'network requests');
  return { requests };
}

/**
 * Get JavaScript exceptions from the target tab.
 */
async function handleGetExceptions(
  params?: { clear?: boolean },
  tabId?: number
) {
  const tab = await resolveTabWithDebugger(tabId);
  const exceptions = getExceptions(tab.id, { clear: params?.clear });
  console.log('[Paparazzi] Returning', exceptions.length, 'exceptions');
  return { exceptions };
}

/**
 * Evaluate JavaScript in the target tab.
 */
async function handleEvaluateJS(
  params: { expression: string },
  tabId?: number
) {
  const tab = await resolveTabWithDebugger(tabId);
  const result = await evaluateJS(tab.id, params.expression);
  console.log('[Paparazzi] Evaluated JS:', result.type);
  return result;
}

/**
 * Get DOM snapshot from the target tab.
 */
async function handleGetDOMSnapshot(
  params?: { selector?: string },
  tabId?: number
) {
  const tab = await resolveTabWithDebugger(tabId);
  const html = await getDOMSnapshot(tab.id, params?.selector);
  console.log('[Paparazzi] Got DOM snapshot, length:', html.length);
  return { html };
}

/**
 * Get performance metrics from the target tab.
 */
async function handleGetPerformanceMetrics(tabId?: number) {
  const tab = await resolveTabWithDebugger(tabId);
  const metrics = await getPerformanceMetrics(tab.id);
  console.log('[Paparazzi] Got performance metrics');
  return metrics;
}

/**
 * Get storage data from the target tab.
 */
async function handleGetStorageData(tabId?: number) {
  const tab = await resolveTabWithDebugger(tabId);
  const data = await getStorageData(tab.id);
  console.log('[Paparazzi] Got storage data');
  return data;
}

/**
 * Refresh the target page and wait for it to load.
 */
async function handleRefreshPage(
  params?: RefreshPageParams,
  tabId?: number
): Promise<RefreshPageResult> {
  const tab = await resolveTabWithDebugger(tabId);

  // Wait for the reload to finish, the tab to be closed, or a hard timeout.
  // Without the latter two, `onUpdated` may never fire (closed tab, interrupted
  // nav) and the listener — plus this promise — would leak forever.
  const waitForLoad = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timeoutId);
    };
    const onUpdated = (changedId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changedId === tab.id && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };
    const onRemoved = (removedId: number) => {
      if (removedId === tab.id) {
        cleanup();
        reject(new Error(`Tab ${tab.id} was closed during reload`));
      }
    };
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Tab ${tab.id} did not finish loading within 25s`));
    }, 25_000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });

  // Reload the tab
  await chrome.tabs.reload(tab.id, {
    bypassCache: params?.bypassCache ?? false,
  });

  await waitForLoad;

  // Get updated tab info
  const updatedTab = await chrome.tabs.get(tab.id);

  console.log('[Paparazzi] Page refreshed:', updatedTab.url);

  return {
    url: updatedTab.url ?? '',
    title: updatedTab.title ?? '',
    success: true,
  };
}

/**
 * Get information about the active tab.
 *
 * Falls back through three progressively wider queries because
 * `currentWindow: true` returns nothing when no Chrome window has OS focus —
 * common when the user is talking to Claude in a different app.
 */
async function handleGetActiveTab(): Promise<ActiveTabResult> {
  const queries: chrome.tabs.QueryInfo[] = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true },
    { active: true },
  ];

  for (const q of queries) {
    const [tab] = await chrome.tabs.query(q);
    if (tab?.id) {
      return {
        id: tab.id,
        url: tab.url ?? '',
        title: tab.title ?? '',
        windowId: tab.windowId,
      };
    }
  }

  throw new Error(
    'No active tab found in any Chrome window. Open a tab and try again.'
  );
}

/**
 * List all open tabs across all windows.
 */
async function handleListTabs(): Promise<ListTabsResult> {
  const tabs = await chrome.tabs.query({});

  return {
    tabs: tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined)
      .map((tab) => ({
        id: tab.id,
        url: tab.url ?? '',
        title: tab.title ?? '',
        windowId: tab.windowId,
        active: tab.active,
      })),
  };
}

// Create connection manager for all ports in range
const manager = new ConnectionManager({
  basePort: DEFAULT_WS_PORT,
  portRangeSize: WS_PORT_RANGE_SIZE,
  onRequest: handleRequest,
});

// Connect on startup
console.log('[Paparazzi] Service worker starting...');
manager.connectAll();

// Set up keepalive alarm to prevent service worker from being killed
// and to maintain WebSocket connection
chrome.alarms.create(KEEPALIVE_ALARM, {
  periodInMinutes: KEEPALIVE_INTERVAL_MINUTES,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    console.log('[Paparazzi] Keepalive ping');
    manager.pingAll();
  }
});

// Handle extension icon click (optional - could show popup in future)
chrome.action.onClicked.addListener(() => {
  const connected = manager.isAnyConnected();
  console.log('[Paparazzi] Extension clicked, connected:', connected);

  // For now, just try to reconnect if not connected
  if (!connected) {
    manager.connectAll();
  }
});

// Reconnect when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Paparazzi] Extension installed/updated');
  manager.connectAll();
});

// Reconnect when Chrome starts
chrome.runtime.onStartup.addListener(() => {
  console.log('[Paparazzi] Chrome started');
  manager.connectAll();
});

// Log when service worker is about to be suspended
self.addEventListener('beforeunload', () => {
  console.log('[Paparazzi] Service worker suspending...');
});

console.log('[Paparazzi] Service worker initialized');
