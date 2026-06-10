/**
 * NavigationManager - Handles client-side navigation (SPA-style routing)
 *
 * Responsibilities:
 * - Enable client-side navigation (intercept clicks on navbar + body links)
 * - Handle browser back/forward buttons (popstate)
 * - Navigate to routes via WebSocket (no page reload)
 * - Snapshot each visited page into the TrailStore (offline-browse engine)
 * - Replay a cached page on Back/forward and when the socket is down, so zOS
 *   feels like a regular HTML site even with a flaky/absent connection
 * - Fetch route configuration from backend
 * - Update browser URL without reload
 *
 * Offline-browse model (mirrors what a normal MPA gets free from bfcache):
 * - Forward to a NEW page → server round-trip (route-config + execute_walker)
 * - Back/forward to a SEEN page → replay the frozen paint from the trail
 * - Socket down + SEEN target → replay from trail; NEW target → graceful notice
 * A replayed page is stale render output, never authority (the server revalidates
 * on the next forward navigation).
 */

export class NavigationManager {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
  }

  /**
   * Enable client-side navigation (SPA-style routing)
   *
   * Individual links (rendered via link_primitives.js) wire their own click
   * handlers and stopPropagation. For pages REPLAYED from the trail (raw HTML,
   * no live handlers) we add ONE delegated click handler on the zVaF container:
   * fresh links never reach it (they stopPropagation), restored links bubble up
   * and get routed through the SPA. This is what keeps a replayed page browsable.
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

    this._wireRestoredLinkDelegation();

    this.logger.info('[ClientNav] Client-side navigation enabled');

    // Handle browser back/forward buttons
    if (!this.client._popstateHandler) {
      this.client._popstateHandler = async (_e) => {
        this.logger.debug('[ClientNav] Browser back/forward detected');
        const path = window.location.pathname;

        // An in-page zBack button routes a cross-file step-out through
        // history.back() and flags intent — carry it so the server consumes the
        // crumb's origin section (zPsi), mirroring zCLI's start_key resume. A
        // plain browser Back/Fwd leaves the flag unset and renders from the top.
        const zBack = !!this.client._pendingZBack;
        this.client._pendingZBack = false;

        // Freeze the page we're leaving, then try to replay the target's frozen
        // paint (bfcache parity — Back is instant and works offline). Only fall
        // through to a server nav if we never cached this page.
        await this.snapshotCurrentPage();
        if (await this._replayFromTrail(path, { zBack })) {
          return;
        }
        await this.navigateToRoute(path, { skipHistory: true, zBack });
      };

      window.addEventListener('popstate', this.client._popstateHandler);
    }

    this.logger.debug('[ClientNav] Enabled');
  }

  /**
   * Attach the single delegated click handler that routes links on replayed
   * (handler-less) pages. Idempotent — wired once per zVaF element.
   * @private
   */
  _wireRestoredLinkDelegation() {
    const el = this.client._zVaFElement;
    if (!el || this.client._zVaFLinkDelegationWired) {
      return;
    }
    el.addEventListener('click', (e) => {
      // A live link handler (fresh render) already handled + stopped this.
      if (e.defaultPrevented) {
        return;
      }
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a || !el.contains(a)) {
        return;
      }
      if (a.target === '_blank') {
        return; // let new-tab links behave natively
      }
      const href = a.getAttribute('href');
      // Internal, same-origin path only (e.g. /zProducts/zOS/...).
      if (!href || !href.startsWith('/') || href.startsWith('//')) {
        return;
      }
      e.preventDefault();
      this.logger.debug('[ClientNav] Restored-link click → SPA nav:', href);
      this.navigateToRoute(href);
    }, false);
    this.client._zVaFLinkDelegationWired = true;
    this.logger.debug('[ClientNav] Restored-link delegation wired');
  }

  /**
   * Apply a destination route's navbar on SPA navigation (SSOT: server-resolved).
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
    // per-page opt-out guard reads THIS page's zNavBar.
    if (this.client.zuiConfig && routeConfig && routeConfig.zMeta) {
      this.client.zuiConfig.zMeta = routeConfig.zMeta;
    }

    if (!wantsNavbar) {
      el.style.display = 'none';
      el.innerHTML = '';
      this.logger.debug('[ClientNav] Destination has no navbar — hiding chrome');
      return;
    }

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
   * Snapshot the page currently on screen into the trail (bfcache-style freeze).
   * Stores the rendered HTML + the route's resolved config so a later replay can
   * restore both the content and its navbar without the server.
   * @returns {Promise<boolean>} true if a snapshot was written
   */
  async snapshotCurrentPage() {
    const client = this.client;
    if (!client.cache || typeof document === 'undefined') {
      return false;
    }
    const el = client._zVaFElement;
    if (!el) {
      return false;
    }
    const html = el.innerHTML;
    // Never freeze a transient loading/placeholder state.
    if (!html || html.indexOf('Loading...') !== -1) {
      return false;
    }
    const path = client._currentPath || window.location.pathname;
    const routeConfig = client._currentRouteConfig || null;
    try {
      await client.cache.set(path, {
        html,
        routeConfig,
        title: document.title,
        ts: Date.now()
      });
      this.logger.debug('[ClientNav] Snapshotted page into trail: %s', path);
      return true;
    } catch (err) {
      this.logger.debug('[ClientNav] Snapshot skipped:', err && err.message);
      return false;
    }
  }

  /**
   * Replay a page from the trail (no server round-trip).
   * @param {string} routePath - target path
   * @param {Object} opts - { zBack }
   * @returns {Promise<boolean>} true if the page was replayed
   * @private
   */
  async _replayFromTrail(routePath, { zBack = false } = {}) {
    const client = this.client;
    if (!client.cache) {
      return false;
    }
    let entry;
    try {
      entry = await client.cache.get(routePath);
    } catch (err) {
      return false;
    }
    if (!entry || !entry.html) {
      return false;
    }
    const el = client._zVaFElement;
    if (!el) {
      return false;
    }

    el.innerHTML = entry.html;
    if (entry.title) {
      document.title = entry.title;
    }
    if (entry.routeConfig) {
      this._applyRouteNavBar(entry.routeConfig);
    }
    client._currentPath = routePath;
    client._currentRouteConfig = entry.routeConfig || null;
    // We served a page — cancel any pending offline retry.
    client._pendingOfflineNav = null;

    // Re-enable nav so the delegated handler + popstate stay live.
    if (typeof client._enableClientSideNavigation === 'function') {
      await client._enableClientSideNavigation();
    }

    // A page replayed while the socket is down is stale render output — lock its
    // forms (the disconnect handler ran before this content existed).
    if (!this._isSocketConnected() && client.cacheManager && typeof client.cacheManager.disableForms === 'function') {
      client.cacheManager.disableForms();
    }

    // Don't yank to the top on a crumb-driven back.
    if (!zBack) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    this.logger.info('[ClientNav] Replayed from trail: %s', routePath);
    return true;
  }

  /**
   * Render a graceful offline notice when a NEVER-seen page is requested while
   * the connection is down (a normal site shows the browser dino here).
   * @private
   */
  _showOfflineNotice(routePath) {
    if (this.client._zVaFElement) {
      this.client._zVaFElement.innerHTML = `<div class="zAlert zAlert-warning zmt-4">
        <strong>You're offline</strong><br>
        <small>"${routePath}" hasn't been opened yet, so it isn't available offline. Reconnecting…</small>
      </div>`;
    }
    // Remember the intent so the reconnect handler can fulfill it automatically.
    this.client._pendingOfflineNav = routePath;
    this.logger.warn('[ClientNav] Offline + uncached target: %s', routePath);
  }

  /** @private */
  _isSocketConnected() {
    const conn = this.client.connection;
    if (conn && typeof conn.isConnected === 'function') {
      return conn.isConnected();
    }
    // Unknown → assume connected (preserve legacy behavior).
    return true;
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

      // Freeze the page we're leaving before we touch the DOM (bfcache-style).
      await this.snapshotCurrentPage();

      // 2B: Python owns route resolution — ask the server for walker params.
      // If the server is unreachable, fall back to the trail (offline-browse).
      let routeConfig;
      try {
        const res = await fetch(`/api/route-config?path=${encodeURIComponent(routePath)}`);
        if (!res.ok) {
          throw new Error(`Route not found: ${routePath} (${res.status})`);
        }
        routeConfig = await res.json();
      } catch (netErr) {
        this.logger.warn('[ClientNav] route-config unreachable (%s) — trying trail', netErr && netErr.message);
        if (await this._replayFromTrail(routePath, { zBack })) {
          return;
        }
        this._showOfflineNotice(routePath);
        return;
      }

      const { zBlock, zVaFile, zVaFolder, zMeta } = routeConfig;
      this.logger.debug('[ClientNav] Route config', { zVaFile, zVaFolder, zBlock });

      // Per-page navbar (SSOT: server-resolved via route-config).
      this._applyRouteNavBar(routeConfig);

      // If the socket is down, the walker request can't be served — replay the
      // frozen paint instead of stalling on the timeout.
      if (!this._isSocketConnected()) {
        this.logger.warn('[ClientNav] Socket down — trying trail for %s', routePath);
        if (await this._replayFromTrail(routePath, { zBack })) {
          return;
        }
        this._showOfflineNotice(routePath);
        return;
      }

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

      // Track the destination so the NEXT snapshot (on leave) is stamped right.
      this.client._currentPath = routePath;
      this.client._currentRouteConfig = routeConfig;
      // A live server nav supersedes any pending offline retry.
      this.client._pendingOfflineNav = null;

      // Clear current content and show loading state
      if (this.client._zVaFElement) {
        this.client._zVaFElement.innerHTML = '<div class="zText-center zp-4">Loading...</div>';
      }

      // Send walker execution request via WebSocket.
      const walkerRequest = { event: 'execute_walker', zBlock, zVaFile, zVaFolder };
      if (navbar) walkerRequest.navbar = true;
      if (zOrigin) walkerRequest.zOrigin = zOrigin;
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

      // Don't yank to the top on a crumb-driven back.
      if (!zBack) window.scrollTo({ top: 0, behavior: 'smooth' });

      // Update browser URL (skip for popstate — URL already correct)
      if (!skipHistory) {
        const newUrl = routePath.startsWith('/') ? routePath : `/${routePath}`;
        history.pushState({ route: routePath }, '', newUrl);
      }

      this.logger.debug('[ClientNav] Navigation complete');
    } catch (error) {
      this.logger.error('[ClientNav] [ERROR] Navigation failed:', error);

      this.client._isClientSideNav = false;

      if (this.client._zVaFElement) {
        this.client._zVaFElement.innerHTML = `
          <div class="zAlert zAlert-danger zmt-4">
            <strong>Navigation Error:</strong> ${error.message}
          </div>
        `;
      }
    } finally {
      setTimeout(() => {
        this.client._isClientSideNav = false;
      }, 100);
    }
  }
}

export default NavigationManager;
