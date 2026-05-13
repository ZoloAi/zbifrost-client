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
   * Initialize zVaF elements (v1.6.0: Simplified - elements exist in HTML, just populate)
   */
  initZVaFElements() {
    this.logger.debug('[ZVaFManager] Starting initialization');

    if (typeof document === 'undefined') {
      this.logger.warn('[ZVaFManager] Not in browser environment');
      return;
    }

    // Step 1: Find badge element (created by template)
    const badgeElement = document.querySelector('zBifrostBadge');
    if (badgeElement) {
      this.client._zConnectionBadge = badgeElement;
      this.populateConnectionBadge();
      this.logger.debug('[ZVaFManager] Badge element found and populated');
    } else {
      this.logger.error('[ZVaFManager] [ERROR] <zBifrostBadge> not found in DOM');
    }

    // Step 2: Find navbar element (created by template)
    const navElement = document.querySelector('zNavBar');
    if (navElement) {
      this.client._zNavBarElement = navElement;
      // Fetch and populate navbar asynchronously (don't block initialization)
      this.populateNavBar().catch(err => {
        this.logger.error('[ZVaFManager] Failed to populate navbar:', err);
      });
      this.logger.debug('[ZVaFManager] NavBar element found, populating');
    } else {
      this.logger.error('[ZVaFManager] [ERROR] <zNavBar> not found in DOM');
    }

    // Step 3: Find zVaF element (content renders directly into it)
    const zVaFElement = document.querySelector(this.options.targetElement) ||
                        document.getElementById(this.options.targetElement);
    if (zVaFElement) {
      this.client._zVaFElement = zVaFElement;
      this.logger.debug('[ZVaFManager] zVaF element found');
    } else {
      this.logger.error(`[ZVaFManager] [ERROR] <${this.options.targetElement}> not found in DOM`);
    }

    this.logger.log('[ZVaFManager] All elements initialized');
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

