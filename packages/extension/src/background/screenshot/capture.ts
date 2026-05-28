/**
 * Screenshot capture functions.
 * Handles viewport and full-page capture coordination.
 *
 * Uses the Chrome DevTools Protocol (Page.captureScreenshot) so non-active
 * tabs can be captured without stealing focus from the user.
 */

import type { ScreenshotChunk } from '@paparazzi/shared';
import { MAX_IMAGE_DIMENSION } from './constants';
import {
  getPageMetrics,
  scrollTo,
  waitForImages,
  hideFixedElements,
  restoreFixedElements,
} from './page-manipulation';
import { stitchToSingleImage, stitchToChunks } from './stitch';

export interface CaptureOptions {
  format: 'png' | 'jpeg';
  quality?: number;
}

export interface FullPageCaptureResult {
  imageData?: string;
  chunks?: ScreenshotChunk[];
  width: number;
  height: number;
}

/**
 * Invoke CDP Page.captureScreenshot on an attached tab.
 * Returns the raw base64 payload (no data: prefix).
 */
async function cdpCapture(
  tabId: number,
  options: CaptureOptions
): Promise<string> {
  const params: { format: 'png' | 'jpeg'; quality?: number } = {
    format: options.format,
  };
  if (options.format === 'jpeg') {
    params.quality = options.quality ?? 80;
  }

  const result = (await chrome.debugger.sendCommand(
    { tabId },
    'Page.captureScreenshot',
    params
  )) as { data: string } | undefined;

  if (!result?.data) {
    throw new Error('Page.captureScreenshot returned no data');
  }
  return result.data;
}

/**
 * Capture a screenshot of the visible viewport.
 */
export async function captureViewport(
  tabId: number,
  options: CaptureOptions
): Promise<string> {
  return cdpCapture(tabId, options);
}

/**
 * Capture a full-page screenshot by scrolling and stitching.
 * Returns chunks if the page exceeds MAX_IMAGE_DIMENSION to stay within Claude API limits.
 * Handles lazy-loaded images and fixed/sticky elements.
 *
 * Caveat for background tabs: Chrome throttles requestAnimationFrame and other
 * rendering in inactive tabs, so the fixed SCROLL_SETTLE_DELAY between scroll
 * and capture is best-effort, not a paint guarantee. Captures of a tab the
 * user is not focused on may briefly include stale content; if pixel accuracy
 * matters, focus the tab first.
 */
export async function captureFullPage(
  tabId: number,
  options: CaptureOptions
): Promise<FullPageCaptureResult> {
  const metrics = await getPageMetrics(tabId);
  const { scrollHeight, viewportHeight, viewportWidth, currentScrollY } = metrics;

  // If page fits in viewport, just capture viewport
  if (scrollHeight <= viewportHeight) {
    const imageData = await captureViewport(tabId, options);
    return {
      imageData,
      width: viewportWidth,
      height: viewportHeight,
    };
  }

  // Hide fixed/sticky elements to prevent them from repeating in every segment
  await hideFixedElements(tabId);

  const mimeType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const screenshots: string[] = [];

  try {
    // Scroll and capture each viewport
    let scrollY = 0;

    while (scrollY < scrollHeight) {
      await scrollTo(tabId, scrollY);

      // Wait for lazy-loaded images in viewport to load
      await waitForImages(tabId);

      const base64 = await cdpCapture(tabId, options);
      // Stitch functions expect data URLs (they fetch them as blobs)
      screenshots.push(`data:${mimeType};base64,${base64}`);
      scrollY += viewportHeight;
    }
  } finally {
    // Always restore fixed elements, even if capture fails
    await restoreFixedElements(tabId);

    // Restore original scroll position
    await scrollTo(tabId, currentScrollY);
  }

  // Check if we need to chunk (page height exceeds MAX_IMAGE_DIMENSION)
  if (scrollHeight <= MAX_IMAGE_DIMENSION) {
    // Single image - stitch everything together
    const imageData = await stitchToSingleImage(screenshots, metrics, options.format);
    return {
      imageData,
      width: viewportWidth,
      height: scrollHeight,
    };
  }

  // Multiple chunks needed - create separate images
  const chunks = await stitchToChunks(screenshots, metrics, options.format);
  return {
    chunks,
    width: viewportWidth,
    height: scrollHeight,
  };
}

// Re-export getPageMetrics for use in the main handler
export { getPageMetrics } from './page-manipulation';
