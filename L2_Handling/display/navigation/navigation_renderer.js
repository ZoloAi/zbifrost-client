/**
 * 
 * Navigation Renderer - zTheme Navigation Components
 * 
 *
 * Renders navigation components aligned with zTheme:
 * - zNav (navigation bars)
 * - zNavbar (top navigation)
 * - zBreadcrumb (breadcrumb trails)
 * - zTabs (tabbed navigation)
 * - zPagination (page navigation)
 * - Sidebar navigation
 * - Dropdown menus
 *
 *  REFACTORED: Uses Layer 0 primitives
 *
 * @module rendering/navigation_renderer
 * @layer 3
 * @pattern Strategy (navigation components)
 *
 * @see https://github.com/ZoloAi/zTheme - zTheme Navigation
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 2: Utilities
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

// Layer 0: Primitives
import { createNav } from '../primitives/document_structure_primitives.js';
import { createList, createListItem } from '../primitives/lists_primitives.js';
import { createLink, createButton } from '../primitives/interactive_primitives.js';
import { createDiv, createSpan } from '../primitives/generic_containers.js';
import { renderLink } from '../primitives/link_primitives.js';

export class NavigationRenderer {
  constructor(logger = null, client = null) {
    this.logger = logger || console;
    this.client = client; // NEW: Store client for link rendering

    // Wrap renderNavBar method with error boundary
    // Note: We wrap it after the class is fully initialized
    const proto = Object.getPrototypeOf(this);
    if (proto.renderNavBar) {
      const originalRenderNavBar = proto.renderNavBar.bind(this);
      this.renderNavBar = withErrorBoundary(originalRenderNavBar, {
        component: 'NavigationRenderer.renderNavBar',
        logger: this.logger
      });
    }
  }

  /**
   * Render a navigation bar from menu items (zTheme zNavbar component)
   * @param {Array<string|Object>} items - Array of navigation items (strings or {label, href})
   * @param {Object} options - Rendering options
   * @returns {HTMLElement} - Navigation element with zNavbar classes
   * @see https://github.com/ZoloAi/zTheme/blob/main/src/css/zNavbar.css
   */
  renderNavBar(items, options = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      this.logger.warn('[NavigationRenderer] No items provided for navbar');
      return null;
    }

    const {
      className = 'zcli-navbar-meta',
      theme = 'light',
      activeIndex = null,
      href = '#',
      brand = null
    } = options;

    // Generate unique ID for collapse target
    const collapseId = `navbar-collapse-${Math.random().toString(36).substr(2, 9)}`;

    // Create nav container with zNavbar component classes (using primitive)
    const nav = createNav({
      class: `zNavbar zNavbar-${theme} ${className}`,
      role: 'navigation'
    });

    // Add brand/logo if provided (using primitive)
    if (brand) {
      const brandLink = createLink('/', { class: 'zNavbar-brand' });
      brandLink.textContent = brand;
      nav.appendChild(brandLink);
    }

    // Create mobile hamburger toggle button (using primitive)
    const toggleButton = createButton('button', {
      class: 'zNavbar-toggler',
      'data-bs-toggle': 'collapse',
      'data-bs-target': `#${collapseId}`,
      'aria-controls': collapseId,
      'aria-expanded': 'false',
      'aria-label': 'Toggle navigation'
    });

    // Add Bootstrap Icon (hamburger menu)
    toggleButton.innerHTML = `
      <i class="bi bi-list" style="font-size: 1.5rem;"></i>
    `;
    nav.appendChild(toggleButton);

    // Create navbar collapse wrapper (using primitive)
    const collapseDiv = createDiv({
      class: 'zNavbar-collapse',
      id: collapseId
    });

    //  FIX: Add manual toggle handler (zTheme doesn't include Bootstrap JS)
    toggleButton.addEventListener('click', (e) => {
      e.preventDefault();
      const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';

      // Toggle aria state
      toggleButton.setAttribute('aria-expanded', !isExpanded);

      // Toggle visibility (try both 'show' and 'zShow' for compatibility)
      if (isExpanded) {
        collapseDiv.classList.remove('show', 'zShow');
        this.logger.debug('[NavigationRenderer] Navbar collapsed');
      } else {
        collapseDiv.classList.add('show', 'zShow');
        this.logger.debug('[NavigationRenderer] Navbar expanded');
      }
    });
    this.logger.debug('[NavigationRenderer] Hamburger toggle attached to:', collapseId);

    // Create navigation list (using primitive)
    const ul = createList(false, { class: 'zNavbar-nav' });

    //  REFACTORED: Use link_primitives.js for ALL navigation links
    // This ensures consistent behavior between navbar and content links
    items.forEach((item, index) => {
      const li = createListItem({ class: 'zNav-item' });

      // Check if this is a hierarchical item with zSub
      if (typeof item === 'object' && item !== null && !item.label && !item.href) {
        // Dict format: {"zProducts": {"zSub": ["zCLI", "zBifrost", ...]}}
        const itemName = Object.keys(item)[0];
        const itemData = item[itemName];
        
        if (itemData && typeof itemData === 'object' && itemData.zSub && Array.isArray(itemData.zSub)) {
          // This is a hierarchical menu item - render using zTheme's zDropdown component
          li.classList.add('zDropdown'); // zTheme dropdown container
          
          const parentLabel = itemName.replace(/^[$^~]+/, '');
          const parentHref = this._convertDeltaLinkToHref(itemName);
          
          // Create dropdown toggle link (zTheme adds caret automatically via ::after)
          const dropdownLink = createLink(parentHref, {
            class: `zNav-link zDropdown-toggle${activeIndex === index ? ' active' : ''}`,
            'data-toggle': 'dropdown',
            'aria-haspopup': 'true',
            'aria-expanded': 'false'
          });
          dropdownLink.textContent = parentLabel;
          
          // Create dropdown menu using zTheme classes
          const dropdownMenu = createDiv({ class: 'zDropdown-menu' });
          
          // Add sub-items using zTheme's zDropdown-item class
          itemData.zSub.forEach(subItem => {
            const subHref = `${parentHref}/${subItem}`;
            const subLink = createLink(subHref, { class: 'zDropdown-item' });
            subLink.textContent = subItem;
            
            // Add click handler for internal navigation
            subLink.addEventListener('click', (e) => {
              e.preventDefault();
              // Close dropdown after selection
              dropdownMenu.classList.remove('zShow');
              dropdownLink.setAttribute('aria-expanded', 'false');
              
              if (this.client && this.client.navigationManager) {
                this.client.navigationManager.navigateToRoute(subHref);
              } else {
                window.location.href = subHref;
              }
            });
            
            dropdownMenu.appendChild(subLink);
          });
          
          // Toggle dropdown on click (zTheme pattern)
          dropdownLink.addEventListener('click', (e) => {
            e.preventDefault();
            const isOpen = dropdownMenu.classList.contains('zShow');
            
            // Close all other dropdowns
            document.querySelectorAll('.zDropdown-menu.zShow').forEach(menu => {
              if (menu !== dropdownMenu) {
                menu.classList.remove('zShow');
                const toggle = menu.previousElementSibling;
                if (toggle) toggle.setAttribute('aria-expanded', 'false');
              }
            });
            
            // Toggle this dropdown
            if (isOpen) {
              dropdownMenu.classList.remove('zShow');
              dropdownLink.setAttribute('aria-expanded', 'false');
            } else {
              dropdownMenu.classList.add('zShow');
              dropdownLink.setAttribute('aria-expanded', 'true');
            }
          });
          
          li.appendChild(dropdownLink);
          li.appendChild(dropdownMenu);
          ul.appendChild(li);
          
          this.logger.debug(`[NavigationRenderer] Created dropdown for ${parentLabel}`);
          return; // Continue to next item
        }
      }

      // Handle simple item as string or object {label, href}
      let itemLabel, itemHref, originalItem;
      if (typeof item === 'string') {
        // Strip navigation prefixes for clean display
        // $ (delta link), ^ (bounce-back), ~ (anchor)
        // Example: "$^zLogin" → "zLogin"
        originalItem = item;
        itemLabel = item.replace(/^[$^~]+/, '');
        // Convert delta links ($zBlock) to web routes (/zBlock)
        itemHref = this._convertDeltaLinkToHref(item);
      } else if (typeof item === 'object' && item !== null) {
        originalItem = item.label || item.text || '';
        itemLabel = originalItem.replace(/^[$^~]+/, '');
        itemHref = item.href || this._convertDeltaLinkToHref(itemLabel);
      } else {
        originalItem = String(item);
        itemLabel = originalItem;
        itemHref = href;
      }

      // Detect link type for renderLink primitive
      const linkType = this._detectLinkType(itemHref, originalItem);

      // Prepare link data for renderLink primitive
      const linkData = {
        label: itemLabel,
        href: itemHref,
        target: '_self',
        link_type: linkType,
        _zClass: `zNav-link${activeIndex === index ? ' active' : ''}`,
        color: '',
        window: {}
      };

      this.logger.debug('[NavigationRenderer] Creating navbar link:', linkData.label);

      // Use renderLink primitive (now returns element directly)
      const link = renderLink(linkData, null, this.client, this.logger);

      if (link) {
        li.appendChild(link);
      } else {
        this.logger.error('[NavigationRenderer] [ERROR] renderLink returned no link element');
      }

      ul.appendChild(li);
    });

    // Assemble: ul -> collapseDiv -> nav
    collapseDiv.appendChild(ul);
    nav.appendChild(collapseDiv);

    // Close dropdowns when clicking outside (zTheme pattern)
    const closeDropdowns = (e) => {
      if (!nav.contains(e.target)) {
        nav.querySelectorAll('.zDropdown-menu.zShow').forEach(menu => {
          menu.classList.remove('zShow');
          const toggle = menu.previousElementSibling;
          if (toggle) {
            toggle.setAttribute('aria-expanded', 'false');
          }
        });
      }
    };
    
    // Use setTimeout to avoid immediate triggering
    setTimeout(() => {
      document.addEventListener('click', closeDropdowns);
    }, 100);

    this.logger.info('[NavigationRenderer] Rendered navbar (%s items)', items.length);

    return nav;
  }

  /**
   * Convert delta link notation ($zBlock) to web route (/zBlock)
   *
   * Delta links ($) are used in YAML for intra-file navigation.
   * Navigation modifiers (^, ~) are stripped for clean URLs.
   * In Bifrost mode, these are converted to web routes for proper navigation.
   *
   * @param {string} item - Item text (may contain $^zBlock notation with modifiers)
   * @returns {string} - Web-friendly href
   * @private
   */
  _convertDeltaLinkToHref(item) {
    if (typeof item !== 'string') {
      return '#';
    }

    // Strip all navigation prefixes: $ (delta), ^ (bounce-back), ~ (anchor)
    // Example: "$^zLogin" → "zLogin" → "/zLogin"
    const cleanBlock = item.replace(/^[$^~]+/, '');

    // Check if original item had $ (delta link) or other navigation prefixes
    if (item !== cleanBlock) {
      // Had navigation prefixes - convert to web route
      return `/${cleanBlock}`;
    }

    // Default: use item as-is (for explicit /path or # links)
    return item.startsWith('/') || item.startsWith('#') ? item : `/${item}`;
  }

  /**
   * Detect link type from href and original item.
   *
   * This mirrors the logic in link_primitives.js to ensure consistent
   * link type detection across navbar and content links.
   *
   * @param {string} href - Converted href (e.g., "/zBlock")
   * @param {string} originalItem - Original item with prefixes (e.g., "$zBlock")
   * @returns {string} - Link type: 'delta', 'zpath', 'external', 'anchor', 'placeholder'
   * @private
   */
  _detectLinkType(href, originalItem) {
    // Check original item for navigation prefixes
    if (originalItem && typeof originalItem === 'string') {
      // Delta link ($) - internal navigation
      if (originalItem.startsWith('$') || originalItem.includes('$')) {
        return 'delta';
      }
      // zPath (@) - absolute path navigation
      if (originalItem.startsWith('@')) {
        return 'zpath';
      }
    }

    // Check href for external URLs
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('www.')) {
      return 'external';
    }

    // Check for anchor links
    if (href.startsWith('#') && href !== '#') {
      return 'anchor';
    }

    // Placeholder link
    if (!href || href === '#') {
      return 'placeholder';
    }

    // Default: treat as delta (internal navigation)
    return 'delta';
  }

  /**
   * Render breadcrumb navigation (zTheme-styled)
   * @param {Array<string>} trail - Breadcrumb trail items
   * @param {Object} options - Rendering options
   * @returns {HTMLElement} - Breadcrumb element with zTheme classes
   */
  renderBreadcrumb(trail, options = {}) {
    if (!Array.isArray(trail) || trail.length === 0) {
      return null;
    }

    const {
      separator = '>',
      className = 'zcli-breadcrumb'
    } = options;

    const nav = createNav({
      class: `${className} zmb-3`,
      'aria-label': 'breadcrumb'
    });

    const ol = createList(true, {
      class: 'zD-flex zFlex-row zFlex-items-center zGap-2'
    });
    ol.style.listStyle = 'none';
    ol.style.padding = '0';
    ol.style.margin = '0';

    trail.forEach((item, index) => {
      const li = createListItem({ class: 'breadcrumb-item' });

      if (index === trail.length - 1) {
        // Last item (current page) - use muted text, bold weight (using primitive)
        const span = createSpan({
          class: 'zText-muted zFw-bold',
          'aria-current': 'page'
        });
        span.textContent = item;
        li.appendChild(span);
      } else {
        // Link to parent pages - use primary color (using primitive)
        const a = createLink('#', { class: 'zText-primary zText-decoration-none' });
        a.textContent = item;
        li.appendChild(a);
      }

      ol.appendChild(li);

      // Add separator (except after last item) (using primitive)
      if (index < trail.length - 1) {
        const sep = createSpan({ class: 'breadcrumb-separator zText-muted' });
        sep.textContent = ` ${separator} `;
        ol.appendChild(sep);
      }
    });

    nav.appendChild(ol);
    return nav;
  }

  /**
   * Render breadcrumbs from zCrumbs display event (handles multiple trails)
   * Uses zTheme breadcrumb structure: nav > ol.zBreadcrumb > li.zBreadcrumb-item
   * 
   * Single trail: Returns <nav> directly (no wrapper div) - semantic HTML like zH1
   * Multi-trail: Returns container div with multiple navs + scope labels
   * 
   * @param {Object} eventData - Event data from backend zCrumbs event
   * @returns {HTMLElement|null} - nav element (single trail) or container div (multi-trail)
   * @see zOS/zTheme/Manual/ztheme-breadcrumb.html
   */
  /**
   * Derive display labels from an array of zPaths using minimum-depth uniqueness.
   * Mirrors the Python _derive_zpath_labels logic for Bifrost-side label rendering.
   * @param {string[]} paths - Array of zPath strings (may include #N suffixes)
   * @returns {string[]} - Unique display labels at minimum consistent depth
   */
  _deriveZpathLabels(paths) {
    if (!paths || paths.length === 0) return [];
    // resolve_zpath_references converts @.UI.* zPaths to HTTP routes before the chunk is
    // sent to Bifrost (e.g. @.UI.zProducts.zUI.zOS.zOS → /zProducts/zOS).
    // URL paths have no '.' separators, so the dot-split algorithm yields empty strings.
    // Detect URL-format paths and derive labels from the last non-empty path segment instead.
    if (paths[0] && paths[0].startsWith('/')) {
      return paths.map(p => {
        const segs = p.split('/').filter(Boolean);
        return segs.length > 0 ? segs[segs.length - 1] : p;
      });
    }
    // zPath strings (@.UI.* not yet resolved): minimum-depth uniqueness algorithm
    const stripped = paths.map(p => p.split('#')[0]);
    const parts = stripped.map(p => p.split('.'));
    const maxDepth = Math.max(...parts.map(p => p.length));
    for (let depth = 2; depth < maxDepth; depth++) {
      const labels = parts.map(p => p.slice(-depth).join('.'));
      if (new Set(labels).size === labels.length) return labels;
    }
    return parts.map(p => p.slice(1).join('.'));
  }

  /**
   * Derive structure trail from the client's current page context.
   * Reads zVaFolder + zVaFile from bifrostClient.zuiConfig — the runtime SSOT.
   * @returns {string[]} - Folder segments + file label (e.g. ['zProducts','zOS','Events','zNavigation'])
   */
  _deriveStructureTrail() {
    const folder = this.client?.zuiConfig?.zVaFolder || '';
    const file   = this.client?.zuiConfig?.zVaFile   || '';
    if (!folder && !file) return [];
    // "@.UI.zProducts.zOS.Events" → strip root prefix → "UI.zProducts.zOS.Events" → split → drop mount root
    const folderParts = folder.replace(/^[@~]\./, '').split('.');
    // Keep only z-prefixed segments (named sections like zProducts, zOS).
    // Plain organizational folders (Events, UI, etc.) are file-system details, not nav levels.
    const segments = folderParts.slice(1).filter(p => p && p.startsWith('z'));
    const fileLabel = file.startsWith('zUI.') ? file.slice(4) : file;
    return [...segments, ...(fileLabel ? [fileLabel] : [])];
  }

  _formatLabel(item) {
    return String(item).replace(/_/g, ' ');
  }

  /**
   * Render breadcrumbs from a zCrumbs display event.
   *
   * Bifrost receives the raw expander display_data: {event, show, header, trail?, parent?}
   * — the Python zCrumbs() method does NOT run in Bifrost mode (chunks are pre-built).
   * All derivation (labels, structure trail) must happen here in JS.
   *
   * Modes:
   *   manual    — trail[] of zPaths in eventData; derive labels; ancestors are zLink clickable
   *   structure — derive trail from client.zuiConfig.zVaFolder/zVaFile; ancestors display-only
   *   session   — crumbs from separate try_gui_event payload (crumbs key) if present; else empty
   *   static    — legacy: parent dot-path in eventData; display-only ancestors
   *
   * @param {Object} eventData - Raw event from backend: {event, show, trail?, parent?, crumbs?}
   * @returns {HTMLElement|null}
   */
  renderBreadcrumbs(eventData) {
    this.logger.debug('[NavigationRenderer] renderBreadcrumbs called', eventData);

    const show    = eventData.show || 'session';
    const zMenu   = eventData.zMenu === true || eventData.zMenu === 'true';
    let displayLabels  = [];
    let navPaths       = null;  // zPaths for manual mode
    let structureSegs  = null;  // raw URL segments for structure mode

    if (show === 'manual') {
      // trail: array of zPaths injected by the expander
      const rawPaths = (eventData.trail || []).map(p => String(p).trim().replace(/^["']|["']$/g, ''));
      if (!rawPaths.length) return null;
      displayLabels = this._deriveZpathLabels(rawPaths);
      navPaths = rawPaths;
      this.logger.debug('[NavigationRenderer] manual mode, labels:', displayLabels);

    } else if (show === 'structure') {
      // Derive from current page context — raw segments double as URL path parts
      structureSegs = this._deriveStructureTrail();
      if (!structureSegs.length) return null;
      displayLabels = structureSegs;
      this.logger.debug('[NavigationRenderer] structure mode, zMenu=%s, trail:', zMenu, displayLabels);

    } else if (show === 'session') {
      // Session crumbs: the server slims the live trail into a visit-ordered
      // page-chain (crumbs.trail = [{label, path}, ...]) and attaches it to the
      // chunk. Empty/absent → no history yet → render nothing (honest).
      const crumbsData = eventData.crumbs || {};
      const trail = Array.isArray(crumbsData.trail) ? crumbsData.trail : [];
      if (!trail.length) {
        this.logger.debug('[NavigationRenderer] session mode: no crumbs data, skipping');
        return null;
      }
      displayLabels = trail.map(t => (t && t.label != null) ? String(t.label) : '');
      navPaths = trail.map(t => (t && t.path != null) ? String(t.path) : '');
      this.logger.debug('[NavigationRenderer] session mode, labels:', displayLabels);

    } else if (show === 'static') {
      // Legacy: parent dot-path → display-only label trail
      const parent = eventData.parent || '';
      if (!parent) return null;
      displayLabels = parent.split('.');
      this.logger.debug('[NavigationRenderer] static (legacy) mode, labels:', displayLabels);
    }

    if (!displayLabels || !displayLabels.length) return null;

    // Build nav > ol.zBreadcrumb
    const nav = createNav({ 'aria-label': `${show} breadcrumb`, class: 'zmb-3' });
    const ol  = createList(true, { class: 'zBreadcrumb' });

    displayLabels.forEach((label, index) => {
      const isLast = index === displayLabels.length - 1;
      const li = createListItem({
        class: isLast ? 'zBreadcrumb-item zActive' : 'zBreadcrumb-item'
      });

      if (isLast) {
        li.setAttribute('aria-current', 'page');
        li.textContent = this._formatLabel(label);
      } else if ((show === 'manual' || show === 'session') && navPaths && navPaths[index]) {
        // manual/session ancestors: clickable zLink. manual honors zMenu; session
        // ancestors are always navigable (they ARE the live navigation chain).
        const zPath = navPaths[index];
        if (zMenu || show === 'session') {
          const a = createLink('#', {});
          a.textContent = this._formatLabel(label);
          a.onclick = async (e) => {
            e.preventDefault();
            this.logger.log(`[Breadcrumbs] zLink → ${zPath}`);
            if (this.client) {
              try {
                if (typeof this.client.zLink === 'function') {
                  await this.client.zLink(zPath);
                } else if (this.client.navigationManager) {
                  const url = this.client._zLinkPathToUrl?.(zPath) || zPath;
                  await this.client.navigationManager.navigateToRoute(url);
                }
              } catch (err) {
                this.logger.error('[Breadcrumbs] zLink failed:', err);
              }
            }
          };
          li.appendChild(a);
        } else {
          // disabled link — same visual as zMenu:true but non-clickable
          const a = createLink('#', {
            'aria-disabled': 'true',
            tabindex: '-1'
          });
          a.style.pointerEvents = 'none';
          a.style.cursor = 'default';
          a.textContent = this._formatLabel(label);
          li.appendChild(a);
        }
      } else if (show === 'structure' && structureSegs) {
        // structure ancestors: cumulative URL path from folder segments
        const href = '/' + structureSegs.slice(0, index + 1).join('/');
        if (zMenu) {
          // zMenu: true → real navigable link
          const a = createLink(href, {});
          a.textContent = this._formatLabel(label);
          a.onclick = (e) => {
            e.preventDefault();
            if (this.client?.navigationManager) {
              this.client.navigationManager.navigateToRoute(href);
            } else {
              window.location.href = href;
            }
          };
          li.appendChild(a);
        } else {
          // zMenu: false (default) → disabled link (same visual, non-clickable)
          const a = createLink(href, {
            'aria-disabled': 'true',
            tabindex: '-1'
          });
          a.style.pointerEvents = 'none';
          a.style.cursor = 'default';
          a.textContent = this._formatLabel(label);
          li.appendChild(a);
        }
      } else {
        // session / static ancestors: display-only span
        const span = createSpan({ class: 'zText-muted' });
        span.textContent = this._formatLabel(label);
        li.appendChild(span);
      }

      ol.appendChild(li);
    });

    nav.appendChild(ol);
    this.logger.debug('[NavigationRenderer] Rendered breadcrumbs (%s mode, %s items)', show, displayLabels.length);
    return nav;
  }

  /**
   * Render vertical sidebar navigation (zTheme-styled)
   * @param {Array<string>} items - Navigation item labels
   * @param {Object} options - Rendering options
   * @returns {HTMLElement} - Sidebar nav element with zTheme classes
   */
  renderSidebarNav(items, options = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    const {
      className = 'zcli-sidebar-nav',
      activeIndex = null
    } = options;

    // Sidebar container with zTheme utilities (using primitive)
    const nav = createNav({ class: `${className} zBg-light zP-3 zRounded` });
    nav.style.width = '200px';

    const ul = createList(false, { class: 'zD-flex zFlex-column zGap-2' });
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';

    items.forEach((item, index) => {
      const li = createListItem({ class: 'sidebar-item' });

      const a = createLink('#');
      a.textContent = item;

      // zTheme sidebar link: padding, display block, rounded
      a.className = 'sidebar-link zText-dark zText-decoration-none zP-2 zD-block zRounded';

      // Active state with zTheme classes
      if (activeIndex === index) {
        a.classList.add('zBg-primary', 'zText-white', 'zFw-bold');
      }

      // Hover effect via zTheme classes
      a.addEventListener('mouseenter', () => {
        if (activeIndex !== index) {
          a.classList.add('zBg-white');
        }
      });
      a.addEventListener('mouseleave', () => {
        if (activeIndex !== index) {
          a.classList.remove('zBg-white');
        }
      });

      li.appendChild(a);
      ul.appendChild(li);
    });

    nav.appendChild(ul);
    return nav;
  }
}

