/**
 * L4_Orchestration/facade/manager_registry.js
 * 
 * Manager Registry - Centralized Lazy Loading for All Managers
 * 
 * Consolidates 4 individual _ensure*Manager() methods from bifrost_client.js
 * into a single registry-based loader.
 * 
 * Extracted from bifrost_client.js (Task 0, Step 1.3)
 * 
 * @module facade/manager_registry
 * @layer L4 (Orchestration)
 */

/**
 * Manager Registry - Maps manager types to their module paths and classes
 */
export const MANAGER_REGISTRY = {
  cache: {
    path: 'L2_Handling/cache/orchestration/cache_manager.js',
    className: 'CacheManager',
    isDefault: false,
    passClient: true
  },
  zvaf: {
    path: 'L2_Handling/zvaf/zvaf_manager.js',
    className: 'ZVaFManager',
    isDefault: false,
    passClient: true
  },
  navigation: {
    path: 'L2_Handling/navigation/navigation_manager.js',
    className: 'NavigationManager',
    isDefault: false,
    passClient: true
  },
  widgetHook: {
    path: 'L2_Handling/hooks/widget_hook_manager.js',
    className: 'WidgetHookManager',
    isDefault: false,
    passClient: true
  }
};

/**
 * ManagerRegistry - Centralized manager loading and caching
 */
export class ManagerRegistry {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
    this.baseUrl = client._baseUrl;
    this.managers = {}; // Cache for loaded managers
  }

  /**
   * Ensure a manager is loaded and cached
   * @param {string} type - Manager type (e.g., 'cache', 'zvaf', 'navigation', 'widgetHook')
   * @returns {Promise<Object>} Manager instance
   */
  async ensureManager(type) {
    // Return cached manager if already loaded
    if (this.managers[type]) {
      return this.managers[type];
    }

    // Get manager config from registry
    const config = MANAGER_REGISTRY[type];
    if (!config) {
      throw new Error(`Unknown manager type: ${type}`);
    }

    // Load manager module
    const fullPath = `${this.baseUrl}${config.path}`;
    const module = await import(fullPath);
    const ManagerClass = config.isDefault ? module.default : module[config.className];

    // Instantiate manager
    const args = config.passClient ? [this.client] : [this.logger];
    const manager = new ManagerClass(...args);

    // Cache and return
    this.managers[type] = manager;
    this.logger.debug(`${config.className} loaded via registry`);
    return manager;
  }

  /**
   * Get a cached manager (throws if not loaded)
   * @param {string} type - Manager type
   * @returns {Object} Manager instance
   */
  getManager(type) {
    const manager = this.managers[type];
    if (!manager) {
      throw new Error(`Manager not loaded: ${type}`);
    }
    return manager;
  }

  /**
   * Check if a manager is loaded
   * @param {string} type - Manager type
   * @returns {boolean}
   */
  hasManager(type) {
    return !!this.managers[type];
  }

  /**
   * Preload multiple managers in parallel
   * @param {string[]} types - Array of manager types
   * @returns {Promise<void>}
   */
  async preloadManagers(types) {
    await Promise.all(types.map(type => this.ensureManager(type)));
  }
}
