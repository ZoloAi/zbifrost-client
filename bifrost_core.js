/**
 * 
 * BifrostClient - Production JavaScript Client for zBifrost
 * 
 *
 * A production-ready WebSocket client for zCLI's zBifrost bridge.
 * Modular architecture with lazy loading and automatic zTheme integration.
 *
 * @version 1.6.0
 * @author Gal Nachshon
 * @license MIT
 *
 * 
 * Quick Start
 * 
 *
 * // Swiper-Style Elegance (One declaration, everything happens automatically):
 * const client = new BifrostClient('ws://localhost:8765', {
 *   autoConnect: true,        // Auto-connect on instantiation
 *   zTheme: true,             // Enable zTheme CSS & rendering
 *   // targetElement: 'zVaF', // Optional: default is 'zVaF' (zView and Function)
 *   autoRequest: 'show_hello',// Auto-send on connect
 *   onConnected: (info) => this.logger.log('Connected!', info)
 * });
 *
 * // Traditional (More control):
 * const client = new BifrostClient('ws://localhost:8765', {
 *   zTheme: true,
 *   hooks: {
 *     onConnected: (info) => this.logger.log('Connected!'),
 *     onDisconnected: (reason) => this.logger.log('Disconnected:', reason),
 *     onMessage: (msg) => this.logger.log('Message:', msg),
 *     onError: (error) => this.logger.error('Error:', error)
 *   }
 * });
 * await client.connect();
 * client.send({event: 'my_event'});
 * const users = await client.read('users');
 *
 * 
 * Lazy Loading Architecture
 * 
 *
 * Modules are loaded dynamically only when needed:
 * - Logger/Hooks: Loaded immediately (lightweight)
 * - Connection: Loaded on connect() via WebSocketConnection
 * - MessageHandler: Loaded on connect()
 * - Renderers: Loaded via RendererRegistry (16 renderer types)
 * - Managers: Loaded via ManagerRegistry (cache, zvaf, navigation, hooks)
 * - ThemeLoader: Loaded on connect() if zTheme enabled
 *
 * Benefits:
 * - CDN-friendly (no import resolution at load time)
 * - Progressive loading (only load what you use)
 * - Registry-based module loading (centralized, maintainable)
 * - Stays modular (source files remain separate)
 *
 * Refactoring History:
 * - Phase 9: Deep architectural realignment (L1-L4 + zSys layers)
 * - Task 0 (Pre-NPM): Decomposition and registry consolidation
 *   - Step 1.2: Created RendererRegistry (16 renderers → 1 registry)
 *   - Step 1.3: Created ManagerRegistry (4 managers → 1 registry)
 *   - Step 1.5: Extracted WebSocketConnection to L1_Foundation
 *   - Result: 1587 LOC → 1442 LOC (-145 LOC, 9.1% reduction)
 *
 * 
 * TODO: Future Build System (v2.0+)
 * 
 *
 * Current: Hybrid UMD + ES modules (main file UMD, lazy-loaded modules ESM)
 * - Main file: UMD wrapper allows plain <script> tag usage
 * - Sub-modules: ES modules loaded via dynamic import()
 * - Works in modern browsers (2017+) with ES module support
 *
 * Future: Add bundled UMD build for maximum compatibility
 * - Goal: Support older browsers without ES module support
 * - Implementation: Use Rollup/esbuild to create dist/bifrost.umd.js
 * - Bundle all modules into single file with UMD wrapper
 * - Trade-off: Larger file size, no lazy loading, but works everywhere
 *
 * Distribution strategy (v2.0+):
 * - src/bifrost_client.js: Current hybrid approach (default, recommended)
 * - dist/bifrost.esm.js: Pure ES module build (for modern bundlers)
 * - dist/bifrost.umd.js: Fully bundled UMD (for legacy browsers)
 *
 * Package.json exports (v2.0+):
 * {
 *   "main": "dist/bifrost.umd.js",        // CommonJS/legacy default
 *   "module": "dist/bifrost.esm.js",      // ES module for bundlers
 *   "browser": "src/bifrost_client.js",   // Browser CDN (current hybrid)
 *   "exports": {
 *     ".": {
 *       "import": "./dist/bifrost.esm.js",
 *       "require": "./dist/bifrost.umd.js",
 *       "browser": "./src/bifrost_client.js"
 *     }
 *   }
 * }
 * 
 */

// bifrost_core.js — ES module. Loaded dynamically by bifrost_client.js bootstrap.
// Server controls which version is loaded via connection_info.bifrost_core_url (Phase 3B).

// Base URL derived from this module's own URL (works for dynamic import())
const BASE_URL = new URL('.', import.meta.url).href;

/**
 * BifrostCore - Full WebSocket client, loaded dynamically by BifrostBootstrap.
 * Exported as ES module so the bootstrap can import() it at runtime.
 */
class BifrostCore {
    /**
     * Construct WebSocket URL from backend config or validate provided URL
     * @private
     */
    _constructWebSocketURL(url) {
      // Read zUI config from page FIRST (server-injected WebSocket SSL config)
      let zuiConfig = {};
      if (typeof document !== 'undefined' && !url) {
        const zuiConfigEl = document.getElementById('zui-config');
        if (zuiConfigEl) {
          try {
            zuiConfig = JSON.parse(zuiConfigEl.textContent);
          } catch (e) {
            // Store for logging after logger init
            this._zuiConfigParseError = e;
          }
        }
      }

      // Auto-construct WebSocket URL from backend config (respects .zEnv SSL settings)
      if (!url) {
        const wsConfig = zuiConfig.websocket || {};
        const protocol = wsConfig.ssl_enabled ? 'wss:' : 'ws:';
        const wsHost = wsConfig.host || '127.0.0.1';
        const wsPort = wsConfig.port || 8765;
        url = `${protocol}//${wsHost}:${wsPort}`;
        // Store for logging after logger init
        this._autoConstructedUrl = { url, ssl: wsConfig.ssl_enabled };
      }

      // Validate URL
      if (typeof url !== 'string' || url.trim() === '') {
        throw new Error('BifrostClient: URL must be a non-empty string');
      }
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        throw new Error('BifrostClient: URL must start with ws:// or wss://');
      }

      return { url, zuiConfig };
    }

    /**
     * Parse zUI config from page and merge with options
     * @private
     */
    _parseZUIConfig(options, zuiConfigEarly, reconnectDelay, timeout) {
      // Auto-read zUI config from page (server-injected zSession values)
      let zuiConfig = {};
      if (typeof document !== 'undefined') {
        const zuiConfigEl = document.getElementById('zui-config');
        if (zuiConfigEl) {
          try {
            zuiConfig = JSON.parse(zuiConfigEl.textContent);
            if (this.logger) {
              this.logger.debug('Auto-loaded zUI config from page', zuiConfig);
            }
          } catch (e) {
            if (this.logger) {
              this.logger.warn('Failed to parse zui-config:', e);
            }
          }
        }
      }

      // Determine autoRequest based on zui-config
      let autoRequest = options.autoRequest || null;

      // If zBlock is specified (from zui-config or options), auto-generate walker execution request
      const zBlock = options.zBlock || zuiConfig.zBlock || null;
      const zVaFile = options.zVaFile || zuiConfig.zVaFile || null;
      const zVaFolder = options.zVaFolder || zuiConfig.zVaFolder || null;

      if (zBlock && !autoRequest) {
        autoRequest = {
          event: 'execute_walker',
          zBlock: zBlock,
          zVaFile: zVaFile,
          zVaFolder: zVaFolder
        };
        // Store for logging after logger init
        this._autoGeneratedRequest = autoRequest;
      }

      const parsedOptions = {
        autoConnect: options.autoConnect || false,
        zTheme: options.zTheme || false,
        zIcons: options.zIcons || false,
        targetElement: options.targetElement || 'zVaF',
        autoRequest: autoRequest,
        autoReconnect: options.autoReconnect !== false,
        reconnectDelay: reconnectDelay,
        timeout: timeout,
        debug: options.debug || false,
        token: options.token || null,
        hooks: options.hooks || {},
        zThemeCDN: options.zThemeCDN || 'https://cdn.jsdelivr.net/gh/ZoloAi/zTheme@main/dist',
        zVaFile: zVaFile,
        zVaFolder: zVaFolder,
        zBlock: zBlock,
        title: options.title || zuiConfig.title || null,
        brand: options.brand || zuiConfig.brand || null
      };

      return { zuiConfig, options: parsedOptions };
    }

    /**
     * Create a new BifrostClient instance
     * @param {string} url - WebSocket server URL (e.g., 'ws://localhost:8765')
     * @param {Object} options - Configuration options
     * @param {boolean} options.autoConnect - Auto-connect on instantiation (default: false)
     * @param {boolean} options.zTheme - Load zTheme CSS + JS from CDN (default: false)
     * @param {string} options.zThemeCDN - CDN base URL for zTheme (default: jsdelivr ZoloAi/zTheme)
     * Note: Bootstrap Icons and Prism.js are ALWAYS loaded automatically (unchangeable defaults)
     * @param {string} options.targetElement - Target DOM selector for rendering (default: 'zVaF')
     * @param {string|Object} options.autoRequest - Auto-send request on connect (event name or full request object)
     * @param {boolean} options.autoReconnect - Auto-reconnect on disconnect (default: true)
     * @param {number} options.reconnectDelay - Delay between reconnect attempts in ms (default: 3000 = TIMEOUTS.RECONNECT_DELAY)
     * @param {number} options.timeout - Request timeout in ms (default: 30000 = TIMEOUTS.REQUEST_TIMEOUT)
     * @param {boolean} options.debug - Enable debug logging (default: false)
     * @param {string} options.token - Authentication token (optional)
     * @param {Object} options.hooks - Event hooks for customization
     */
    constructor(url, options = {}) {
      // Parse zUI config and construct WebSocket URL if needed
      const { url: finalUrl, zuiConfig: zuiConfigEarly } = this._constructWebSocketURL(url);
      this.url = finalUrl;

      // Validate and set options (using bifrost_constants defaults)
      // NOTE: UMD module limitation - cannot use top-level imports
      // These constants mirror bifrost_constants.js TIMEOUTS (SSOT)
      const RECONNECT_DELAY_DEFAULT = 3000;  // TIMEOUTS.RECONNECT_DELAY
      const REQUEST_TIMEOUT_DEFAULT = 30000; // TIMEOUTS.REQUEST_TIMEOUT
      
      const reconnectDelay = options.reconnectDelay || RECONNECT_DELAY_DEFAULT;
      const timeout = options.timeout || REQUEST_TIMEOUT_DEFAULT;

      if (typeof reconnectDelay !== 'number' || reconnectDelay <= 0) {
        throw new Error('BifrostClient: reconnectDelay must be a positive number');
      }
      if (typeof timeout !== 'number' || timeout <= 0) {
        throw new Error('BifrostClient: timeout must be a positive number');
      }

      // Parse zUI config and build options
      const { zuiConfig, options: parsedOptions } = this._parseZUIConfig(options, zuiConfigEarly, reconnectDelay, timeout);
      this.zuiConfig = zuiConfig;
      this.options = parsedOptions;

      // Module cache (lazy loaded)
      this._modules = {};
      this._baseUrl = BASE_URL;
      this.renderingFacade = null; // Phase 5.1: Lazy-loaded rendering facade
      this.initializer = null; // Phase 5.2: Lazy-loaded initializer
      this.assetLoader = null; // Phase 5.4: Lazy-loaded asset loader
      this.rendererRegistry = null; // Task 0.2: Lazy-loaded renderer registry
      this.managerRegistry = null; // Task 0.3: Lazy-loaded manager registry

      // Pre-initialize lightweight modules synchronously (MUST BE FIRST - initializes logger)
      this._initLightweightModules();

      // Log early bootstrap info now that logger is ready
      if (this._zuiConfigParseError) {
        this.logger.warn('Failed to parse zui-config:', this._zuiConfigParseError);
      }
      if (this._autoConstructedUrl) {
        this.logger.info('Auto-constructed WebSocket URL: %s (SSL: %s)', this._autoConstructedUrl.url, this._autoConstructedUrl.ssl);
      }
      if (this._autoGeneratedRequest) {
        this.logger.info('Auto-generated walker request from zui-config', this._autoGeneratedRequest);
      }

      // v1.6.0: Initialize cache system (async, must complete before connect)
      this.cache = null;
      this.session = null;
      this.storage = null;
      this._cacheReady = this._initCacheSystem().then(() => {
        // Register hooks after cache is initialized
        this._registerCacheHooks();
        this.logger.debug('[Cache] Ready for connection');
      }).catch(err => {
        this.logger.error('[Cache] Initialization failed:', err);
        // Non-fatal: allow connection without cache
      });

      // Debug: confirm which declarative UI options were actually received
      this.logger.debug('Init options:', {
        targetElement: this.options.targetElement,
        zVaFile: this.options.zVaFile,
        zVaFolder: this.options.zVaFolder,
        zBlock: this.options.zBlock
      });

      // Load zTheme from CDN if enabled
      if (this.options.zTheme) {
        this._loadZThemeCDN();
      }

      // Bootstrap Icons are ALWAYS loaded (unchangeable default for zBifrost)
      // Phase 2: Extracted to src/bootstrap/cdn_loader.js
      this._loadBootstrapIcons();

      // Prism.js for syntax highlighting is ALWAYS loaded (unchangeable default for zBifrost)
      // Phase 2: Extracted to src/bootstrap/cdn_loader.js
      this._loadPrismJS();

      // _zScripts: load immediately (same timing as Prism) so intercept plugins
      // are active before any user interaction. asset_loader.js dedup guard
      // prevents double-injection if widget_hook_manager's fallback also fires.
      this._loadZScripts();
      this._zScriptsLoaded = true;

      // v1.6.0: Initialize zVaF elements (now synchronous - elements exist in HTML)
      // Just populate content, don't create structure
      this._initZVaFElements();

      // Walker mode: all pages use execute_walker (server-side rendering via WebSocket)
      if (this.options.autoRequest && this.options.autoRequest.event === 'execute_walker') {
        this.logger.debug('Walker mode detected');
      }

      // Auto-connect if requested (Swiper-style elegance!)
      // v1.6.0: Wait for cache initialization before connecting (zVaF elements are now sync)
      if (this.options.autoConnect) {
        this._cacheReady.finally(() => {
          this.logger.debug('[Cache] Ready, connecting...');
          this.connect().catch(err => {
            this.logger.error('Auto-connect failed:', err);
            this.hooks.call('onError', { type: 'autoconnect_failed', error: err });
          });
        });
      }

      // Part 2: Browser lifecycle awareness - cleanup on page unload
      // Track if we're doing client-side navigation (to avoid false page_unload events)
      this._isClientSideNav = false;

      window.addEventListener('beforeunload', (_e) => {
        // Only send page_unload if this is a real page unload (not client-side nav)
        if (this._isClientSideNav) {
          this.logger.debug('[Lifecycle] Client-side nav detected, skipping page_unload');
          this._isClientSideNav = false;
          return;
        }

        this.logger.debug('[Lifecycle] Page unloading, notifying backend');
        // Send cleanup notification (best effort - may not complete if page closes quickly)
        if (this.connection && this.connection.isConnected()) {
          try {
            this.connection.send(JSON.stringify({
              event: 'page_unload',
              reason: 'navigation',
              timestamp: Date.now()
            }));
          } catch (err) {
            // Ignore errors during unload (connection might already be closing)
            this.logger.warn('Could not send page_unload message:', err);
          }
        }
      });
    }

    /**
     * Initialize lightweight modules that don't require imports
     * 
     * NOTE: Phase 2 Refactor - Logger/Hooks extracted to bootstrap/ directory
     * Kept inline here due to UMD module limitations (cannot import ES modules at top level)
     * See: src/bootstrap/bootstrap_logger.js and src/bootstrap/bootstrap_hooks.js
     */
    _initLightweightModules() {
      // Determine log level based on deployment environment
      const logLevel = this.zuiConfig?.deployment === 'Production' ? 'WARN' : 'INFO';
      
      // Bootstrap Logger (inline due to UMD constraints)
      // Extracted version: src/bootstrap/bootstrap_logger.js
      this.logger = {
        levels: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
        level: logLevel === 'DEBUG' ? 0 : logLevel === 'INFO' ? 1 : logLevel === 'WARN' ? 2 : 3,
        context: 'Bifrost',
        _interpolate: (message, args) => {
          if (args.length === 0) return message;
          
          // Support Python-style %s interpolation
          if (message.includes('%s')) {
            let result = message;
            args.forEach(arg => {
              result = result.replace('%s', String(arg));
            });
            return result;
          }
          
          return message;
        },
        _formatMessage: (level, message, args = []) => {
          const interpolated = this.logger._interpolate(message, args);
          
          // ANSI color codes for browser console
          const colors = {
            debug: '\x1b[90m',     // Gray for DEBUG
            info: '\x1b[34m',      // Blue for INFO
            warn: '\x1b[33m',      // Yellow for WARN
            error: '\x1b[91m',     // Bright red for ERROR
            message: '\x1b[38;2;255;251;203m',  // Cream #fffbcb for message text
            bold: '\x1b[1m',       // Bold
            reset: '\x1b[0m'
          };
          
          const levelColor = colors[level.toLowerCase()] || colors.info;
          
          return `${colors.bold}${levelColor}[${level}]${colors.reset}: ${colors.message}${interpolated}${colors.reset}`;
        },
        debug: (message, ...args) => {
          if (this.logger.level <= this.logger.levels.DEBUG) {
            const formatted = this.logger._formatMessage('DEBUG', message, args);
            console.debug(formatted, ...args.filter(arg => typeof arg === 'object'));
          }
        },
        info: (message, ...args) => {
          if (this.logger.level <= this.logger.levels.INFO) {
            const formatted = this.logger._formatMessage('INFO', message, args);
            console.info(formatted, ...args.filter(arg => typeof arg === 'object'));
          }
        },
        log: (message, ...args) => {
          if (this.logger.level <= this.logger.levels.INFO) {
            const formatted = this.logger._formatMessage('INFO', message, args);
            console.log(formatted, ...args.filter(arg => typeof arg === 'object'));
          }
        },
        error: (message, ...args) => {
          // Always show errors, regardless of debug mode
          const formatted = this.logger._formatMessage('ERROR', message, args);
          console.error(formatted, ...args.filter(arg => typeof arg === 'object'));

          // Also show in ErrorDisplay for user-facing errors (if initialized)
          if (this.errorDisplay && this.options.showErrors !== false) {
            // Extract error object if present in args
            const errorObj = args.find(arg => arg instanceof Error);
            this.errorDisplay.show({
              title: 'Error',
              message: message,
              error: errorObj || new Error(message),
              timestamp: new Date().toISOString()
            });
          }
        },
        warn: (message, ...args) => {
          if (this.logger.level <= this.logger.levels.WARN) {
            const formatted = this.logger._formatMessage('WARN', message, args);
            console.warn(formatted, ...args.filter(arg => typeof arg === 'object'));
          }
        },
        setLevel: (level) => {
          const levelMap = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
          this.logger.level = levelMap[level] || levelMap.INFO;
        },
        enable: () => {
          this.logger.level = this.logger.levels.DEBUG;
        },
        disable: () => {
          this.logger.level = this.logger.levels.ERROR;
        },
        isEnabled: () => {
          return this.logger.level <= this.logger.levels.INFO;
        }
      };

      // Bootstrap Hooks (inline due to UMD constraints)
      // Extracted version: src/bootstrap/bootstrap_hooks.js
      this.hooks = {
        hooks: this.options.hooks || {},
        errorHandler: null, // Set by _initErrorDisplay()
        call: (hookName, ...args) => {
          const hook = this.hooks.hooks[hookName];
          this.logger.debug(`[Hooks] Calling hook: ${hookName}`);
          if (typeof hook === 'function') {
            try {
              return hook(...args);
            } catch (error) {
              // Log to console
              this.logger.error(`Error in ${hookName} hook:`, error);

              // Log via logger
              this.logger.error(`Error in ${hookName} hook:`, error);

              // Display in UI if error handler is set
              if (this.hooks.errorHandler) {
                try {
                  this.hooks.errorHandler({
                    type: 'hook_error',
                    hookName,
                    error,
                    message: error.message,
                    stack: error.stack
                  });
                } catch (displayError) {
                  this.logger.error('Error handler itself failed:', displayError);
                }
              }

              // Call onError hook if it exists and isn't the one that failed
              if (hookName !== 'onError' && this.hooks.hooks.onError) {
                try {
                  this.hooks.hooks.onError(error);
                } catch (onErrorError) {
                  this.logger.error('onError hook failed:', onErrorError);
                }
              }
            }
          }
        },
        has: (hookName) => {
          return typeof this.hooks.hooks[hookName] === 'function';
        },
        register: (hookName, fn) => {
          if (typeof fn === 'function') {
            this.hooks.hooks[hookName] = fn;
            this.logger.debug(`[Hooks] Registered hook: ${hookName}`);
          } else {
            this.logger.error(`[Hooks] [ERROR] Failed to register hook ${hookName}: not a function`);
          }
        },
        unregister: (hookName) => {
          delete this.hooks.hooks[hookName];
        },
        list: () => Object.keys(this.hooks.hooks),

        // Dark mode utilities
        initBuiltInHooks: () => {
          // Initialize dark mode from localStorage
          const savedTheme = localStorage.getItem('zTheme-mode');
          if (savedTheme === 'dark') {
            this.hooks._applyDarkMode(true);
          }
        },

        _applyDarkMode: async (isDark) => {
          // Use dark mode utility (Layer 2) - eliminates 100+ lines of duplicate code
          const { applyDarkModeClasses } = await import(`${BASE_URL}utils/dark_mode_utils.js`);
          applyDarkModeClasses(isDark, {
            contentArea: this._zVaFElement,
            logger: this.logger
          });
        },

        addDarkModeToggle: async (navElement) => {
          // Use DarkModeToggle widget (extracted for modularity)
          const { DarkModeToggle } = await import(`${BASE_URL}widgets/dark_mode_toggle.js`);
          const darkModeWidget = new DarkModeToggle(this.logger);

          // Create toggle with theme change callback
          darkModeWidget.create(navElement, (newTheme) => {
            // Apply theme
            this.hooks._applyDarkMode(newTheme === 'dark');

            // Call onThemeChange hook if registered
            this.hooks.call('onThemeChange', newTheme);
          });
        }
      };

      // Initialize built-in hooks (dark mode)
      this.hooks.initBuiltInHooks();

      // Register default widget hooks (Week 4.2)
      this._registerDefaultWidgetHooks();

      this.logger.info('BifrostClient initialized', { url: this.url, options: this.options });
    }

    /**
     * Register default hooks for widget events
     *
     * Registers hooks for progress bars, spinners, and swipers.
     * These hooks use the new modular renderer architecture.
     */
    // Phase 5.2: Hook registration delegated to Initializer
    _registerDefaultWidgetHooks() {
      // Kept for backward compatibility - no-op
    }

    async _registerCacheHooks() {
      await this._ensureInitializer();
      return this.initializer.registerCacheHooks();
    }

    async _disableForms() {
      await this._ensureInitializer();
      return this.initializer.disableForms();
    }

    async _enableForms() {
      await this._ensureInitializer();
      return this.initializer.enableForms();
    }

    /**
     * Initialize cache system (v1.6.0)
     * Loads StorageManager, SessionManager, and CacheOrchestrator
     * @private
     */
    async _initCacheSystem() {
      await this._ensureCacheManager();
      return this.cacheManager.initCacheSystem();
    }

    /**
     * Dynamically load a script (v1.6.0)
     * @private
     */
    async _loadScript(src) {
      await this._ensureCacheManager();
      return this.cacheManager.loadScript(src);
    }

    /**
     * Initialize zVaF elements (connection badges, dynamic content)
     *
     * DECLARATIVE APPROACH: The zVaF element is an empty canvas.
     * This method populates it entirely, including connection badge and content area.
     */
    /**
     * Load zTheme CSS and JS from CDN
     * @private
     */
    async _loadZThemeCDN() {
      // Phase 9: Use L1 Foundation CDN loader
      const { loadZThemeCDN } = await import(`${BASE_URL}L1_Foundation/bootstrap/cdn_loader.js`);
      await loadZThemeCDN(this.options.zThemeCDN, this.logger);
    }

    /**
     * Load _zScripts from YAML metadata (plugin scripts)
     * @private
     */
    async _loadZScripts() {
      await this._ensureAssetLoader();
      return this.assetLoader.loadZScripts();
    }

    /**
     * Load Bootstrap Icons from CDN (ALWAYS loaded, unchangeable default)
     * Phase 2: Extracted to src/bootstrap/cdn_loader.js
     * @private
     */
    async _loadBootstrapIcons() {
      const { loadBootstrapIcons } = await import(`${BASE_URL}L1_Foundation/bootstrap/cdn_loader.js`);
      await loadBootstrapIcons(undefined, this.logger);
    }

    /**
     * Load Prism.js from CDN for syntax highlighting
     * Phase 5.4: Delegated to AssetLoader
     * @private
     */
    async _loadPrismJS() {
      await this._ensureAssetLoader();
      return this.assetLoader.loadPrismJS();
    }

    /**
     * Load custom .zolo language definitions for Prism.js
     * Phase 5.4: Delegated to AssetLoader
     * @private
     */
    async _loadPrismZolo() {
      await this._ensureAssetLoader();
      return this.assetLoader.loadPrismZolo();
    }

    /**
     * Load and render declarative UI from zVaFile (client-side YAML parsing)
     * @private
     */
    /**
     * Render a zVaF block declaratively (convert YAML to DOM)
     * @private
     */
    // Phase 5.1: Rendering methods delegated to RenderingFacade
    async _renderBlock(blockData) {
      await this._ensureRenderingFacade();
      return this.renderingFacade.renderBlock(blockData);
    }

    async _renderChunkProgressive(message) {
      await this._ensureRenderingFacade();
      return this.renderingFacade.renderChunkProgressive(message);
    }

    async _renderItems(data, parentElement) {
      await this._ensureRenderingFacade();
      return this.renderingFacade.renderItems(data, parentElement);
    }

    async _createContainer(zKey, metadata) {
      await this._ensureRenderingFacade();
      return this.renderingFacade.createContainer(zKey, metadata);
    }

    async _renderMetaNavBarHTML(items) {
      await this._ensureRenderingFacade();
      return this.renderingFacade.renderMetaNavBarHTML(items);
    }

    async _renderNavBar(items, parentElement) {
      await this._ensureRenderingFacade();
      return this.renderingFacade.renderNavBar(items, parentElement);
    }

    async _renderZDisplayEvent(eventData) {
      await this._ensureRenderingFacade();
      return this.renderingFacade.renderZDisplayEvent(eventData);
    }

    /**
     * Initialize zVaF-specific DOM elements (connection badges, etc.)
     * @private
     */
    /**
     * Initialize zVaF elements (v1.6.0: Simplified - elements exist in HTML, just populate)
     *
     * HTML structure (declared in zVaF.html):
     *   <zBifrostBadge></zBifrostBadge>  ← Dynamic, always fresh
     *   <zNavBar></zNavBar>              ← Dynamic, RBAC-aware
     *   <zVaF>...</zVaF>                 ← Cacheable content area
     */
    // Phase 5.2: Initialization methods delegated to Initializer
    async _initZVaFElements() {
      await this._ensureInitializer();
      return this.initializer.initZVaFElements();
    }

    async _populateConnectionBadge() {
      await this._ensureInitializer();
      return this.initializer.populateConnectionBadge();
    }

    async _updateBadgeState(state) {
      await this._ensureInitializer();
      return this.initializer.updateBadgeState(state);
    }

    async _populateNavBar() {
      await this._ensureInitializer();
      return this.initializer.populateNavBar();
    }

    async _fetchAndPopulateNavBar(navHtmlFromServer = null) {
      await this._ensureInitializer();
      return this.initializer.fetchAndPopulateNavBar(navHtmlFromServer);
    }

    async _enableClientSideNavigation() {
      await this._ensureInitializer();
      return this.initializer.enableClientSideNavigation();
    }

    async _navigateToRoute(routePath, options = {}) {
      await this._ensureInitializer();
      return this.initializer.navigateToRoute(routePath, options);
    }


    /**
     * Lazy load a module
     * @param {string} moduleName - Name of the module (connection, message_handler, renderer, zdisplay_renderer)
     * @returns {Promise<any>}
     */
    /**
     * Ensure RenderingFacade is initialized (Phase 5.1)
     * @private
     */
    async _ensureRenderingFacade() {
      if (!this.renderingFacade) {
        const { RenderingFacade } = await import(`${BASE_URL}L4_Orchestration/rendering/facade.js`);
        this.renderingFacade = new RenderingFacade(this);
      }
      return this.renderingFacade;
    }

    /**
     * Ensure Initializer is loaded (Phase 5.2)
     * @private
     */
    async _ensureInitializer() {
      if (!this.initializer) {
        const { Initializer } = await import(`${BASE_URL}L4_Orchestration/lifecycle/initializer.js`);
        this.initializer = new Initializer(this);
      }
      return this.initializer;
    }

    async _ensureAssetLoader() {
      if (!this.assetLoader) {
        const { AssetLoader } = await import(`${BASE_URL}L4_Orchestration/lifecycle/asset_loader.js`);
        this.assetLoader = new AssetLoader(this);
      }
      return this.assetLoader;
    }

    /**
     * Ensure RendererRegistry is loaded (Task 0.2)
     * @private
     */
    async _ensureRendererRegistry() {
      if (!this.rendererRegistry) {
        const { RendererRegistry } = await import(`${BASE_URL}L4_Orchestration/facade/renderer_registry.js`);
        this.rendererRegistry = new RendererRegistry(this);
      }
      return this.rendererRegistry;
    }

    /**
     * Ensure ManagerRegistry is loaded (Task 0.3)
     * @private
     */
    async _ensureManagerRegistry() {
      if (!this.managerRegistry) {
        const { ManagerRegistry } = await import(`${BASE_URL}L4_Orchestration/facade/manager_registry.js`);
        this.managerRegistry = new ManagerRegistry(this);
      }
      return this.managerRegistry;
    }

    async _loadModule(moduleName) {
      if (this._modules[moduleName]) {
        return this._modules[moduleName];
      }

      // Phase 9: Use L1 Foundation MODULE_REGISTRY for SSOT module paths
      // Lazy-load the registry (ES module import in UMD context)
      if (!this._moduleRegistry) {
        const registryModule = await import(`${BASE_URL}L1_Foundation/bootstrap/module_registry.js`);
        this._moduleRegistry = registryModule.MODULE_REGISTRY;
        this._getModulePath = registryModule.getModulePath;
      }

      // Get module path from registry
      const modulePath = this._getModulePath(moduleName);
      if (!modulePath) {
        this.logger.error(`Module not found in registry: ${moduleName}`);
        throw new Error(`Unknown BifrostClient module: ${moduleName}`);
      }

      const fullPath = `${this._baseUrl}${modulePath}`;
      this.logger.debug(`Loading module: ${moduleName} from ${fullPath}`);

      try {
        const module = await import(fullPath);
        this._modules[moduleName] = module;
        return module;
      } catch (error) {
        this.logger.error(`Failed to load module ${moduleName}:`, error);
        throw new Error(`Failed to load BifrostClient module: ${moduleName}`);
      }
    }

    // ==========================================
    // Module Loaders (_ensure* methods)
    // Phase 5.3: Organized by category for clarity
    // ==========================================

    // Connection & Message Handling
    async _ensureConnection() {
      if (!this.connection) {
        const { WebSocketConnection } = await import(`${BASE_URL}L1_Foundation/connection/websocket_connection.js`);
        this.connection = new WebSocketConnection(this.url, this.logger, this.hooks, this.options);
      }
      return this.connection;
    }

    async _ensureMessageHandler() {
      if (!this.messageHandler) {
        const { MessageHandler } = await this._loadModule('message_handler');
        this.messageHandler = new MessageHandler(this.logger, this.hooks, this);
        this.messageHandler.setTimeout(this.options.timeout);
      }
      return this.messageHandler;
    }

    // Renderers - Core
    async _ensureRenderer() {
      if (!this.renderer) {
        const { Renderer } = await this._loadModule('renderer');
        this.renderer = new Renderer(this.logger);
      }
      return this.renderer;
    }

    async _ensureNavigationRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.navigationRenderer = await registry.ensureRenderer('navigation');
      return this.navigationRenderer;
    }

    // Renderers - Outputs (Typography, Text, Images, Icons, etc.)
    // Consolidated via RendererRegistry (Task 0.2)
    async _ensureTypographyRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.typographyRenderer = await registry.ensureRenderer('typography');
      return this.typographyRenderer;
    }

    async _ensureTextRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.textRenderer = await registry.ensureRenderer('text');
      return this.textRenderer;
    }

    async _ensureCodeRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.codeRenderer = await registry.ensureRenderer('code');
      return this.codeRenderer;
    }

    async _ensureCardRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.cardRenderer = await registry.ensureRenderer('card');
      return this.cardRenderer;
    }

    async _ensureButtonRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.buttonRenderer = await registry.ensureRenderer('button');
      return this.buttonRenderer;
    }

    async _ensureTableRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.tableRenderer = await registry.ensureRenderer('table');
      return this.tableRenderer;
    }

    async _ensureListRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.listRenderer = await registry.ensureRenderer('list');
      return this.listRenderer;
    }

    async _ensureImageRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.imageRenderer = await registry.ensureRenderer('image');
      return this.imageRenderer;
    }

    async _ensureIconRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.iconRenderer = await registry.ensureRenderer('icon');
      return this.iconRenderer;
    }

    // Renderers - Composite (Dashboard, Swiper, etc.)
    // Consolidated via RendererRegistry (Task 0.2)
    async _ensureDashboardRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.dashboardRenderer = await registry.ensureRenderer('dashboard');
      return this.dashboardRenderer;
    }

    async _ensureSwiperRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.swiperRenderer = await registry.ensureRenderer('swiper');
      return this.swiperRenderer;
    }

    // Renderers - Feedback (Spinner, ProgressBar)
    // Consolidated via RendererRegistry (Task 0.2)
    async _ensureSpinnerRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.spinnerRenderer = await registry.ensureRenderer('spinner');
      return this.spinnerRenderer;
    }

    async _ensureProgressBarRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.progressBarRenderer = await registry.ensureRenderer('progressBar');
      return this.progressBarRenderer;
    }

    // Orchestrators
    async _ensureZDisplayOrchestrator() {
      if (!this.zDisplayOrchestrator) {
        const { ZDisplayOrchestrator } = await import(`${BASE_URL}L2_Handling/display/orchestration/zdisplay_orchestrator.js`);
        this.zDisplayOrchestrator = new ZDisplayOrchestrator(this);
        this.logger.debug('ZDisplayOrchestrator loaded');
      }
      return this.zDisplayOrchestrator;
    }

    // Renderers - Specialized (Wizard, Terminal, Form, Menu)
    async _ensureWizardConditionalRenderer() {
      if (!this.wizardConditionalRenderer) {
        const { WizardConditionalRenderer } = await import(`${BASE_URL}L2_Handling/display/composite/wizard_conditional_renderer.js`);
        this.wizardConditionalRenderer = new WizardConditionalRenderer(this.logger);
        this.logger.debug('WizardConditionalRenderer loaded');
      }
      return this.wizardConditionalRenderer;
    }

    async _ensureTerminalRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.terminalRenderer = await registry.ensureRenderer('terminal');
      return this.terminalRenderer;
    }

    // Managers (Cache, ZVaF, Navigation, Hooks)
    // Consolidated via ManagerRegistry (Task 0.3)
    async _ensureCacheManager() {
      const registry = await this._ensureManagerRegistry();
      this.cacheManager = await registry.ensureManager('cache');
      return this.cacheManager;
    }

    async _ensureZVaFManager() {
      const registry = await this._ensureManagerRegistry();
      this.zvafManager = await registry.ensureManager('zvaf');
      return this.zvafManager;
    }

    async _ensureNavigationManager() {
      const registry = await this._ensureManagerRegistry();
      this.navigationManager = await registry.ensureManager('navigation');
      return this.navigationManager;
    }

    async _ensureWidgetHookManager() {
      const registry = await this._ensureManagerRegistry();
      this.widgetHookManager = await registry.ensureManager('widgetHook');
      return this.widgetHookManager;
    }

    async _ensureDLRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.dlRenderer = await registry.ensureRenderer('dl');
      return this.dlRenderer;
    }

    async _ensureFormRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.formRenderer = await registry.ensureRenderer('form');
      return this.formRenderer;
    }

    async _ensureMenuRenderer() {
      const registry = await this._ensureRendererRegistry();
      this.menuRenderer = await registry.ensureRenderer('menu');
      return this.menuRenderer;
    }


    // 
    // Connection Management
    // 

    // Error Display
    async _ensureErrorDisplay() {
      if (this.options.showErrors === false) {
        return;
      } // Allow disabling

      if (!this.errorDisplay) {
        const { ErrorDisplay } = await this._loadModule('error_display');
        this.errorDisplay = new ErrorDisplay({
          position: this.options.errorPosition || 'top-right',
          maxErrors: this.options.maxErrors || 5,
          autoDismiss: this.options.autoDismiss || 10000  // TIMEOUTS.AUTO_DISMISS (UMD limitation, can't import)
        });

        // Set error handler for hooks
        this.hooks.errorHandler = (errorInfo) => {
          this.errorDisplay.show(errorInfo);
        };

        this.logger.debug('[ErrorDisplay] Initialized');
      }
      return this.errorDisplay;
    }

    /**
     * Check if running on file:// protocol (which doesn't support ES6 module imports)
     * @private
     */
    _isFileProtocol() {
      return typeof window !== 'undefined' && window.location.protocol === 'file:';
    }

    /**
     * Connect to the WebSocket server
     * @returns {Promise<void>}
     */
    async connect() {
      // Skip module loading for file:// protocol (ES6 imports not supported)
      const isFileProtocol = this._isFileProtocol();

      if (isFileProtocol) {
        this.logger.warn('[file://] Skipping module loading (use HTTP server)');
        this.logger.debug('[file://] Error display and auto-rendering disabled');
      }

      // Initialize error display (for visual error boundaries) - skip on file://
      if (!isFileProtocol && this.options.showErrors !== false) {
        try {
          await this._ensureErrorDisplay();
        } catch (error) {
          this.logger.warn('Error display failed to load:', error.message);
        }
      }

      // Initialize widget hook manager (for auto-rendering zDisplay events) - skip on file://
      if (!isFileProtocol) {
        try {
          await this._ensureWidgetHookManager();
          await this.widgetHookManager.registerAllWidgetHooks();
        } catch (error) {
          this.logger.warn('Widget hooks failed to load:', error.message);
        }
      }

      // Load theme BEFORE connecting to prevent FOUC (Flash of Unstyled Content)
      // Load required modules
      await this._ensureConnection();
      await this._ensureMessageHandler();

      await this.connection.connect();

      // Set up message handler
      this.connection.onMessage((event) => {
        this.messageHandler.handleMessage(event.data);
      });

      // Auto-send request if specified (Swiper-style elegance!)
      if (this.options.autoRequest) {
        const request = typeof this.options.autoRequest === 'string'
          ? { event: this.options.autoRequest }
          : this.options.autoRequest;

        // For execute_walker requests, use fire-and-forget (chunks come asynchronously)
        // For other requests, use send() to wait for response
        if (request.event === 'execute_walker') {
          this.logger.debug('Auto-sending walker request', request);
          this.connection.send(JSON.stringify(request));
        } else {
          this.logger.debug('Auto-sending request', request);
          this.send(request);
        }
      }
    }

    /**
     * Disconnect from the server
     */
    disconnect() {
      if (this.connection) {
        this.connection.disconnect();
      }
    }

    /**
     * Check if connected
     * @returns {boolean}
     */
    isConnected() {
      return this.connection ? this.connection.isConnected() : false;
    }

    // 
    // Message Sending
    // 

    /**
     * Send a message and wait for response
     * @param {Object} payload - Message payload
     * @param {number} timeout - Custom timeout (optional)
     * @returns {Promise<any>}
     */
    async send(payload, timeout = null) {
      if (!this.isConnected()) {
        throw new Error('Not connected to server. Call connect() first.');
      }

      await this._ensureMessageHandler();

      return this.messageHandler.send(
        payload,
        (msg) => this.connection.send(msg),
        timeout
      );
    }

    /**
     * Send input response to server
     * @param {string} requestId - Request ID from input event
     * @param {any} value - Input value
     */
    sendInputResponse(requestId, value) {
      if (!this.isConnected()) {
        this.logger.log('[ERROR] Cannot send input response: not connected');
        return;
      }

      // Use new event protocol
      const message = JSON.stringify({
        event: 'input_response',
        requestId: requestId,
        value: value
      });

      this.connection.send(message);
    }

    // 
    // CRUD Operations
    // 

    /**
     * Create a new record
     * @param {string} model - Table/model name
     * @param {Object} data - Field values
     * @returns {Promise<Object>}
     */
    async create(model, data) {
      return this.send({
        event: 'dispatch',
        zKey: `^Create ${model}`,
        model: model,
        data: data
      });
    }

    /**
     * Read records
     * @param {string} model - Table/model name
     * @param {Object} filters - WHERE conditions (optional)
     * @param {Object} options - Additional options (fields, order_by, limit, offset)
     * @returns {Promise<Array>}
     */
    async read(model, filters = null, options = {}) {
      const payload = {
        event: 'dispatch',
        zKey: `^List ${model}`,
        model: model
      };

      if (filters) {
        payload.where = filters;
      }
      if (options.fields) {
        payload.fields = options.fields;
      }
      if (options.order_by) {
        payload.order_by = options.order_by;
      }
      if (options.limit !== undefined) {
        payload.limit = options.limit;
      }
      if (options.offset !== undefined) {
        payload.offset = options.offset;
      }

      return this.send(payload);
    }

    /**
     * Update record(s)
     * @param {string} model - Table/model name
     * @param {Object|number} filters - WHERE conditions or ID
     * @param {Object} data - Fields to update
     * @returns {Promise<Object>}
     */
    async update(model, filters, data) {
      if (typeof filters === 'number') {
        filters = { id: filters };
      }

      return this.send({
        event: 'dispatch',
        zKey: `^Update ${model}`,
        model: model,
        where: filters,
        data: data
      });
    }

    /**
     * Delete record(s)
     * @param {string} model - Table/model name
     * @param {Object|number} filters - WHERE conditions or ID
     * @returns {Promise<Object>}
     */
    async delete(model, filters) {
      if (typeof filters === 'number') {
        filters = { id: filters };
      }

      return this.send({
        event: 'dispatch',
        zKey: `^Delete ${model}`,
        model: model,
        where: filters
      });
    }

    // 
    // zCLI Operations
    // 

    /**
     * Execute a zFunc command
     * @param {string} command - zFunc command string
     * @returns {Promise<any>}
     */
    async zFunc(command) {
      return this.send({
        zKey: 'zFunc',
        zHorizontal: command
      });
    }

    /**
     * Navigate to a zLink path
     * @param {string} path - zLink navigation path
     * @returns {Promise<any>}
     */
    async zLink(path) {
      return this.send({
        zKey: 'zLink',
        zHorizontal: `zLink(${path})`
      });
    }

    /**
     * Execute a zOpen command
     * @param {string} command - zOpen command string
     * @returns {Promise<any>}
     */
    async zOpen(command) {
      return this.send({
        zKey: 'zOpen',
        zHorizontal: `zOpen(${command})`
      });
    }


    // 
    // Auto-Rendering Methods (Using zTheme)
    // 

    /**
     * Render data as a table with zTheme styling
     * @param {Array} data - Array of objects to render
     * @param {string|HTMLElement} container - Container selector or element
     * @param {Object} options - Rendering options
     */
    async renderTable(data, container, options = {}) {
      await this._ensureRenderer();
      this.renderer.renderTable(data, container, options);
    }

    /**
     * Render a menu with buttons
     * @param {Array} items - Array of menu items {label, action, icon, variant}
     * @param {string|HTMLElement} container - Container selector or element
     */
    async renderMenu(items, container) {
      await this._ensureRenderer();
      this.renderer.renderMenu(items, container);
    }

    /**
     * Render a form with zTheme styling
     * @param {Array} fields - Array of field definitions
     * @param {string|HTMLElement} container - Container selector or element
     * @param {Function} onSubmit - Submit handler
     */
    async renderForm(fields, container, onSubmit) {
      await this._ensureRenderer();
      this.renderer.renderForm(fields, container, onSubmit);
    }

    /**
     * Render a message/alert
     * @param {string} text - Message text
     * @param {string} type - Message type (success, error, warning, info)
     * @param {string|HTMLElement} container - Container selector or element
     * @param {number} duration - Auto-hide duration in ms (default: 5000 = TIMEOUTS.AUTO_DISMISS_SHORT)
     */
    async renderMessage(text, type = 'info', container, duration = 5000) {  // TIMEOUTS.AUTO_DISMISS_SHORT
      await this._ensureRenderer();
      this.renderer.renderMessage(text, type, container, duration);
    }

    // 
    // Dashboard Rendering (zDash Event)
    // 

    // NOTE: Dashboard rendering has been extracted to dashboard_renderer.js
    // The onZDash hook now uses the DashboardRenderer class (see _ensureDashboardRenderer)
    // Legacy methods below are kept for backward compatibility but should not be used directly

    // 
    // Hook Management
    // 

    /**
     * Register a new hook at runtime
     * @param {string} hookName - Name of the hook
     * @param {Function} fn - Hook function
     */
    registerHook(hookName, fn) {
      this.hooks.register(hookName, fn);
    }

    /**
     * Unregister a hook
     * @param {string} hookName - Name of the hook
     */
    unregisterHook(hookName) {
      this.hooks.unregister(hookName);
    }

    /**
     * List all registered hooks
     * @returns {Array<string>}
     */
    listHooks() {
      return this.hooks.list();
    }
  }

// ES module export — bootstrap does: const { BifrostCore } = await import(bifrost_core_url)
export { BifrostCore };
