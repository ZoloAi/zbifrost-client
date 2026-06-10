/**
 * NavigationManager - Handles client-side navigation (SPA-style routing)
 *
 * Responsibilities:
 * - Enable client-side navigation (intercept clicks on navbar links)
 * - Handle browser back/forward buttons (popstate)
 * - Navigate to routes via WebSocket (no page reload)
 * - Fetch route configuration from backend
 * - Send walker execution requests
 * - Update browser URL without reload
 *
 * Extracted from bifrost_client.js (Phase 3.3)
 */

export class NavigationManager {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
  }

  /**
   * Enable client-side navigation (SPA-style routing)
   *
   *  REFACTORED: Global click handler removed in favor of individual link handlers
   *
   * Previously, this method attached a global click handler to intercept ALL navbar links.
   * Now, individual links (rendered via link_primitives.js) have their own handlers.
   * This is cleaner, more maintainable, and aligns with primitive-driven architecture.
   *
   * The global handler was causing conflicts (stopPropagation prevented individual handlers).
   * Individual handlers are the single source of truth for link behavior.
   */
  enableClientSideNavigation() {
    if (typeof document === 'undefined') {
      return;
    }

    // Remove legacy global handler if it exists (cleanup from old implementation)
    if (this.client._navClickHandler) {
      document.removeEventListener('click', this.client._navClickHandler, true);
      this.client._navClickHandler = null;
      this.logger.debug('[ClientNav] Removed legacy global click handler');
    }

    // Individual links now handle their own clicks via link_primitives.js
    // No global handler needed - each link has its own addEventListener('click', ...)
    // This is the primitive-driven way: each component manages its own behavior

    this.logger.info('[ClientNav] Client-side navigation enabled');

    // Handle browser back/forward buttons
    if (!this.client._popstateHandler) {
      this.client._popstateHandler = async (_e) => {
        this.logger.debug('[ClientNav] Browser back/forward detected');
        const path = window.location.pathname;

        // An in-page zBack button routes a cross-file step-out through
        // history.back() and flags intent — carry it so the server consumes the
        // crumb's origin section (zPsi), mirroring zCLI's start_key resume. A
        // plain browser Back/Fwd leaves the flag unset and renders from the top
        // (browser-history-vs-crumbs reconciliation is deferred).
        const zBack = !!this.client._pendingZBack;
        this.client._pendingZBack = false;
        await this.navigateToRoute(path, { skipHistory: true, zBack });
      };

      window.addEventListener('popstate', this.client._popstateHandler);
    }

    this.logger.debug('[ClientNav] Enabled');
  }

  /**
   * Apply a destination route's navbar on SPA navigation (SSOT: server-resolved).
   *
   * The navbar is persistent chrome populated once on full-page load. On a
   * client-side jump (zLink / link click / popstate) the server returns the
   * destination's resolved navbar in route-config: `nav_html` (prebuilt,
   * RBAC-filtered) and `navbar` (resolved items, or null). We MUST re-apply it
   * here — otherwise the previous page's navbar lingers when you land on a
   * `zNavBar: false` page (and a page with a different navbar shows the wrong one).
   *
   * @param {Object} routeConfig - Parsed /api/route-config payload
   * @private
   */
  _applyRouteNavBar(routeConfig) {
    const el = this.client._zNavBarElement;
    if (!el) return;

    const navHtml = routeConfig && routeConfig.nav_html;
    const navItems = routeConfig && routeConfig.navbar;
    const wantsNavbar = !!(navHtml || (Array.isArray(navItems) && navItems.length));

    // Keep zuiConfig.zMeta in sync with the destination so a later reconnect's
    // per-page opt-out guard (cache_manager) reads THIS page's zNavBar, not the
    // entry page's — otherwise an SPA hop to a zNavBar:false page would re-show
    // the global navbar if the socket reconnects.
    if (this.client.zuiConfig && routeConfig && routeConfig.zMeta) {
      this.client.zuiConfig.zMeta = routeConfig.zMeta;
    }

    if (!wantsNavbar) {
      // Destination opted out (zNavBar: false / no navbar) — hide the chrome.
      el.style.display = 'none';
      el.innerHTML = '';
      this.logger.debug('[ClientNav] Destination has no navbar — hiding chrome');
      return;
    }

    // Destination wants a navbar — make sure the chrome is visible and refreshed
    // from the server's prebuilt HTML (reuse the SSOT populate path so events
    // are wired and client-side nav re-enabled). Keep zuiConfig in sync so later
    // bounce-back refreshes reuse THIS page's navbar, not the entry page's.
    el.style.display = '';
    if (this.client.zuiConfig) {
      this.client.zuiConfig.nav_html = navHtml || this.client.zuiConfig.nav_html;
      this.client.zuiConfig.zNavBar = navItems || this.client.zuiConfig.zNavBar;
    }
    if (navHtml && typeof this.client._fetchAndPopulateNavBar === 'function') {
      this.client._fetchAndPopulateNavBar(navHtml).catch((err) =>
        this.logger.error('[ClientNav] navbar populate failed:', err)
      );
    }
  }

  /**
   * Navigate to a route via WebSocket (client-side navigation)
   * @param {string} routePath - Path to navigate to (e.g., '/zAbout', '/zAccount')
   * @param {Object} options - Navigation options
   */
  async navigateToRoute(routePath, options = {}) {
    const { skipHistory = false, navbar = false, zOrigin = null, zBack = false } = options;

    this.client._isClientSideNav = true;

    try {
      this.logger.info('[ClientNav] Navigating to: %s', routePath);

      // 2B: Python owns route resolution — ask the server for walker params
      const res = await fetch(`/api/route-config?path=${encodeURIComponent(routePath)}`);
      if (!res.ok) {
        throw new Error(`Route not found: ${routePath} (${res.status})`);
      }
      const routeConfig = await res.json();
      const { zBlock, zVaFile, zVaFolder, zMeta } = routeConfig;

      this.logger.debug('[ClientNav] Route config', { zVaFile, zVaFolder, zBlock });

      // Per-page navbar (SSOT: server-resolved via route-config). A full-page
      // load honors each page's zNavBar; SPA arrivals must too, or the entry
      // page's navbar chrome lingers on a zNavBar:false landing. The server is
      // the single authority — it returns resolved `navbar` items + prebuilt
      // `nav_html`; the client just shows/hides + injects.
      this._applyRouteNavBar(routeConfig);

      // Inject page-specific zBrush CSS (not loaded by full-page <head> on SPA nav)
      const brushes = zMeta?.zBrush
        ? (Array.isArray(zMeta.zBrush) ? zMeta.zBrush : [zMeta.zBrush])
        : [];
      brushes.forEach(brush => {
        const href = `/styles/${brush}.css`;
        if (!document.querySelector(`link[href="${href}"]`)) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          document.head.appendChild(link);
          this.logger.debug('[ClientNav] Injected zBrush CSS:', href);
        }
      });

      // Clear current content and show loading state
      if (this.client._zVaFElement) {
        this.client._zVaFElement.innerHTML = '<div class="zText-center zp-4">Loading...</div>';
      }

      // Send walker execution request via WebSocket.
      // navbar:true signals navbar-origin so the server RESETs the crumb trail
      // (SSOT mirror of zCLI navbar navigation — the pick becomes the new root).
      const walkerRequest = { event: 'execute_walker', zBlock, zVaFile, zVaFolder };
      if (navbar) walkerRequest.navbar = true;
      // SSOT click-crumb: carry the section the zLink launched FROM so the server
      // records it on the departing scope (same field zDelta uses — verb-agnostic).
      if (zOrigin) walkerRequest.zOrigin = zOrigin;
      // Crumb-driven back: tell the server to consume the parent scope's origin
      // section and return it as a zPsi scroll target (Step 2).
      if (zBack) walkerRequest.zBack = true;
      this.logger.debug('[ClientNav] Sending walker request', walkerRequest);
      this.client.connection.send(JSON.stringify(walkerRequest));

      // Timeout if backend doesn't respond
      this.client._navigationTimeout = setTimeout(() => {
        if (this.client._zVaFElement?.innerHTML.includes('Loading...')) {
          this.logger.warn('[ClientNav] Walker request timeout - no chunks received after 10s');
          this.client._zVaFElement.innerHTML = `<div class="zAlert zAlert-warning zmt-4">
            <strong>Loading Timeout:</strong> Backend did not respond.<br>
            <small>Check terminal logs for errors.</small></div>`;
        }
      }, 10000);

      // Don't yank to the top on a crumb-driven back — the zPsi handler will land
      // on the origin section once the chunks paint. Forward navs still reset.
      if (!zBack) window.scrollTo({ top: 0, behavior: 'smooth' });

      // Update browser URL (skip for popstate — URL already correct)
      if (!skipHistory) {
        const newUrl = routePath.startsWith('/') ? routePath : `/${routePath}`;
        history.pushState({ route: routePath }, '', newUrl);
      }

      this.logger.debug('[ClientNav] Navigation complete');
    } catch (error) {
      this.logger.error('[ClientNav] [ERROR] Navigation failed:', error);

      // Reset flag on error
      this.client._isClientSideNav = false;

      // Show error in content area
      if (this.client._zVaFElement) {
        this.client._zVaFElement.innerHTML = `
          <div class="zAlert zAlert-danger zmt-4">
            <strong>Navigation Error:</strong> ${error.message}
          </div>
        `;
      }
    } finally {
      // Reset flag after navigation attempt (success or fail)
      setTimeout(() => {
        this.client._isClientSideNav = false;
      }, 100);
    }
  }
}

export default NavigationManager;

