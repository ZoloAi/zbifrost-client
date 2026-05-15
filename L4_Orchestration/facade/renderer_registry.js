/**
 * L4_Orchestration/facade/renderer_registry.js
 * 
 * Renderer Registry - Centralized Lazy Loading for All Renderers
 * 
 * Consolidates 16 individual _ensure*Renderer() methods from bifrost_client.js
 * into a single registry-based loader.
 * 
 * Extracted from bifrost_client.js (Task 0, Step 1.2)
 * 
 * @module facade/renderer_registry
 * @layer L4 (Orchestration)
 */

/**
 * Renderer Registry - Maps renderer types to their module paths and classes
 *
 * TODO: Tiered initialization for publish-time performance
 * ──────────────────────────────────────────────────────────
 * Add a `priority` field to each entry:
 *   - 'critical'  → load before WebSocket connects (blocks first paint)
 *   - 'deferred'  → load after first chunk renders (requestIdleCallback / post-paint hook)
 *
 * Critical tier (must exist before first chunk renders):
 *   typography, text, header (header_renderer if separate), list
 *
 * Deferred tier (never in a typical first chunk):
 *   code, card, button, table, dl, image, icon, navigation,
 *   dashboard, swiper, terminal, spinner, progressBar, form, menu
 *
 * Implementation sketch:
 *   1. Add `priority: 'critical' | 'deferred'` to each entry below
 *   2. In asset_loader.js (or initializer.js), call
 *      rendererRegistry.preloadTier('critical') before WS connect
 *   3. After first-paint signal (first WebSocket chunk ACK), call
 *      rendererRegistry.preloadTier('deferred') via requestIdleCallback
 *   4. ensureRenderer() stays unchanged — cache hit on any pre-loaded renderer
 *
 * Expected gain: time-to-interactive drops from ~40 module fetches to ~4-5
 * before first content paint, remainder loads invisibly in background.
 */
export const RENDERER_REGISTRY = {
  // Outputs - Typography & Text
  typography: {
    path: 'L2_Handling/display/outputs/typography_renderer.js',
    className: 'TypographyRenderer',
    isDefault: true,
    passClient: false
  },
  text: {
    path: 'L2_Handling/display/outputs/text_renderer.js',
    className: 'TextRenderer',
    isDefault: true,
    passClient: false
  },
  code: {
    path: 'L2_Handling/display/outputs/code_renderer.js',
    className: 'CodeRenderer',
    isDefault: true,
    passClient: false
  },
  
  // Outputs - Cards & Buttons
  card: {
    path: 'L2_Handling/display/outputs/card_renderer.js',
    className: 'CardRenderer',
    isDefault: true,
    passClient: false
  },
  button: {
    path: 'L2_Handling/display/inputs/button_renderer.js',
    className: 'ButtonRenderer',
    isDefault: true,
    passClient: true // ButtonRenderer needs client for event handling
  },
  
  // Outputs - Data Display
  table: {
    path: 'L2_Handling/display/outputs/table_renderer.js',
    className: 'TableRenderer',
    isDefault: true,
    passClient: false
  },
  list: {
    path: 'L2_Handling/display/outputs/list_renderer.js',
    className: 'ListRenderer',
    isDefault: true,
    passClient: true // ListRenderer needs client for nested rendering
  },
  dl: {
    path: 'L2_Handling/display/outputs/dl_renderer.js',
    className: 'DLRenderer',
    isDefault: false,
    passClient: false,
    useModuleRegistry: true // Uses MODULE_REGISTRY for loading
  },
  
  // Outputs - Media
  image: {
    path: 'L2_Handling/display/outputs/image_renderer.js',
    className: 'ImageRenderer',
    isDefault: true,
    passClient: false
  },
  icon: {
    path: 'L2_Handling/display/outputs/icon_renderer.js',
    className: 'IconRenderer',
    isDefault: true,
    passClient: false
  },
  
  // Outputs - Navigation
  navigation: {
    path: 'L2_Handling/display/outputs/navigation_renderer.js',
    className: 'NavigationRenderer',
    isDefault: false,
    passClient: true, // NavigationRenderer needs client for link primitives
    useModuleRegistry: true
  },
  
  // Composite - Complex Components
  dashboard: {
    path: 'L2_Handling/display/composite/dashboard_renderer.js',
    className: 'DashboardRenderer',
    isDefault: true,
    passClient: true // DashboardRenderer needs client for nested rendering
  },
  swiper: {
    path: 'L2_Handling/display/composite/swiper_renderer.js',
    className: 'SwiperRenderer',
    isDefault: true,
    passClient: false
  },
  terminal: {
    path: 'L2_Handling/display/composite/terminal_renderer.js',
    className: 'TerminalRenderer',
    isDefault: true,
    passClient: true, // TerminalRenderer needs client for execution
    exposeToWindow: true // Expose to window._TerminalRenderer for message handler
  },
  
  // Feedback - UI State
  spinner: {
    path: 'L2_Handling/display/feedback/spinner_renderer.js',
    className: 'SpinnerRenderer',
    isDefault: true,
    passClient: false
  },
  progressBar: {
    path: 'L2_Handling/display/feedback/progressbar_renderer.js',
    className: 'ProgressBarRenderer',
    isDefault: true,
    passClient: false
  },
  
  // Inputs - Forms
  form: {
    path: 'L2_Handling/display/inputs/form_renderer.js',
    className: 'FormRenderer',
    isDefault: false,
    passClient: true, // FormRenderer needs client for form handling
    useModuleRegistry: true
  },
  menu: {
    path: 'L2_Handling/display/navigation/menu_renderer.js',
    className: 'MenuRenderer',
    isDefault: false,
    passClient: true, // MenuRenderer needs client for menu interactions
    useModuleRegistry: true
  }
};

/**
 * RendererRegistry - Centralized renderer loading and caching
 */
export class RendererRegistry {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
    this.baseUrl = client._baseUrl;
    this.renderers = {}; // Cache for loaded renderers
  }

  /**
   * Ensure a renderer is loaded and cached
   * @param {string} type - Renderer type (e.g., 'typography', 'button', 'table')
   * @returns {Promise<Object>} Renderer instance
   */
  async ensureRenderer(type) {
    // Return cached renderer if already loaded
    if (this.renderers[type]) {
      return this.renderers[type];
    }

    // Get renderer config from registry
    const config = RENDERER_REGISTRY[type];
    if (!config) {
      throw new Error(`Unknown renderer type: ${type}`);
    }

    // Load renderer module
    let RendererClass;
    if (config.useModuleRegistry) {
      // Use client's _loadModule for MODULE_REGISTRY lookup
      const module = await this.client._loadModule(type === 'dl' ? 'dl_renderer' : 
                                                    type === 'navigation' ? 'navigation_renderer' :
                                                    type === 'form' ? 'form_renderer' :
                                                    type === 'menu' ? 'menu_renderer' : type);
      RendererClass = module[config.className];
    } else {
      // Direct import
      const fullPath = `${this.baseUrl}${config.path}`;
      const module = await import(fullPath);
      RendererClass = config.isDefault ? module.default : module[config.className];
    }

    // Instantiate renderer
    const args = config.passClient ? [this.logger, this.client] : [this.logger];
    const renderer = new RendererClass(...args);

    // Expose to window if needed (for TerminalRenderer)
    if (config.exposeToWindow) {
      window[`_${config.className}`] = RendererClass;
    }

    // Cache and return
    this.renderers[type] = renderer;
    this.logger.debug(`${config.className} loaded via registry`);
    return renderer;
  }

  /**
   * Get a cached renderer (throws if not loaded)
   * @param {string} type - Renderer type
   * @returns {Object} Renderer instance
   */
  getRenderer(type) {
    const renderer = this.renderers[type];
    if (!renderer) {
      throw new Error(`Renderer not loaded: ${type}`);
    }
    return renderer;
  }

  /**
   * Check if a renderer is loaded
   * @param {string} type - Renderer type
   * @returns {boolean}
   */
  hasRenderer(type) {
    return !!this.renderers[type];
  }

  /**
   * Preload multiple renderers in parallel
   * @param {string[]} types - Array of renderer types
   * @returns {Promise<void>}
   */
  async preloadRenderers(types) {
    await Promise.all(types.map(type => this.ensureRenderer(type)));
  }
}
