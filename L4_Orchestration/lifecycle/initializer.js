/**
 * L4_Orchestration/lifecycle/initializer.js
 * 
 * Initialization Orchestrator
 * 
 * Coordinates the initialization sequence for BifrostClient:
 * - zVaF elements (connection badge, navbar, content area)
 * - Client-side navigation setup
 * - Widget hooks registration
 * - Cache hooks registration
 * 
 * Extracted from bifrost_client.js (Phase 5.2)
 */

export class Initializer {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
  }

  /**
   * Register default widget hooks (backward compatibility)
   * Widget hooks are now registered in WidgetHookManager
   */
  registerDefaultWidgetHooks() {
    // Widget hooks are now registered in the widget handler
    // This method is kept for backward compatibility
  }

  /**
   * Register cache-related hooks (onConnectionInfo, onDisconnected, onConnected)
   */
  async registerCacheHooks() {
    await this.client._ensureCacheManager();
    return this.client.cacheManager.registerCacheHooks();
  }

  /**
   * Disable all forms during offline mode
   */
  async disableForms() {
    await this.client._ensureCacheManager();
    return this.client.cacheManager.disableForms();
  }

  /**
   * Enable all forms when back online
   */
  async enableForms() {
    await this.client._ensureCacheManager();
    return this.client.cacheManager.enableForms();
  }

  /**
   * Initialize zVaF elements (connection badges, navbar, content area)
   * HTML structure (declared in zVaF.html):
   *   <zBifrostBadge></zBifrostBadge>  ← Dynamic, always fresh
   *   <zNavBar></zNavBar>              ← Dynamic, RBAC-aware
   *   <zVaF>...</zVaF>                 ← Cacheable content area
   */
  async initZVaFElements() {
    await this.client._ensureZVaFManager();
    return this.client.zvafManager.initZVaFElements();
  }

  /**
   * Populate connection badge content
   */
  async populateConnectionBadge() {
    await this.client._ensureZVaFManager();
    return this.client.zvafManager.populateConnectionBadge();
  }

  /**
   * Update badge state
   * @param {string} state - 'connecting', 'connected', 'disconnected', 'error'
   */
  async updateBadgeState(state) {
    await this.client._ensureZVaFManager();
    return this.client.zvafManager.updateBadgeState(state);
  }

  /**
   * Populate navbar from embedded config
   * Uses zuiConfig from server, fetches fresh on auth change
   */
  async populateNavBar() {
    await this.client._ensureZVaFManager();
    return this.client.zvafManager.populateNavBar();
  }

  /**
   * Fetch fresh navbar from API and populate (used after auth state changes)
   */
  async fetchAndPopulateNavBar(navHtmlFromServer = null) {
    await this.client._ensureZVaFManager();
    return this.client.zvafManager.fetchAndPopulateNavBar(navHtmlFromServer);
  }

  /**
   * Enable client-side navigation (SPA-style) for navbar links
   * Intercepts clicks to prevent full page reloads and uses WebSocket instead
   */
  async enableClientSideNavigation() {
    await this.client._ensureNavigationManager();
    return this.client.navigationManager.enableClientSideNavigation();
  }

  /**
   * Navigate to a route via WebSocket (client-side navigation)
   * @param {string} routePath - Path to navigate to (e.g., '/zAbout', '/zAccount')
   * @param {Object} options - Navigation options
   */
  async navigateToRoute(routePath, options = {}) {
    await this.client._ensureNavigationManager();
    return this.client.navigationManager.navigateToRoute(routePath, options);
  }
}
