/**
 * Menu Integration for Bifrost Client
 *
 * This module registers the onMenu hook with the BifrostClient to enable
 * menu rendering and interaction in Bifrost mode.
 *
 * Usage:
 *   <script type="module" src="/bifrost/src/menu_integration.js"></script>
 *
 * Or dynamically:
 *   import { registerMenuHook } from './menu_integration.js';
 *   registerMenuHook(bifrostClient);
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 3: Renderers
import { MenuRenderer } from '../display/navigation/menu_renderer.js';

/**
 * Register the onMenu hook with a BifrostClient instance
 * @param {BifrostClient} client - The Bifrost client instance
 */
export function registerMenuHook(client) {
  const logger = client.logger || console;
  logger.debug('[MenuIntegration] Registering onMenu hook');

  // Create menu renderer
  const menuRenderer = new MenuRenderer(client);

  // Register the onMenu hook
  // New-format zMenu events have flat 'options' array and 'title'.
  // Legacy menu events have 'menu_key' and nested options with breadcrumbs.
  client.registerHook('onMenu', (message) => {
    logger.debug('[MenuIntegration] onMenu hook called with message:', message);
    if (Array.isArray(message.options) && !message.menu_key) {
      menuRenderer.renderZMenu(message);
    } else {
      menuRenderer.renderMenu(message);
    }
  });

  logger.info('[MenuIntegration] onMenu hook registered successfully');
}

/**
 * Auto-register if BifrostClient is already initialized
 * This allows the script to be loaded after the client is created
 */
if (typeof window !== 'undefined' && window.bifrostClient) {
  const logger = window.bifrostClient.logger || console;
  logger.debug('[MenuIntegration] Auto-registering with existing BifrostClient');
  registerMenuHook(window.bifrostClient);
}

