/**
 * MCP Server for Paparazzi.
 *
 * Registers tools and handles communication with the Chrome extension.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DEFAULT_WS_PORT } from '@paparazzi/shared';
import { ExtensionBridge } from './extension-bridge/websocket-server';
import {
  handleTakeScreenshot,
  handleGetConsoleLogs,
  handleGetNetworkRequests,
  handleGetExceptions,
  handleEvaluateJS,
  handleGetActiveTab,
  handleListTabs,
  handleGetDOMSnapshot,
  handleGetPerformanceMetrics,
  handleGetStorageData,
  handleRefreshPage,
} from './tools';

export interface ServerOptions {
  port?: number;
}

const tabIdSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    'Target tab id from list_tabs. Defaults to the active tab when omitted.'
  );

/**
 * Create and configure the MCP server with screenshot tools.
 */
export async function createServer(options: ServerOptions = {}): Promise<{
  server: McpServer;
  bridge: ExtensionBridge;
}> {
  const port = options.port || Number(process.env.PAPARAZZI_PORT) || DEFAULT_WS_PORT;

  const server = new McpServer(
    { name: 'paparazzi', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const bridge = new ExtensionBridge({ port });
  await bridge.start();

  // ==========================================
  // Tool: take_screenshot
  // ==========================================
  server.registerTool(
    'take_screenshot',
    {
      description:
        'Captures a screenshot of a browser tab (the active tab by default, or any tab with tabId). Use this to see what the user is looking at, debug UI issues, or verify visual changes.',
      inputSchema: z.object({
        mode: z
          .enum(['viewport', 'fullPage'])
          .default('viewport')
          .describe("'viewport' for visible area, 'fullPage' for entire scrollable page"),
        format: z.enum(['png', 'jpeg']).default('png').describe('Image format'),
        quality: z.number().min(1).max(100).optional().describe('JPEG quality (1-100)'),
        includeConsole: z.boolean().default(false).describe('Include console logs in response'),
        tabId: tabIdSchema,
      }),
    },
    (params) => handleTakeScreenshot(bridge, params)
  );

  // ==========================================
  // Tool: get_console_logs
  // ==========================================
  server.registerTool(
    'get_console_logs',
    {
      description: 'Retrieves console log entries from a browser tab (active by default).',
      inputSchema: z.object({
        clear: z.boolean().default(false).describe('Clear logs after retrieval'),
        levels: z
          .array(z.enum(['log', 'warn', 'error', 'info', 'debug']))
          .optional()
          .describe('Filter by log levels'),
        tabId: tabIdSchema,
      }),
    },
    (params) => handleGetConsoleLogs(bridge, params)
  );

  // ==========================================
  // Tool: get_active_tab
  // ==========================================
  server.registerTool(
    'get_active_tab',
    {
      description: 'Gets information about the currently active browser tab.',
    },
    () => handleGetActiveTab(bridge)
  );

  // ==========================================
  // Tool: list_tabs
  // ==========================================
  server.registerTool(
    'list_tabs',
    {
      description:
        'Lists all open browser tabs across every Chrome window. Returns tab ids you can pass as tabId to other tools to inspect a specific (possibly non-active) tab.',
    },
    () => handleListTabs(bridge)
  );

  // ==========================================
  // Tool: get_network_requests
  // ==========================================
  server.registerTool(
    'get_network_requests',
    {
      description: 'Retrieves network requests (XHR, fetch) from a browser tab (active by default).',
      inputSchema: z.object({
        clear: z.boolean().default(false).describe('Clear request buffer after retrieval'),
        tabId: tabIdSchema,
      }),
    },
    (params) => handleGetNetworkRequests(bridge, params)
  );

  // ==========================================
  // Tool: get_exceptions
  // ==========================================
  server.registerTool(
    'get_exceptions',
    {
      description: 'Retrieves JavaScript exceptions from a browser tab (active by default).',
      inputSchema: z.object({
        clear: z.boolean().default(false).describe('Clear exceptions buffer after retrieval'),
        tabId: tabIdSchema,
      }),
    },
    (params) => handleGetExceptions(bridge, params)
  );

  // ==========================================
  // Tool: evaluate_js
  // ==========================================
  server.registerTool(
    'evaluate_js',
    {
      description: 'Evaluates JavaScript code in the context of a browser tab (active by default).',
      inputSchema: z.object({
        expression: z.string().describe('JavaScript expression to evaluate'),
        tabId: tabIdSchema,
      }),
    },
    (params) => handleEvaluateJS(bridge, params)
  );

  // ==========================================
  // Tool: get_dom_snapshot
  // ==========================================
  server.registerTool(
    'get_dom_snapshot',
    {
      description: 'Gets the HTML content of a browser tab (active by default).',
      inputSchema: z.object({
        selector: z.string().optional().describe('CSS selector to limit snapshot'),
        tabId: tabIdSchema,
      }),
    },
    (params) => handleGetDOMSnapshot(bridge, params)
  );

  // ==========================================
  // Tool: get_performance_metrics
  // ==========================================
  server.registerTool(
    'get_performance_metrics',
    {
      description: 'Gets performance metrics including Web Vitals, memory, and DOM statistics.',
      inputSchema: z.object({
        tabId: tabIdSchema,
      }),
    },
    (params) => handleGetPerformanceMetrics(bridge, params)
  );

  // ==========================================
  // Tool: get_storage_data
  // ==========================================
  server.registerTool(
    'get_storage_data',
    {
      description: 'Gets cookies, localStorage, and sessionStorage from a browser tab (active by default).',
      inputSchema: z.object({
        tabId: tabIdSchema,
      }),
    },
    (params) => handleGetStorageData(bridge, params)
  );

  // ==========================================
  // Tool: refresh_page
  // ==========================================
  server.registerTool(
    'refresh_page',
    {
      description: 'Refreshes a browser tab (active by default) and waits for load to complete.',
      inputSchema: z.object({
        bypassCache: z.boolean().default(false).describe('Bypass cache (hard refresh)'),
        tabId: tabIdSchema,
      }),
    },
    (params) => handleRefreshPage(bridge, params)
  );

  return { server, bridge };
}
