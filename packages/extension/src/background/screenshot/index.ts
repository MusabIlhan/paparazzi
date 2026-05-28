/**
 * Screenshot module - main entry point.
 *
 * This module handles all screenshot-related functionality:
 * - Viewport captures
 * - Full-page captures with scrolling and stitching
 * - Image chunking for pages exceeding API limits
 * - Console log integration
 */

import type {
  TakeScreenshotParams,
  ScreenshotResult,
  ScreenshotChunk,
  ConsoleLogEntry,
} from '@paparazzi/shared';
import { captureViewport, captureFullPage, getPageMetrics } from './capture';
import { isRestrictedUrl, getConsoleLogsForTab } from './utils';

export { captureViewport, captureFullPage } from './capture';
export { isRestrictedUrl } from './restricted-urls';
export { MAX_IMAGE_DIMENSION } from './constants';
export { calculateChunkCount } from './stitch';

/**
 * Main screenshot handler that routes to viewport or full-page capture.
 *
 * Expects the caller to have resolved the target tab (and attached the debugger).
 */
export async function takeScreenshot(
  tab: chrome.tabs.Tab & { id: number },
  params: TakeScreenshotParams
): Promise<ScreenshotResult> {
  const mode = params.mode ?? 'viewport';
  const format = params.format ?? 'png';
  const quality = params.quality;
  const includeConsole = params.includeConsole ?? false;

  // Check for restricted URLs
  const url = tab.url ?? '';
  if (isRestrictedUrl(url)) {
    throw new Error(`Cannot capture screenshots from restricted pages (${url.split(':')[0]}://)`);
  }

  let imageData: string | undefined;
  let chunks: ScreenshotChunk[] | undefined;
  let width: number;
  let height: number;

  if (mode === 'fullPage') {
    const result = await captureFullPage(tab.id, { format, quality });
    imageData = result.imageData;
    chunks = result.chunks;
    width = result.width;
    height = result.height;
  } else {
    imageData = await captureViewport(tab.id, { format, quality });

    // Get dimensions for viewport mode
    const metrics = await getPageMetrics(tab.id);
    width = metrics.viewportWidth;
    height = metrics.viewportHeight;
  }

  // Get console logs if requested
  let consoleLogs: ConsoleLogEntry[] | undefined;
  if (includeConsole) {
    try {
      consoleLogs = await getConsoleLogsForTab(tab.id);
    } catch (err) {
      console.warn('[Paparazzi] Failed to get console logs:', err);
    }
  }

  return {
    imageData,
    chunks,
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    width,
    height,
    url: tab.url ?? '',
    title: tab.title ?? '',
    timestamp: new Date().toISOString(),
    consoleLogs,
  };
}
