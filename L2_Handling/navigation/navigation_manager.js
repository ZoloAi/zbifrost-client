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

    // SPA never-unload baseline: stamp the current history entry with a monotonic
    // index so popstate can tell Back from Forward (the History API does not).
    // Every pushState below carries an incrementing idx; comparing the entry we
    // land on against the one we left gives the direction. Without this baseline a
    // Back from the first SPA nav has no idx to compare against.
    if (typeof window !== 'undefined' && window.history) {
      const st = window.history.state;
      if (!st || typeof st.idx !== 'number') {
        window.history.replaceState(
          { route: window.location.pathname, idx: 0 }, '', window.location.href,
        );
        this.client._histIdx = 0;
      } else {
        this.client._histIdx = st.idx;
      }
      // Seed the departed-page tracker on a hard load (navigateToRoute stamps it
      // on every SPA hop). The popstate handler compares it against the restored
      // URL to tell a cross-page Back from a same-page delta unwind.
      if (this.client._currentPath == null) {
        this.client._currentPath = window.location.pathname;
      }
    }

    // Handle browser back/forward buttons
    if (!this.client._popstateHandler) {
      this.client._popstateHandler = async (e) => {
        const path = window.location.pathname;

        // Direction from the monotonic idx: the entry we land on vs. the one we
        // left. Lower → Back, higher (or equal/unknown) → Forward.
        const newIdx = (e.state && typeof e.state.idx === 'number') ? e.state.idx : 0;
        const prevIdx = (typeof this.client._histIdx === 'number') ? this.client._histIdx : 0;
        const isBack = newIdx < prevIdx;
        this.client._histIdx = newIdx;
        this.logger.debug(
          `[ClientNav] popstate ${isBack ? 'BACK' : 'FORWARD'} (idx ${prevIdx}→${newIdx}) path=${path}`,
        );

        // Freeze the page we're leaving (cache is a separate perf layer — used
        // only when the socket is down, never as navigation authority).
        const departedPath = this.client._currentPath || path;
        await this.snapshotCurrentPage();

        if (isBack) {
          // TWO Back regimes, split by what the browser itself changed:
          //
          //   URL unchanged (same-page delta unwind) → bare zBack intent. The
          //   server pops its authoritative crumb trail (zCLI parity) — the
          //   trail is the ONLY map of block-level hops, so it stays SSOT here.
          //
          //   URL changed (cross-page Back) → navigate to the RESTORED URL.
          //   The bare intent used to run here too, but it trusts a trail that
          //   a server reset / WS re-session wipes while browser history
          //   survives — the classic "URL changes, paint doesn't, Ctrl+R
          //   fixes it" drift. The destination lives in the history entry the
          //   browser just restored (path + optional deep block), so routing
          //   by URL is reset-proof; when the trail IS intact the server's
          //   walker reconciliation still pops frames past the on-trail scope
          //   (pop_to_scope), so trail depth stays in lockstep either way.
          //
          // (NOT client.zBack(), which itself triggers history.back() — that
          // would recurse through this very handler.)
          if (this._isSocketConnected()) {
            if (departedPath !== path) {
              const entryBlock = (e.state && e.state.block) ? e.state.block : null;
              this.logger.debug(`[ClientNav] cross-page Back → route nav ${path}${entryBlock ? '#' + entryBlock : ''}`);
              await this.navigateToRoute(path, { skipHistory: true, zBack: true, zBlock: entryBlock });
              return;
            }
            this.client._sendZBackIntent();
            return;
          }
          if (await this._replayFromTrail(path, { zBack: true })) {
            return;
          }
          this._showOfflineNotice(path);
          return;
        }

        // Forward (or unknown direction) is NOT a crumb pop: re-issue the nav that
        // created this entry as a FRESH navigation (server pushes a new trail frame;
        // there is no client-side redo stack). A delta entry carries its block — the
        // path is unchanged, so re-run the SAME hop via zDelta. A route entry has no
        // block — re-request the destination URL. URL is already correct in both
        // cases (fromHistory / skipHistory), so we never double-push.
        const fwdBlock = (e.state && e.state.block) ? e.state.block : null;
        if (fwdBlock && typeof this.client.zDelta === 'function') {
          this.logger.debug(`[ClientNav] forward → re-issue delta hop ${fwdBlock}`);
          this.client.zDelta(fwdBlock, null, null, /* fromHistory */ true);
          return;
        }
        await this.navigateToRoute(path, { skipHistory: true });
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
      // Restored navigation BUTTON (zLink/zDelta/zBack). A page replayed from the
      // trail is raw HTML — buttons keep their data-wizard-action but lost the live
      // click handler ButtonRenderer attached at render time, so they go dead until
      // a reload. Fresh buttons stopPropagation in their own handler, so ONLY a
      // handler-less restored button bubbles up here. Re-dispatch via the client.
      const btn = e.target && e.target.closest
        ? e.target.closest('button[data-wizard-action]')
        : null;
      if (btn && el.contains(btn) && this._dispatchRestoredNavButton(btn)) {
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
   * Re-dispatch a navigation button restored from the trail (handler-less).
   * Mirrors ButtonRenderer's nav-verb parsing (zLink / zDelta / zBack) using the
   * action string frozen in data-wizard-action. Returns true when handled.
   * @private
   */
  _dispatchRestoredNavButton(btn) {
    const client = this.client;
    // zCrumbs bulk-rewind button (stamped data-nav-zcrumb): a restored rewind
    // still unwinds to its on-trail target via the SAME zLink + server pop_to_scope
    // path the live click uses. Checked first — a crumb button carries no
    // wizardAction string.
    const crumbTarget = btn.dataset && btn.dataset.navZcrumb;
    if (crumbTarget) {
      const crumbOrigin = client.navOriginKey ? client.navOriginKey(btn) : null;
      this.logger.info('[ClientNav] Restored zCrumb rewind → %s', crumbTarget);
      if (client.zCrumb) {
        client.zCrumb(crumbTarget, crumbOrigin);
        return true;
      }
    }
    const action = btn.dataset && btn.dataset.wizardAction;
    if (!action) {
      return false;
    }
    const originKey = client.navOriginKey ? client.navOriginKey(btn) : null;
    // Persisted zPsi anchor (dict-form buttons) — forward it so a restored
    // zLink/zDelta + zPsi button still lands on its section, not the top.
    const zPsi = (btn.dataset && btn.dataset.navZpsi) ? btn.dataset.navZpsi : null;
    if (action.startsWith('zLink(')) {
      const path = action.slice(6, -1).trim();
      this.logger.info('[ClientNav] Restored zLink button → %s (zPsi: %s)', path, zPsi);
      if (client.zLink) {
        client.zLink(path, originKey, zPsi);
        return true;
      }
    } else if (action.startsWith('zDelta(') || action.startsWith('$')) {
      const blockName = action.startsWith('zDelta(')
        ? action.slice(7, -1).replace(/^\$/, '').trim()
        : action.slice(1).trim();
      this.logger.info('[ClientNav] Restored zDelta button → %s (zPsi: %s)', blockName, zPsi);
      if (client.zDelta) {
        client.zDelta(blockName, originKey, zPsi);
        return true;
      }
    } else if (action.startsWith('zModal(')) {
      const target = action.slice(7, -1).trim();
      this.logger.info('[ClientNav] Restored zModal button → %s', target);
      if (client.zModal) {
        client.zModal(target);
        return true;
      }
    } else if (action === 'zBack') {
      this.logger.info('[ClientNav] Restored zBack button');
      if (client.zBack) {
        client.zBack();
        return true;
      }
    }
    return false;
  }

  /**
   * Apply a destination route's navbar on SPA navigation (SSOT: server-resolved).
   *
   * @param {Object} routeConfig - Parsed /api/route-config payload
   * @private
   */
  _applyRouteNavBar(routeConfig) {
    // Keep the browser tab in sync on SPA nav. SSOT: server zMeta.zTitle + brand,
    // mirroring route_dispatcher's page_title ("brand - zTitle"). The server stamps
    // <title> on full loads; SPA nav has no reload, so we set document.title here —
    // before any early-return, so chrome-less destinations get a correct tab too.
    const zMeta = routeConfig && routeConfig.zMeta;
    if (zMeta && this.client.zuiConfig && typeof document !== 'undefined') {
      const brand = this.client.zuiConfig.brand || null;
      const zt = zMeta.zTitle || null;
      const pageTitle = (zt && brand) ? `${brand} - ${zt}` : (zt || brand);
      if (pageTitle) document.title = pageTitle;
    }

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
    // Keep zuiConfig (same-file verb SSOT) in lockstep with the replayed page so
    // a $delta/zDelegate after an offline replay hops against the right file.
    if (entry.routeConfig) {
      client.zuiConfig = {
        ...(client.zuiConfig || {}),
        zVaFile: entry.routeConfig.zVaFile,
        zVaFolder: entry.routeConfig.zVaFolder,
        zBlock: entry.routeConfig.zBlock,
      };
    }
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
    const { skipHistory = false, navbar = false, zOrigin = null, zBack = false, zBlock: targetZBlock = null } = options;

    // SSOT double-walk guard (see BifrostCore._isDuplicateWalk): drop a burst-
    // duplicate navigation to the SAME route+block so a redirect-dispatcher chain
    // (e.g. /zAccount → navigate_back /zAccount/Login) or a popstate race cannot
    // paint the page twice. Placed BEFORE the DOM reset below so a dropped nav
    // leaves no stranded "Loading…" surface. Back/Forward carry a distinct bit.
    const _walkSig = `nav|${routePath}|${targetZBlock || ''}|${zBack ? 'B' : ''}`;
    if (typeof this.client._isDuplicateWalk === 'function' && this.client._isDuplicateWalk(_walkSig)) {
      this.logger.warn('[ClientNav] Dropped duplicate navigation (double-walk guard): %s', routePath);
      return;
    }

    this.client._isClientSideNav = true;

    try {
      this.logger.info('[ClientNav] Navigating to: %s', routePath);

      // Freeze the page we're leaving before we touch the DOM (bfcache-style).
      await this.snapshotCurrentPage();

      // 2B: Python owns route resolution — ask the server for walker params.
      // Two failure modes, kept distinct on purpose:
      //   • fetch REJECTS  → the server is unreachable (truly offline). Replay the
      //     trail, else show the offline notice.
      //   • fetch RESOLVES but !res.ok → the server answered with 404/403. That is
      //     NOT offline — it is a real "page not found / no access". Hand off to a
      //     full navigation so the server renders its styled error page
      //     (UI/error/zUI.<code>), instead of the misleading offline banner.
      let routeConfig;
      let res;
      try {
        res = await fetch(`/api/route-config?path=${encodeURIComponent(routePath)}`);
      } catch (netErr) {
        this.logger.warn('[ClientNav] route-config unreachable (%s) — trying trail', netErr && netErr.message);
        if (await this._replayFromTrail(routePath, { zBack })) {
          return;
        }
        this._showOfflineNotice(routePath);
        return;
      }
      if (!res.ok) {
        this.logger.warn('[ClientNav] route-config %s → HTTP %s — full-nav to server error page', routePath, res.status);
        window.location.href = routePath;
        return;
      }
      routeConfig = await res.json();

      const { zBlock: routeZBlock, zVaFile, zVaFolder, zMeta, routeParams } = routeConfig;
      // A zURL/zAlpha to a specific block carries it out-of-band (engine SSOT:
      // the zPath tail). Honor it over the route's auto-discovered FIRST block
      // so a cross-file link lands on the named block — exactly like zCLI. The
      // URL is unchanged (file-level); only the walker target block differs.
      const zBlock = targetZBlock || routeZBlock;
      this.logger.debug('[ClientNav] Route config', { zVaFile, zVaFolder, zBlock, routeZBlock, targetZBlock });

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
        // zOS convention (SSOT with server html_injectors._build_styles_links):
        // a dot is a sub-directory separator (pages.home → /styles/pages/home.css).
        // Leaving the dot literal here 404s the stylesheet, so the page renders
        // unstyled on SPA nav while a full reload (server path) looks correct.
        const href = `/styles/${brush.replace(/\./g, '/')}.css`;
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
      // SSOT: refresh the live page context. zuiConfig is parsed ONCE from the
      // full-load <zui-config> head and is the source same-file verbs read from
      // (zDelta/zDelegate at bifrost_core, structure-mode crumbs at
      // navigation_renderer). SPA nav never reloads the head, so without this it
      // stays pinned to the BOOT file and every same-file $delta hops against the
      // wrong page. Mirror the fresh route values in so the live page is SSOT.
      this.client.zuiConfig = {
        ...(this.client.zuiConfig || {}),
        zVaFile,
        zVaFolder,
        zBlock,
        routeParams,
      };
      // A live server nav supersedes any pending offline retry.
      this.client._pendingOfflineNav = null;

      // Clear current content and show loading state
      if (this.client._zVaFElement) {
        this.client._zVaFElement.innerHTML = '<div class="zText-center zp-4">Loading...</div>';
      }

      // Send walker execution request via WebSocket.
      // navbar carries the RESET DEPTH (SSOT with zCLI): true → GLOBAL/page bar
      // (server FULL-resets the trail, target becomes the new root); 'scoped' →
      // INLINE/block bar (server keeps the host page + ancestors so a pick does
      // not wipe the page the bar lives on). Pass the value through verbatim.
      const walkerRequest = { event: 'execute_walker', zBlock, zVaFile, zVaFolder };
      if (navbar) walkerRequest.navbar = navbar;
      if (zOrigin) walkerRequest.zOrigin = zOrigin;
      if (zBack) walkerRequest.zBack = true;
      // SSOT gap closer (mirrors bifrost_core's autoRequest): a dynamic route
      // (e.g. /s/%slug) seats %route.* server-side for THIS route-config
      // response's own set_route_params call above, but that seat lives in a
      // per-request session unit that's gone by the time THIS execute_walker
      // reaches the server over the already-open WS. Forward it so the server
      // can re-seat %route.* before resolving the block's zMeta.zSpool.
      if (routeParams) walkerRequest.params = routeParams;
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

      // Update browser URL (skip for popstate — URL already correct).
      // Carry a monotonic idx so the popstate handler can read direction
      // (Back vs Forward) off the History API, which exposes no direction itself.
      if (!skipHistory) {
        const newUrl = routePath.startsWith('/') ? routePath : `/${routePath}`;
        const idx = (typeof this.client._histIdx === 'number' ? this.client._histIdx : 0) + 1;
        history.pushState({ route: routePath, idx }, '', newUrl);
        this.client._histIdx = idx;
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
