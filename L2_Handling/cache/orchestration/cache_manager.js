/**
 * CacheManager - Manages offline-first caching, storage, and session
 *
 * Responsibilities:
 * - Initialize StorageManager, SessionManager, CacheOrchestrator
 * - Initialize HTTPCacheManager for conditional requests
 * - Register cache-related hooks (onConnectionInfo, onDisconnected, onConnected)
 * - Handle offline/online transitions
 * - Disable/enable forms during offline mode
 * - Dynamic script loading for cache modules
 *
 * Extracted from bifrost_client.js (Phase 3.1)
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 3: Managers
import { HTTPCacheManager } from './http_cache_manager.js';

export class CacheManager {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
    this.hooks = client.hooks;
    this._baseUrl = client._baseUrl;
  }

  /**
   * Initialize cache system (v1.6.0)
   * Loads StorageManager, SessionManager, and CacheOrchestrator
   */
  async initCacheSystem() {
    try {
      // Check if running in browser
      if (typeof window === 'undefined') {
        this.logger.debug('[Cache] Skipping (not in browser)');
        return;
      }

      this.logger.debug('[Cache] Loading cache modules');

      // Dynamically load cache modules (maintains single-import philosophy)
      await this.loadScript(`${this._baseUrl}L2_Handling/cache/storage/storage_manager.js`);
      await this.loadScript(`${this._baseUrl}L2_Handling/cache/storage/session_manager.js`);
      await this.loadScript(`${this._baseUrl}L2_Handling/cache/orchestration/cache_orchestrator.js`);

      // Verify modules loaded
      if (typeof window.StorageManager === 'undefined' ||
          typeof window.SessionManager === 'undefined' ||
          typeof window.CacheOrchestrator === 'undefined') {
        this.logger.debug('[Cache] Module loading failed, cache disabled');
        return;
      }

      this.logger.debug('[Cache] Cache modules loaded');

      // Initialize storage
      this.client.storage = new window.StorageManager('zBifrost', this.logger);
      await this.client.storage.init();
      this.logger.debug('[Cache] Storage initialized');

      // Initialize session
      this.client.session = new window.SessionManager(this.client.storage, this.logger);
      await this.client.session.init();
      this.logger.debug('[Cache] Session initialized');

      // Initialize cache orchestrator
      this.client.cache = new window.CacheOrchestrator(this.client.storage, this.client.session, this.logger);
      await this.client.cache.init();
      this.logger.debug('[Cache] Cache orchestrator initialized');

      // Initialize HTTP cache manager for conditional requests
      this.client.httpCache = new HTTPCacheManager(this.client);
      
      // Single summary log
      this.logger.debug('[Cache] Cache system ready (storage, session, orchestrator, HTTP cache)');

    } catch (error) {
      this.logger.error('[Cache] Initialization error:', error);
      // Non-fatal: cache is optional, BifrostClient will work without it
    }
  }

  /**
   * Dynamically load a script (v1.6.0)
   * @param {string} src - Script URL
   */
  loadScript(src) {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      // Note: Script loading uses native createElement (not a primitive, as scripts are not visual elements)
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  /**
   * Register cache-related hooks
   */
  registerCacheHooks() {
    // v1.6.0: Register hook to populate session from connection_info
    this.hooks.register('onConnectionInfo', async (data) => {
      try {
        // 2A: Server-version-gated cache bust
        // server_version is sent on every connect — if it changed since last load,
        // the browser may be serving stale JS modules (304 cache). Reload to flush.
        const incomingVersion = data.server_version;
        if (incomingVersion) {
          const storedVersion = sessionStorage.getItem('zOS_server_version');
          if (storedVersion && storedVersion !== incomingVersion) {
            this.logger.log(`[Cache] Server version changed (${storedVersion} → ${incomingVersion}), reloading to bust JS cache`);
            sessionStorage.setItem('zOS_server_version', incomingVersion);
            window.location.reload();
            return;
          }
          sessionStorage.setItem('zOS_server_version', incomingVersion);
        }

        if (!this.client.session) {
          this.logger.debug('[Cache] Session not initialized yet, skipping');
          return;
        }

        const sessionData = data.session;
        if (!sessionData) {
          this.logger.debug('[Cache] No session data in connection_info');
          return;
        }

        // Get OLD auth state before updating
        const wasAuthenticated = this.client.session.isAuthenticated();
        const oldSessionHash = this.client.session.getHash();

        // Populate session with backend data
        if (sessionData.authenticated && sessionData.session_hash) {
          await this.client.session.setPublicData({
            username: sessionData.username,
            role: sessionData.role,
            session_hash: sessionData.session_hash,
            app: sessionData.active_app
          });
          this.logger.log(`[Cache] Session populated: ${sessionData.username} (${sessionData.role})`);
        } else {
          this.logger.debug('[Cache] User not authenticated, session remains anonymous');
        }

        // Get NEW auth state after updating
        const isNowAuthenticated = this.client.session.isAuthenticated();
        const newSessionHash = this.client.session.getHash();

        // 3A: If server sent nav_html in connection_info, always refresh the navbar
        // This keeps the nav correct after reconnect even without an auth change.
        const navHtml = data.nav_html || null;
        if (navHtml) {
          await this.client._fetchAndPopulateNavBar(navHtml);
          this.logger.log('[NavBar] Navbar refreshed from connection_info nav_html (3A)');
        } else if (wasAuthenticated !== isNowAuthenticated || oldSessionHash !== newSessionHash) {
          // Legacy path: auth change detected — re-fetch from API
          this.logger.log('[NavBar] Auth state changed - fetching fresh navbar from API');
          await this.client._fetchAndPopulateNavBar();
          this.logger.log('[NavBar] Navbar updated after auth change');
        }
      } catch (error) {
        this.logger.error('[Cache] Error populating session:', error);
      }
    });

    // v1.6.0: Offline-first - Handle disconnect + Badge update (combined hook)
    this.hooks.register('onDisconnected', async (_reason) => {
      try {
        this.logger.debug('[Cache] Connection lost, entering offline mode');

        // Update badge (v1.6.0: Combined with cache hook to avoid conflicts)
        await this.client._updateBadgeState('disconnected');

        // Cache zVaF content for offline access (badge/navbar are dynamic, re-populated on page load)
        if (this.client.cache && typeof document !== 'undefined') {
          const currentPage = window.location.pathname;
          const contentArea = this.client._zVaFElement;
          if (contentArea) {
            await this.client.cache.set(currentPage, contentArea.outerHTML, 'rendered');
            this.logger.log(`[Cache] Cached content for offline: ${currentPage}`);
          }
        }

        // Disable forms (prevent data loss)
        this.disableForms();

      } catch (error) {
        this.logger.error('[Cache] Error handling disconnect:', error);
      }
    });

    // v1.6.0: Offline-first - Handle reconnect + Badge update (combined hook)
    this.hooks.register('onConnected', async (_data) => {
      try {
        this.logger.debug('[Cache] Connection restored, exiting offline mode');

        // Update badge (v1.6.0: Combined with cache hook to avoid conflicts)
        await this.client._updateBadgeState('connected');

        // Re-enable forms
        this.enableForms();

      } catch (error) {
        this.logger.error('[Cache] Error handling reconnect:', error);
      }
    });
  }

  /**
   * Disable all forms during offline mode (v1.6.0)
   */
  disableForms() {
    if (typeof document === 'undefined') {
      return;
    }

    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      form.setAttribute('data-offline-disabled', 'true');
      const inputs = form.querySelectorAll('input, textarea, select, button');
      inputs.forEach(input => input.disabled = true);
    });

    this.logger.log('[Offline] [WARN]  Forms disabled (offline mode)');
  }

  /**
   * Re-enable forms after reconnecting (v1.6.0)
   */
  enableForms() {
    if (typeof document === 'undefined') {
      return;
    }

    const forms = document.querySelectorAll('form[data-offline-disabled]');
    forms.forEach(form => {
      form.removeAttribute('data-offline-disabled');
      const inputs = form.querySelectorAll('input, textarea, select, button');
      inputs.forEach(input => input.disabled = false);
    });

    this.logger.debug('[Offline] Forms re-enabled');
  }
}

export default CacheManager;

