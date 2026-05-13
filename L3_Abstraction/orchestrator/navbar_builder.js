/**
 * L3_Abstraction/orchestrator/navbar_builder.js
 * 
 * NavBar Building and Rendering
 * 
 * Handles navigation bar construction for both:
 * - Meta NavBar (from zSession config, rendered in <zNavBar> element)
 * - Content NavBar (from ~zNavBar* metadata in YAML content)
 * 
 * Delegates actual rendering to NavigationRenderer (L2).
 * 
 * Extracted from zdisplay_orchestrator.js (Phase 4.3)
 */

/**
 * NavBarBuilder - Constructs and renders navigation bars
 */
export class NavBarBuilder {
  constructor(client, logger) {
    this.client = client;
    this.logger = logger;
  }

  /**
   * 3A: Wire event delegation onto a server-built navbar element.
   *
   * Python emits data-nav-action="navigate|dropdown-toggle|hamburger" so the
   * client needs zero construction logic — only generic interaction handling.
   *
   * @param {HTMLElement} navEl - The <nav> element injected from nav_html
   * @param {Object} client    - BifrostClient (for navigationManager access)
   * @param {Object} logger    - Logger instance
   */
  static wireNavBarEvents(navEl, client, logger) {
    if (!navEl) return;

    // ── Hamburger (mobile toggle) ────────────────────────────────────
    const toggler = navEl.querySelector('[data-nav-action="hamburger"]');
    if (toggler) {
      const targetId = toggler.dataset.navTarget;
      const collapse = navEl.querySelector(`#${targetId}`);
      toggler.addEventListener('click', (e) => {
        e.preventDefault();
        const expanded = toggler.getAttribute('aria-expanded') === 'true';
        toggler.setAttribute('aria-expanded', String(!expanded));
        collapse?.classList.toggle('show', !expanded);
        collapse?.classList.toggle('zShow', !expanded);
      });
    }

    // ── Dropdown toggles ─────────────────────────────────────────────
    navEl.querySelectorAll('[data-nav-action="dropdown-toggle"]').forEach(toggle => {
      const menu = toggle.nextElementSibling;
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        const isOpen = menu?.classList.contains('zShow');
        // Close all sibling dropdowns
        navEl.querySelectorAll('.zDropdown-menu.zShow').forEach(m => {
          if (m !== menu) {
            m.classList.remove('zShow');
            m.previousElementSibling?.setAttribute('aria-expanded', 'false');
          }
        });
        menu?.classList.toggle('zShow', !isOpen);
        toggle.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    // ── Navigation links ─────────────────────────────────────────────
    navEl.querySelectorAll('[data-nav-action="navigate"]').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const href = link.dataset.navHref || link.getAttribute('href');
        // Close enclosing dropdown (if any)
        const menu = link.closest('.zDropdown-menu');
        if (menu) {
          menu.classList.remove('zShow');
          menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
        }
        if (client?.navigationManager) {
          client.navigationManager.navigateToRoute(href);
        } else {
          window.location.href = href;
        }
      });
    });

    // ── Close dropdowns on outside click ─────────────────────────────
    setTimeout(() => {
      document.addEventListener('click', (e) => {
        if (!navEl.contains(e.target)) {
          navEl.querySelectorAll('.zDropdown-menu.zShow').forEach(menu => {
            menu.classList.remove('zShow');
            menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
          });
        }
      });
    }, 100);

    if (logger) logger.debug('[NavBarBuilder] wireNavBarEvents attached');
  }

  /**
   * Render navbar DOM element (v1.6.1: Returns DOM element to preserve event listeners)
   * Used for meta navbar (from zSession config) rendered in <zNavBar> element
   * @param {Array} items - Navbar items (e.g., ['zVaF', 'zAbout', '^zLogin'])
   * @param {Object} options - Client options (for title/brand)
   * @returns {Promise<HTMLElement|null>} Navbar DOM element
   */
  async renderMetaNavBarHTML(items, options) {
    this.logger.debug('[NavBarBuilder] renderMetaNavBarHTML called:', items.length);

    if (!Array.isArray(items) || items.length === 0) {
      this.logger.warn('[NavBarBuilder] [WARN] No navbar items provided');
      return null;
    }

    try {
      // Load navigation renderer
      const navRenderer = await this.client._ensureNavigationRenderer();

      // Render navbar element
      const navElement = navRenderer.renderNavBar(items, {
        className: 'zcli-navbar-meta',
        theme: 'light',
        href: (item) => {
          // Strip modifiers (^ for bounce-back, ~ for anchor) from URL
          const cleanItem = item.replace(/^[\^~]+/, '');
          return `/${cleanItem}`;
        },
        brand: options.brand || options.title  // Use dedicated brand field (always zSpark)
      });

      // FIX v1.6.1: Return DOM element directly (NOT outerHTML!)
      // This preserves event listeners attached by link_primitives.js
      // The caller (zvaf_manager.js) will append the element instead of setting innerHTML
      this.logger.log('[NavBarBuilder] Returning navbar DOM element (preserves event listeners)');
      return navElement;
    } catch (error) {
      this.logger.error('[NavBarBuilder] Failed to render navbar element:', error);
      return null;
    }
  }

  /**
   * Render navigation bar from metadata (~zNavBar* in content)
   * Used for content-embedded navbars in YAML
   * @param {Array} items - Navbar items
   * @param {HTMLElement} parentElement - Parent element to append to
   */
  async renderNavBar(items, parentElement) {
    if (!Array.isArray(items) || items.length === 0) {
      this.logger.warn('[NavBarBuilder] ~zNavBar* has no items or is not an array');
      return;
    }

    try {
      // Load navigation renderer
      const navRenderer = await this.client._ensureNavigationRenderer();

      // Render navbar with zTheme zNavbar component
      const navElement = navRenderer.renderNavBar(items, {
        theme: 'light'
      });

      if (navElement) {
        parentElement.appendChild(navElement);

        // Re-initialize zTheme collapse now that navbar is in DOM
        if (window.zTheme && typeof window.zTheme.initCollapse === 'function') {
          window.zTheme.initCollapse();
          this.logger.log('[NavBarBuilder] Re-initialized zTheme collapse for navbar');
        }

        this.logger.log('[NavBarBuilder] Rendered navigation bar with items:', items);
      }
    } catch (error) {
      this.logger.error('[NavBarBuilder] Failed to render navigation bar:', error);
    }
  }
}
