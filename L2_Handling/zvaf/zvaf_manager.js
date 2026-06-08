/**
 * ZVaFManager - Manages zVaF elements (badge, navbar, content area)
 *
 * Responsibilities:
 * - Initialize zVaF elements (zBifrostBadge, zNavBar, zVaF)
 * - Populate connection badge
 * - Update badge state (connecting, connected, disconnected, error)
 * - Populate navbar from embedded config or API
 * - Fetch fresh navbar after auth state changes
 *
 * Extracted from bifrost_client.js (Phase 3.2)
 */

import { NavBarBuilder } from '../../L3_Abstraction/orchestrator/navbar_builder.js';

export class ZVaFManager {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
    this.options = client.options;
    this.zuiConfig = client.zuiConfig;
  }

  /**
   * Initialize zVaF elements.
   *
   * SSOT (hard cut): <zVaF> is the bifrost ROOT — the single mount an app template
   * provides. EVERYTHING bifrost-generated lives under it, never as stray <body>
   * children:
   *
   *   <zVaF>                          ← root (template owns this tag only)
   *     <zNavBar>…</zNavBar>          ← chrome (runtime-created), sticky top
   *     <div id="zVaF-content">…</div>← the render/clear target (page content)
   *     <zBifrostBadge>…</zBifrostBadge> ← chrome (runtime-created), fixed
   *     <div class="bifrost-error-container">…</div> ← error toasts (lazy)
   *
   * Chrome are SIBLINGS of the content host, so re-renders (which wipe the content
   * host) never destroy them. Position/look come purely from built-in zClass in
   * zbase.css (navbar sticky, badge/errors fixed).
   */
  initZVaFElements() {
    this.logger.debug('[ZVaFManager] Starting initialization');

    if (typeof document === 'undefined') {
      this.logger.warn('[ZVaFManager] Not in browser environment');
      return;
    }

    // The <zVaF> ROOT is the only required mount (template owns the bare tag).
    const zVaFRoot = document.querySelector(this.options.targetElement) ||
                     document.getElementById(this.options.targetElement);
    if (!zVaFRoot) {
      this.logger.error(`[ZVaFManager] [ERROR] <${this.options.targetElement}> root not found in DOM`);
      return;
    }
    this.client._zVaFRoot = zVaFRoot;
    this.logger.debug('[ZVaFManager] zVaF root found');

    // Inner content host (#zVaF-content) — THE render/clear target. Created inside
    // the root so chrome siblings survive content re-renders.
    let contentHost = zVaFRoot.querySelector('#zVaF-content');
    if (!contentHost) {
      contentHost = document.createElement('div');
      contentHost.id = 'zVaF-content';
      contentHost.className = 'zVaF-content';
      zVaFRoot.appendChild(contentHost);
      this.logger.debug('[ZVaFManager] Created content host #zVaF-content');
    }
    this.client._zVaFElement = contentHost;

    // NavBar: sticky-top chrome → FIRST child of the root (above content).
    const navElement = this._ensureChromeHost('zNavBar', (el) => {
      zVaFRoot.insertBefore(el, zVaFRoot.firstChild);
    });
    if (navElement) {
      this.client._zNavBarElement = navElement;
      // Populate asynchronously (don't block initialization).
      this.populateNavBar().catch(err => {
        this.logger.error('[ZVaFManager] Failed to populate navbar:', err);
      });
      this.logger.debug('[ZVaFManager] NavBar host ready, populating');
    }

    // Badge: fixed chrome → appended to the root (DOM position is cosmetic; it's
    // viewport-fixed via zbase.css).
    const badgeElement = this._ensureChromeHost('zBifrostBadge', (el) => {
      zVaFRoot.appendChild(el);
    });
    if (badgeElement) {
      this.client._zConnectionBadge = badgeElement;
      this.populateConnectionBadge();
      this.logger.debug('[ZVaFManager] Badge host ready');
    }

    this.logger.log('[ZVaFManager] All elements initialized under <zVaF> root');
  }

  /**
   * Ensure a runtime-owned chrome host element exists, returning it.
   *
   * Reuses an existing element if present (legacy templates); otherwise creates it
   * and places it via `place(el)`. Hard-cut SSOT — <zNavBar>/<zBifrostBadge> are no
   * longer required in app templates; the runtime creates them inside <zVaF>.
   *
   * @param {string} tagName - Custom element tag (zNavBar | zBifrostBadge)
   * @param {(el: HTMLElement) => void} place - Inserts the freshly created element
   * @returns {HTMLElement}
   */
  _ensureChromeHost(tagName, place) {
    let el = document.querySelector(tagName);
    if (el) return el;
    el = document.createElement(tagName);
    place(el);
    this.logger.debug(`[ZVaFManager] Created runtime chrome host <${tagName}>`);
    return el;
  }

  /**
   * Populate connection badge content (v1.6.0: Simplified - element exists, just set content)
   */
  populateConnectionBadge() {
    if (!this.client._zConnectionBadge) {
      return;
    }

    // Set initial badge content (will be updated by connection hooks)
    this.client._zConnectionBadge.className = 'zConnection zBadge zBadge-connection zBadge-pending';
    this.client._zConnectionBadge.innerHTML = `
      <svg class="zIcon zIcon-sm zBadge-dot" aria-hidden="true">
        <use xlink:href="#icon-circle-fill"></use>
      </svg>
      <span class="zBadge-text">Connecting...</span>
    `;

    this.logger.log('[ConnectionBadge] Badge populated with initial state');
  }

  /**
   * Update badge state (v1.6.0: Helper method called from hooks)
   * @param {string} state - 'connecting', 'connected', 'disconnected', 'error'
   */
  updateBadgeState(state) {
    if (!this.client._zConnectionBadge) {
      this.logger.warn('[ConnectionBadge] Cannot update - badge element not found');
      return;
    }

    const badge = this.client._zConnectionBadge;
    const badgeText = badge.querySelector('.zBadge-text');

    if (!badgeText) {
      this.logger.warn('[ConnectionBadge] Cannot update - badge text element not found');
      return;
    }

    this.logger.debug(`[ConnectionBadge] Updating badge to: ${state}`);

    // Remove all state classes
    badge.classList.remove('zBadge-pending', 'zBadge-success', 'zBadge-error');

    // Apply new state
    switch (state) {
      case 'connected':
        badge.classList.add('zBadge-success');
        badgeText.textContent = 'Connected';
        this.logger.log('[ConnectionBadge] Connected');
        break;
      case 'disconnected':
        badge.classList.add('zBadge-pending');
        badgeText.textContent = 'Disconnected';
        this.logger.debug('[ConnectionBadge] Disconnected');
        break;
      case 'error':
        badge.classList.add('zBadge-error');
        badgeText.textContent = 'Error';
        this.logger.debug('[ConnectionBadge] Error');
        break;
      case 'connecting':
      default:
        badge.classList.add('zBadge-pending');
        badgeText.textContent = 'Connecting...';
        this.logger.debug('[ConnectionBadge] Connecting');
        break;
    }
  }

  /**
   * Update the badge with bifrost RENDER status (distinct from connection state).
   *
   * This is the zOS↔user "page is painting" contract: as the runtime streams a
   * page in, the badge reads "Rendering k/N", then snaps back to the connected
   * state when the last section lands. It reuses the same pending/success chip —
   * no new chrome, no layout impact.
   *
   * @param {Object} opts
   * @param {number} [opts.current] - Sections painted so far
   * @param {number} [opts.total]   - Total sections in this render
   * @param {boolean} [opts.done]   - Render finished → restore connected state
   */
  updateRenderState({ current = 0, total = 0, done = false } = {}) {
    if (done) {
      this.updateBadgeState('connected');
      return;
    }
    const badge = this.client._zConnectionBadge;
    if (!badge) return;
    const badgeText = badge.querySelector('.zBadge-text');
    if (!badgeText) return;

    badge.classList.remove('zBadge-success', 'zBadge-error');
    badge.classList.add('zBadge-pending');
    badgeText.textContent = total > 0 ? `Rendering ${current}/${total}` : 'Rendering…';
  }

  /**
   * Populate navbar from embedded config.
   * 3A: Prefers server-built nav_html; falls back to array-based builder.
   */
  async populateNavBar() {
    if (!this.client._zNavBarElement) return;

    try {
      const navHtml = this.zuiConfig?.nav_html;

      if (navHtml) {
        // 3A path: Python sent pre-built HTML — inject + wire events
        this.client._zNavBarElement.innerHTML = navHtml;
        NavBarBuilder.wireNavBarEvents(
          this.client._zNavBarElement.firstElementChild,
          this.client,
          this.logger
        );
        this.logger.log('[NavBar] NavBar populated from server HTML (3A)');
      } else if (this.zuiConfig?.zNavBar) {
        // Legacy path: build from items array
        const navElement = await this.client._renderMetaNavBarHTML(this.zuiConfig.zNavBar);
        this.client._zNavBarElement.innerHTML = '';
        if (navElement) {
          this.client._zNavBarElement.appendChild(navElement);
          this.logger.log('[NavBar] NavBar populated from embedded config (DOM element):', this.zuiConfig.zNavBar);
        } else {
          this.logger.warn('[NavBar] renderMetaNavBarHTML returned null');
        }
      } else {
        this.logger.warn('[NavBar] No nav_html or zNavBar in embedded zuiConfig');
        return;
      }

      await this.client._enableClientSideNavigation();
    } catch (error) {
      this.logger.error('[NavBar] Failed to populate:', error);
    }
  }

  /**
   * Re-populate navbar from connection_info nav_html (3A) or API fallback.
   * Called after auth state changes / reconnect.
   */
  async fetchAndPopulateNavBar(navHtmlFromServer = null) {
    if (!this.client._zNavBarElement) return;

    try {
      if (navHtmlFromServer) {
        // 3A path: server pushed updated HTML via connection_info
        this.client._zNavBarElement.innerHTML = navHtmlFromServer;
        NavBarBuilder.wireNavBarEvents(
          this.client._zNavBarElement.firstElementChild,
          this.client,
          this.logger
        );
        this.logger.log('[NavBar] NavBar updated from connection_info nav_html (3A)');
        await this.client._enableClientSideNavigation();
        return;
      }

      // 3A reuse: client-side bounce-back / refresh has no new server round-trip,
      // so reuse the RBAC-filtered nav_html the server embedded in the page head
      // (zui-config). The legacy /api/zui/config endpoint was removed (smart
      // routing + connection_info supersede it) — hitting it 404s and spams the
      // console. Only fall through to the fetch if no embedded nav_html exists.
      const embeddedNav = this.zuiConfig?.nav_html || this.client?.zuiConfig?.nav_html;
      if (embeddedNav) {
        this.client._zNavBarElement.innerHTML = embeddedNav;
        NavBarBuilder.wireNavBarEvents(
          this.client._zNavBarElement.firstElementChild,
          this.client,
          this.logger
        );
        this.logger.log('[NavBar] NavBar refreshed from embedded zui-config nav_html (3A)');
        await this.client._enableClientSideNavigation();
        return;
      }

      // Legacy path: fetch from /api/zui/config
      let freshConfig;
      if (this.client.httpCache) {
        const { data, fromCache } = await this.client.httpCache.fetchWithCache(
          '/api/zui/config', {}, 'zui_config', 'system'
        );
        freshConfig = data;
        this.logger.log(`[NavBar] Fetched config from API (${fromCache ? '304 cached' : '200 fresh'})`);
      } else {
        const response = await fetch('/api/zui/config');
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        freshConfig = await response.json();
      }

      if (freshConfig.nav_html) {
        this.client._zNavBarElement.innerHTML = freshConfig.nav_html;
        NavBarBuilder.wireNavBarEvents(
          this.client._zNavBarElement.firstElementChild,
          this.client,
          this.logger
        );
        this.logger.log('[NavBar] NavBar updated from API nav_html (3A)');
      } else if (freshConfig.zNavBar) {
        this.zuiConfig.zNavBar = freshConfig.zNavBar;
        this.client.zuiConfig.zNavBar = freshConfig.zNavBar;
        const navElement = await this.client._renderMetaNavBarHTML(freshConfig.zNavBar);
        this.client._zNavBarElement.innerHTML = '';
        if (navElement) {
          this.client._zNavBarElement.appendChild(navElement);
          this.logger.log('[NavBar] NavBar updated from API zNavBar array (legacy)');
        }
      } else {
        this.logger.warn('[NavBar] No nav_html or zNavBar in API response, skipping');
        return;
      }

      await this.client._enableClientSideNavigation();
    } catch (error) {
      this.logger.error('[NavBar] Failed to fetch/populate:', error);
    }
  }
}

export default ZVaFManager;

