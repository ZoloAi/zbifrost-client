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

        // Navigate to the new path via WebSocket
        await this.navigateToRoute(path, { skipHistory: true });
      };

      window.addEventListener('popstate', this.client._popstateHandler);
    }

    this.logger.debug('[ClientNav] Enabled');
  }

  /**
   * Navigate to a route via WebSocket (client-side navigation)
   * @param {string} routePath - Path to navigate to (e.g., '/zAbout', '/zAccount')
   * @param {Object} options - Navigation options
   */
  async navigateToRoute(routePath, options = {}) {
    const { skipHistory = false } = options;

    this.client._isClientSideNav = true;

    try {
      this.logger.info('[ClientNav] Navigating to: %s', routePath);

      // 2B: Python owns route resolution — ask the server for walker params
      const res = await fetch(`/api/route-config?path=${encodeURIComponent(routePath)}`);
      if (!res.ok) {
        throw new Error(`Route not found: ${routePath} (${res.status})`);
      }
      const { zBlock, zVaFile, zVaFolder } = await res.json();

      this.logger.debug('[ClientNav] Route config', { zVaFile, zVaFolder, zBlock });

      // Clear current content and show loading state
      if (this.client._zVaFElement) {
        this.client._zVaFElement.innerHTML = '<div class="zText-center zp-4">Loading...</div>';
      }

      // Send walker execution request via WebSocket
      const walkerRequest = { event: 'execute_walker', zBlock, zVaFile, zVaFolder };
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

      window.scrollTo({ top: 0, behavior: 'smooth' });

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

