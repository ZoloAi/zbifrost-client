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
    // zPath strings (@.UI.* not yet resolved): minimum-depth uniqueness algorithm.
    // Floor = depth 1 (the block leaf) — the SAME leaf rule session crumbs use
    // server-side (scope.rsplit('.',1)[-1]); manual just escalates on collision, so
    // both modes read the same clean leaf label (SSOT). Escalates only when leaves clash.
    const stripped = paths.map(p => p.split('#')[0]);
    const parts = stripped.map(p => p.split('.'));
    const maxDepth = Math.max(...parts.map(p => p.length));
    for (let depth = 1; depth < maxDepth; depth++) {
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
    // "@.zViews.zStack.zOS.Grammar.NavigationEvents" → strip root prefix → split → drop
    // mount root (idx 0). Keep EVERY remaining segment — this must match the Python
    // resolver (zCLI is truth); no z-prefix filter, or Grammar/NavigationEvents vanish.
    const folderParts = folder.replace(/^[@~]\./, '').split('.');
    const segments = folderParts.slice(1).filter(p => p);
    const fileLabel = file.startsWith('zUI.') ? file.slice(4) : file;
    return [...segments, ...(fileLabel ? [fileLabel] : [])];
  }

  _formatLabel(item) {
    return String(item).replace(/_/g, ' ');
  }

  /**
   * Crumb navigator factory — a crumb click is a BULK-BACK: zLink re-enters the
   * scope and, because that scope is already on the session trail, the server's
   * execute_walker reconciliation POPS every scope opened after it (the lone
   * POP_TO — mirrors zCLI handle_zCrumb_back). The OMEGA (an in-scope section
   * anchor) rides as zPsi so a section crumb lands ON its section after the page
   * repaints; a bare scope crumb (omega=null) lands at the top. zCLI ignores the
   * omega (no viewport) — same intent, mode-aware skin.
   * @param {string} zPath  scope zPath to bulk-back to
   * @param {string|null} omega  in-scope section key to scroll to (Bifrost only)
   * @returns {(e:Event)=>Promise<void>}
   */
  _zLinkNav(zPath, omega = null) {
    return async (e) => {
      e.preventDefault();
      if (!zPath || !this.client) return;
      this.logger.log(`[Breadcrumbs] zCrumb bulk-back → ${zPath}${omega ? ` (omega: ${omega})` : ''}`);
      try {
        if (typeof this.client.zLink === 'function') {
          await this.client.zLink(zPath, null, omega);
        } else if (this.client.navigationManager) {
          const url = this.client._zLinkPathToUrl?.(zPath) || zPath;
          await this.client.navigationManager.navigateToRoute(url);
        }
      } catch (err) {
        this.logger.error('[Breadcrumbs] zCrumb bulk-back failed:', err);
      }
    };
  }

  /**
   * Route navigator factory — structure crumbs use real URL routes.
   * @param {string} href
   * @returns {(e:Event)=>void}
   */
  _routeNav(href) {
    return (e) => {
      e.preventDefault();
      if (this.client?.navigationManager) {
        this.client.navigationManager.navigateToRoute(href);
      } else {
        window.location.href = href;
      }
    };
  }

  /**
   * THE one breadcrumb renderer — every crumb type (session, manual, structure,
   * static) funnels through here so they share ONE style, verbatim. Produces the
   * canonical ribbon: a single continuous rail (no container box) that flows and
   * WRAPS PER ITEM like text and ends exactly after the last crumb. Crumbs
   * flex-grow to justify each wrapped row to a common right edge; an invisible
   * .zCrumb-fill soaks the LAST row's slack so the final line stays natural. The
   * current crumb is the accent fill; first crumb rounds the left end, last the
   * right. Roles: lead (bold), om (link), ev (plain). Optional .zT1 scope tint.
   *
   * @param {Array<{text:string, role:('lead'|'om'|'ev'), tint?:boolean,
   *                active?:boolean, nav?:(e:Event)=>any}>} crumbs
   * @param {string} [aria='breadcrumb']
   * @returns {HTMLElement}
   */
  _buildRibbon(crumbs, aria = 'breadcrumb') {
    const nav  = createNav({ 'aria-label': aria, class: 'zmb-3' });
    const rail = createDiv({ class: 'zBreadcrumb zBreadcrumb-echo' });
    let last = null;

    crumbs.forEach((c) => {
      const role = c.role === 'lead' ? 'zCrumb-lead'
                 : c.role === 'ev'   ? 'zCrumb-ev'
                 :                     'zCrumb-om';
      const cls = `zCrumb ${role}${c.tint ? ' zT1' : ''}${c.active ? ' zCrumb-on' : ''}`;
      let el;
      if (c.nav) {
        el = createLink('#', { class: cls });
        el.onclick = c.nav;
      } else {
        el = createSpan({ class: cls });
      }
      el.textContent = this._formatLabel(c.text);
      if (c.active) el.setAttribute('aria-current', 'page');
      rail.appendChild(el);
      last = el;
    });

    if (last) last.classList.add('zCrumb-end');   // round the ribbon's right end
    rail.appendChild(createSpan({ class: 'zCrumb-fill' }));  // slack-eater
    nav.appendChild(rail);
    return nav;
  }

  /**
   * Render the SESSION echo — a faithful, unfiltered mirror of zSession's crumb
   * trail (the voodoo X-ray, NOT the curated page-chain). Each canonical hop
   * ({label, path, keys}) lays down, in order: a bold scope LEAD (the $arrival
   * marker if present, else the derived block label — a zLink back into the
   * scope), then its chain of SECTION crumbs (zOmega anchors), then the terminal
   * EVENT crumb (plain, the clicked verb). The fill TINT flips per scope to mark
   * boundaries; the current scope (last hop) is the accent. Funnels through the
   * shared _buildRibbon so it is byte-for-byte the same style as every other
   * crumb type — zCLI↔Bifrost differ only in recorder density, never display.
   *
   * @param {Array<{label:string, path:string, keys:string[]}>} trail
   * @returns {HTMLElement}
   */
  _renderSessionEcho(trail) {
    const crumbs = [];

    trail.forEach((hop, index) => {
      const isLast = index === trail.length - 1;
      const tint   = (index % 2 === 1);                    // alternate scope tint
      const keys   = Array.isArray(hop.keys) ? hop.keys : [];

      // lead: ALWAYS the clean block label. The α<block> arrival sentinel is an
      // engine firewall, not a navigational crumb — the projector flags it via
      // hop.arrival so the GUI drops it WITHOUT knowing the glyph (zCLI keeps the
      // raw sentinel in its X-ray). Fall back to a glyph check only if an older
      // server omits the flag.
      const hasArrival = hop.arrival === true ||
        (keys.length > 0 && /^[$\u03b1]/.test(String(keys[0])));
      const leadText   = hop.label;
      const chain      = hasArrival ? keys.slice(1) : keys;

      crumbs.push({
        text: leadText, role: 'lead', tint, active: isLast,
        nav: (!isLast && hop.path) ? this._zLinkNav(hop.path) : null
      });

      // chain: sections (zOmega anchors) then the terminal event (plain). The
      // clicked leaf is always the chain tail, so last = event, rest = sections.
      // A section crumb carries ITS OWN key as the omega so the bulk-back lands
      // on that section: zLink(hop.path, omega=k) → server pops to the scope and
      // walker_complete scrolls to [data-zkey="k"]. Top-level sections resolve;
      // deeper ancestry (Inner/Grid/Card) gracefully no-ops (no data-zkey) but
      // still bulk-backs to the scope top — an honest, non-fatal landing.
      chain.forEach((k, ki) => {
        const isEvent = ki === chain.length - 1;
        crumbs.push({
          text: k,
          role: isEvent ? 'ev' : 'om',
          tint, active: isLast,
          nav: (!isEvent && !isLast && hop.path) ? this._zLinkNav(hop.path, k) : null
        });
      });
    });

    this.logger.debug('[NavigationRenderer] Rendered session echo (%s scopes)', trail.length);
    return this._buildRibbon(crumbs, 'session breadcrumb');
  }

  /**
   * Render breadcrumbs from a zCrumbs display event.
   *
   * Bifrost receives the raw expander display_data: {event, show, header, trail?, parent?}
   * — the Python zCrumbs() method does NOT run in Bifrost mode (chunks are pre-built).
   * All derivation (labels, structure trail) must happen here in JS.
   *
   * Modes (mirror the Python resolver — zCLI is truth, ONE logic per mode):
   *   manual    — trail[] of zPaths in eventData; derive labels; ancestors are zLink clickable
   *   structure — derive trail from client.zuiConfig.zVaFolder/zVaFile; optional `parent` is a
   *               zPath on the route that trims the front so the trail starts at its page
   *   session   — crumbs from separate try_gui_event payload (crumbs key) if present; else empty
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
    let structureSegs  = null;  // raw URL segments for structure mode (post-trim, display)
    let structureFull  = null;  // full derived segments (pre-trim, for cumulative routes)
    let structureOffset = 0;    // index where the displayed trail starts (parent trim)

    if (show === 'manual') {
      // trail: array of zPaths injected by the expander
      const rawPaths = (eventData.trail || []).map(p => String(p).trim().replace(/^["']|["']$/g, ''));
      if (!rawPaths.length) return null;
      displayLabels = this._deriveZpathLabels(rawPaths);
      navPaths = rawPaths;
      this.logger.debug('[NavigationRenderer] manual mode, labels:', displayLabels);

    } else if (show === 'structure') {
      // Derive from current page context — raw segments double as URL path parts.
      // SAME logic as the Python resolver (zCLI is truth): parent is a zPath ALREADY
      // ON THE ROUTE that tells the SAME trail where to start — the deepest of its
      // segments on the trail becomes the first crumb; everything above is trimmed.
      structureFull = this._deriveStructureTrail();
      if (!structureFull.length) return null;
      const parentPath = eventData.parent || '';
      if (parentPath) {
        const pSegs = parentPath.replace(/^[@~]\./, '').split('.').filter(s => s && s !== 'zUI');
        for (let i = pSegs.length - 1; i >= 0; i--) {
          const idx = structureFull.indexOf(pSegs[i]);
          if (idx !== -1) { structureOffset = idx; break; }
        }
      }
      structureSegs = structureFull.slice(structureOffset);
      if (!structureSegs.length) return null;
      displayLabels = structureSegs;
      this.logger.debug('[NavigationRenderer] structure mode, zMenu=%s, offset=%s, trail:', zMenu, structureOffset, displayLabels);

    } else if (show === 'session') {
      // Session crumbs are a FAITHFUL, UNFILTERED echo of zSession's trail (the
      // raw zWizard state — innate engine output, mostly CLI + debugging). The
      // server hands over canonical hops verbatim (crumbs.trail = [{label, path,
      // keys}, ...]) — no slimming. The display never filters; density is the
      // recorder's job. We render every scope as a stripe carrying its keys on a
      // single wrapping rail (its own renderer, NOT the curated manual/structure
      // page-chain). Empty/absent → no history yet → render nothing (honest).
      const crumbsData = eventData.crumbs || {};
      const trail = Array.isArray(crumbsData.trail) ? crumbsData.trail : [];
      if (!trail.length) {
        this.logger.debug('[NavigationRenderer] session mode: no crumbs data, skipping');
        return null;
      }
      this.logger.debug('[NavigationRenderer] session echo, hops:', trail.map(t => t.label));
      return this._renderSessionEcho(trail);
    }

    if (!displayLabels || !displayLabels.length) return null;

    // Build the crumb descriptors, then funnel through the ONE shared ribbon
    // renderer so manual / structure share the exact same style as the session
    // echo. Only the per-crumb nav (zLink vs route vs inert) differs.
    const crumbs = displayLabels.map((label, index) => {
      const isLast = index === displayLabels.length - 1;
      if (isLast) {
        // current page — the accent end, never navigable
        return { text: label, role: 'lead', active: true, nav: null };
      }
      if (show === 'manual' && navPaths && navPaths[index]) {
        // manual ancestors: clickable zLink only when zMenu opts in
        return zMenu
          ? { text: label, role: 'om', nav: this._zLinkNav(navPaths[index]) }
          : { text: label, role: 'ev', nav: null };
      }
      if (show === 'structure' && structureSegs) {
        // structure ancestors: cumulative URL route from the FULL path (so a parent-
        // trimmed trail still routes correctly), clickable only with zMenu
        const href = '/' + structureFull.slice(0, structureOffset + index + 1).join('/');
        return zMenu
          ? { text: label, role: 'om', nav: this._routeNav(href) }
          : { text: label, role: 'ev', nav: null };
      }
      // static (legacy) ancestors: display-only
      return { text: label, role: 'ev', nav: null };
    });

    this.logger.debug('[NavigationRenderer] Rendered breadcrumbs (%s mode, %s items)', show, displayLabels.length);
    return this._buildRibbon(crumbs, `${show} breadcrumb`);
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

