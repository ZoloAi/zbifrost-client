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
   * SSOT (hard cut): chrome hosts <zNavBar> and <zBifrostBadge> are RUNTIME-owned,
   * not template-owned. An app template needs only the <zVaF> content mount; the
   * runtime creates the chrome hosts on demand and positions/styles them purely
   * via built-in zClass in zbase.css (navbar = sticky top, badge = fixed). This
   * removes per-app template boilerplate and the SSOT drift it caused.
   */
  initZVaFElements() {
    this.logger.debug('[ZVaFManager] Starting initialization');

    if (typeof document === 'undefined') {
      this.logger.warn('[ZVaFManager] Not in browser environment');
      return;
    }

    // The zVaF content element is the ONE required mount point (template owns it).
    // Resolve it first so the navbar host can be placed relative to it.
    const zVaFElement = document.querySelector(this.options.targetElement) ||
                        document.getElementById(this.options.targetElement);
    if (zVaFElement) {
      this.client._zVaFElement = zVaFElement;
      this.logger.debug('[ZVaFManager] zVaF element found');
    } else {
      this.logger.error(`[ZVaFManager] [ERROR] <${this.options.targetElement}> not found in DOM`);
    }

    // Badge: position:fixed → parent-agnostic, append to <body>.
    const badgeElement = this._ensureChromeHost('zBifrostBadge', (el) => {
      document.body.appendChild(el);
    });
    if (badgeElement) {
      this.client._zConnectionBadge = badgeElement;
      this.populateConnectionBadge();
      this.logger.debug('[ZVaFManager] Badge host ready');
    }

    // NavBar: page-frame chrome (sticky top) → insert BEFORE <zVaF> so it sits
    // above the scrolling content, never inside it.
    const navElement = this._ensureChromeHost('zNavBar', (el) => {
      if (zVaFElement && zVaFElement.parentNode) {
        zVaFElement.parentNode.insertBefore(el, zVaFElement);
      } else {
        document.body.insertBefore(el, document.body.firstChild);
      }
    });
    if (navElement) {
      this.client._zNavBarElement = navElement;
      // Populate asynchronously (don't block initialization).
      this.populateNavBar().catch(err => {
        this.logger.error('[ZVaFManager] Failed to populate navbar:', err);
      });
      this.logger.debug('[ZVaFManager] NavBar host ready, populating');
    }

    this.logger.log('[ZVaFManager] All elements initialized');
  }

  /**
   * Ensure a runtime-owned chrome host element exists, returning it.
   *
   * If the element is already in the DOM (e.g. a legacy template still declares
   * it) it is reused; otherwise it is created and placed via `place(el)`. This is
   * the hard-cut SSOT path — <zNavBar>/<zBifrostBadge> are no longer required in
   * app templates.
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

