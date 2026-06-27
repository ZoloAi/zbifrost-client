/**
 * 
 * Link Primitives - Semantic Link Rendering with Target Support
 * 
 *
 * Renders semantic HTML links with proper href, target, and security
 * attributes for zDisplay link events.
 *
 * @module rendering/link_primitives
 * @layer 1.0 (Event-aware primitive renderer)
 * @pattern Factory + Event Handler Pattern
 *
 * Philosophy:
 * - Semantic HTML (use <a> for navigation, not <button>)
 * - Security-first (auto-add rel="noopener noreferrer" for _blank)
 * - Target support (_blank, _self, _parent, _top, custom window.open())
 * - Mode-aware (handles internal vs external vs anchor links)
 *
 * Link Types:
 * - Internal Delta: $zAbout → Client-side routing
 * - Internal zPath: @.UI.zUI.zAbout → Client-side routing
 * - External: https://example.com → Native browser navigation
 * - Anchor: #section → Smooth scroll to element
 * - Placeholder: # → No navigation (styled text)
 *
 * Target Behavior:
 * - _self: Navigate in current tab (default)
 * - _blank: Open in a new tab (auto-add security)
 * - window: Open a sized pop-up via window.open() — size from `window:` or defaults
 * - _parent: Navigate parent frame
 * - _top: Navigate top-level frame
 *
 * Security:
 * - External _blank links: Auto-add rel="noopener noreferrer"
 * - Prevents window.opener exploitation (Tabnabbing attack)
 * - User can override via explicit rel parameter
 *
 * Dependencies:
 * - utils/dom_utils.js (createElement, setAttributes)
 * - bifrost_client.js (for client-side navigation)
 *
 * Exports:
 * - renderLink(linkData, container, client, logger) → HTMLAnchorElement
 *
 * Example:
 * ```javascript
 * import { renderLink } from './link_primitives.js';
 *
 * // Internal link
 * renderLink({
 *   label: 'About',
 *   href: '$zAbout',
 *   target: '_self'
 * }, container, bifrostClient);
 *
 * // External link (new tab)
 * renderLink({
 *   label: 'GitHub',
 *   href: 'https://github.com',
 *   target: '_blank',
 *   _zClass: 'zBtn zBtn-primary'
 * }, container, bifrostClient);
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 2: Utilities
import { createElement } from '../../../zSys/dom/dom_utils.js';

// Link type constants (must match backend ZLinkResolver.classify_href)
const LINK_TYPE_INTERNAL_DELTA = 'delta';
const LINK_TYPE_INTERNAL_ZPATH = 'zpath';
const LINK_TYPE_EXTERNAL = 'external';
const LINK_TYPE_ANCHOR = 'anchor';
const LINK_TYPE_PLACEHOLDER = 'placeholder';

// Named exports for shared use by text_renderer.js and other consumers
export { LINK_TYPE_INTERNAL_DELTA, LINK_TYPE_INTERNAL_ZPATH, LINK_TYPE_EXTERNAL, LINK_TYPE_ANCHOR, LINK_TYPE_PLACEHOLDER };

// Target constants
const TARGET_BLANK = '_blank';
const TARGET_SELF = '_self';
const TARGET_WINDOW = 'window';  // sized pop-up via window.open (size from `window:` or defaults)

// 
// Helper: Fallback Link Type Detection (Frontend Safety)
// 

/**
 * Detect link type from href when backend doesn't provide it.
 *
 * This is a fallback mechanism to ensure robust link rendering even
 * when the backend omits the link_type field. It mirrors the backend's
 * detection logic in display_event_links.py.
 *
 * @param {string} href - Link destination
 * @returns {string} Detected link type constant
 * @private
 */
export function detectLinkType(href) { return _detectLinkTypeFromHref(href); }

function _detectLinkTypeFromHref(href) {
  if (!href || href === '#') {
    return LINK_TYPE_PLACEHOLDER;
  }

  // External URLs (http, https, www)
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('www.')) {
    return LINK_TYPE_EXTERNAL;
  }

  // Anchor links (#section)
  if (href.startsWith('#') && href !== '#') {
    return LINK_TYPE_ANCHOR;
  }

  // Internal delta links ($zBlock)
  if (href.startsWith('$') || href.includes('$')) {
    return LINK_TYPE_INTERNAL_DELTA;
  }

  // Internal zPath links (@.UI.zUI.zBlock)
  if (href.startsWith('@')) {
    return LINK_TYPE_INTERNAL_ZPATH;
  }

  // Default: treat web routes (/path) as internal delta
  if (href.startsWith('/')) {
    return LINK_TYPE_INTERNAL_DELTA;
  }

  // Fallback: placeholder
  return LINK_TYPE_PLACEHOLDER;
}

// 
// Main Link Renderer
// 

/**
 * Render a semantic link with mode-aware behavior and target support.
 *
 * Handles internal navigation (client-side routing), external links
 * (native browser), anchor links (smooth scroll), and placeholder links
 * (styled text only).
 *
 * Security: Auto-adds rel="noopener noreferrer" for external _blank links.
 *
 * @param {Object} linkData - Link configuration from backend
 * @param {string} linkData.label - Link text to display
 * @param {string} linkData.href - Link destination
 * @param {string} linkData.target - Target behavior (_self, _blank, etc.)
 * @param {string} linkData.link_type - Detected link type (delta, external, etc.)
 * @param {string} [linkData.rel] - Link relationship (security)
 * @param {string} [linkData._zClass] - CSS classes for styling
 * @param {string} [linkData.color] - Color theme
 * @param {Object} [linkData.window] - Window.open() features
 * @param {HTMLElement} container - DOM element to append link to
 * @param {Object} client - BifrostClient instance for navigation
 *
 * @example
 * // Internal navigation
 * renderLink({
 *   label: 'About',
 *   href: '$zAbout',
 *   target: '_self',
 *   link_type: 'delta'
 * }, containerDiv, bifrostClient);
 *
 * @example
 * // External link with new tab
 * renderLink({
 *   label: 'Documentation',
 *   href: 'https://docs.example.com',
 *   target: '_blank',
 *   link_type: 'external',
 *   _zClass: 'zBtn zBtn-primary'
 * }, containerDiv, bifrostClient);
 *
 * @example
 * // Anchor link (smooth scroll)
 * renderLink({
 *   label: 'Features',
 *   href: '#features',
 *   target: '_self',
 *   link_type: 'anchor'
 * }, containerDiv, bifrostClient);
 */
export function renderLink(linkData, container, client, logger = console) {
  const {
    label,
    href,
    target = TARGET_SELF,
    link_type,
    rel = '',
    _zClass = '',
    color = '',
    window: windowFeatures = {},
    disabled = false,
    zBlock = null,
  } = linkData;

  let detectedLinkType = link_type;
  if (!detectedLinkType || detectedLinkType === 'undefined') {
    logger.warn('[LinkPrimitives] link_type missing, detecting from href:', href);
    detectedLinkType = _detectLinkTypeFromHref(href);
    logger.debug('[LinkPrimitives] Detected link type:', detectedLinkType, 'for href:', href);
  }

  // Create semantic <a> element
  const link = createElement('a');
  link.textContent = label;

  // TERMINAL-FIRST PATTERN: color is the source of truth
  // Smart class inference based on context:
  // - If _zClass has 'zBtn' → add zBtn-{color}
  // - If plain link (no zBtn) → add zText-{color}
  // - Group styling handled by orchestrator

  let hasButtonClass = false;
  if (_zClass) {
    const classes = _zClass.split(' ').filter(c => c.trim());
    if (classes.length > 0) {
      link.classList.add(...classes);
      hasButtonClass = classes.some(c => c === 'zBtn' || c.startsWith('zBtn-'));
    }
  }

  if (color) {
    const colorLower = color.toLowerCase();
    if (hasButtonClass) {
      const colorClass = `zBtn-${colorLower}`;
      if (!link.classList.contains(colorClass)) {
        link.classList.add(colorClass);
      }
    } else {
      const colorClass = `zText-${colorLower}`;
      link.classList.add(colorClass);
    }
  }

  // RBAC disabled — render non-clickable element (Python gate fired)
  if (disabled) {
    link.setAttribute('aria-disabled', 'true');
    link.style.pointerEvents = 'none';
    link.style.opacity = '0.4';
    link.style.cursor = 'not-allowed';
    logger.debug('[LinkPrimitives] Link disabled (RBAC denied by server):', href);
    if (container) container.appendChild(link);
    return link;
  }

  // Handle different link types using DETECTED type (fallback-safe)
  logger.debug('[LinkPrimitives] Setting up link type:', detectedLinkType, 'href:', href, 'hasClient:', !!client);
  switch (detectedLinkType) {
    case LINK_TYPE_INTERNAL_DELTA:
    case LINK_TYPE_INTERNAL_ZPATH:
    case 'internal_delta':  // Backend sends with underscore prefix
    case 'internal_zpath':  // Backend sends with underscore prefix
      _setupInternalLink(link, href, target, windowFeatures, client, logger, zBlock);
      break;

    case LINK_TYPE_EXTERNAL:
      _setupExternalLink(link, href, target, rel, windowFeatures, logger);
      break;

    case LINK_TYPE_ANCHOR:
      _setupAnchorLink(link, href, logger);
      break;

    case LINK_TYPE_PLACEHOLDER:
      _setupPlaceholderLink(link);
      break;

    default:
      logger.warn('[LinkPrimitives] Unknown link type after detection:', detectedLinkType);
      _setupPlaceholderLink(link);
  }

  // Append to container if provided (legacy), otherwise return element
  if (container) {
    container.appendChild(link);
  }
  return link;  // Return link element for direct use
}

// 
// zPath to URL Conversion
// 

/**
 * Convert zPath to URL path for client-side routing.
 * 
 * Example conversions:
 * - @.UI.zProducts.zTheme.zUI.zGrid.zGrid_Details → /zProducts/zTheme/zGrid
 * - @.UI.zAbout.zAbout_Details → /zAbout
 * - $zBlock → $zBlock (delta links pass through)
 * - /regular/path → /regular/path (web paths pass through)
 * 
 * @private
 * @param {string} href - zPath or regular path
 * @returns {string} URL path for navigation
 */
export function convertZPathToURL(href) { return _convertZPathToURL(href); }

function _convertZPathToURL(href) {
  // Pass through delta links ($) and web paths (/)
  if (!href.startsWith('@')) {
    return href;
  }
  
  // Parse zPath: @.UI.zProducts.zTheme.zUI.zGrid.zGrid_Details
  // 1. Remove @.UI. prefix
  // 2. Split remaining path by dots
  // 3. Remove zUI (file prefix marker)
  // 4. Remove final block name (ends with _Details or _Section)
  // 5. Convert to /path/format
  
  let path = href.replace(/^@\.UI\./, ''); // Remove @.UI.
  const parts = path.split('.');
  
  // Filter out zUI markers and block names (typically last segment with _)
  const pathParts = parts.filter((part, index) => {
    // Keep non-zUI parts
    if (part === 'zUI') return false;
    // Remove last segment if it looks like a block name (has underscore or ends in Details/Section)
    if (index === parts.length - 1 && (part.includes('_') || part.endsWith('Details') || part.endsWith('Section'))) {
      return false;
    }
    return true;
  });
  
  // Convert to /path format
  return '/' + pathParts.join('/');
}

// 
// Internal Link Setup (Client-Side Routing)
// 

/**
 * Setup internal link for client-side routing.
 *
 * Prevents default browser navigation and uses BifrostClient.navigate()
 * for SPA-style routing. Supports opening in new tab via window.open().
 *
 * @private
 * @param {HTMLAnchorElement} link - Link element to configure
 * @param {string} href - Internal path (delta or zPath)
 * @param {string} target - Target behavior
 * @param {Object} windowFeatures - Custom window features
 * @param {Object} client - BifrostClient instance
 * @param {Object} logger - Logger instance
 */
function _setupInternalLink(link, href, target, windowFeatures, client, logger, zBlock = null) {
  // Same-file delta hop ($Block) is NOT a route — it must dispatch zDelta over
  // the wire, exactly like a zBtn action: zDelta($Block). Sending it through
  // _navigateToRoute would 404 against /api/route-config (a block is not a URL).
  // This is what makes a zURL with href:$Block perform the SAME hop the zDelta
  // section's button does — the "one element, four destinations" promise, kept
  // in Bifrost too (zLink/external/#anchor already route correctly above).
  const isDelta = href.startsWith('$');

  // Convert zPath to URL path if needed (delta passes through unchanged)
  const navigationPath = _convertZPathToURL(href);

  logger.debug('[LinkPrimitives] _setupInternalLink called:', { href, navigationPath, isDelta, hasClient: !!client, hasNavigateMethod: !!(client && client._navigateToRoute) });

  // CRITICAL: Set href to the actual path for proper browser behavior
  // (middle-click, "Open in new tab", a11y). A delta has no URL — keep it inert.
  link.href = isDelta ? '#' : navigationPath;

  // Internal link setup (silent)

  link.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Delta hop — mirror ButtonRenderer's zDelta path (carry origin for zBack).
    if (isDelta) {
      const blockName = href.slice(1).trim();
      logger.debug('[LinkPrimitives] zURL delta hop →', blockName);
      if (client && typeof client.zDelta === 'function') {
        const originKey = client.navOriginKey ? client.navOriginKey(link) : null;
        client.zDelta(blockName, originKey);
      } else {
        logger.error('[LinkPrimitives] client.zDelta() not available for delta link:', href);
      }
      return;
    }

    logger.debug('[LinkPrimitives] Link clicked:', navigationPath);

    if (target === TARGET_WINDOW) {
      // Sized pop-up window — size from `window:` features (or defaults)
      _openInNewWindow(navigationPath, windowFeatures, client, logger, true);
    } else if (target === TARGET_BLANK) {
      // Plain new tab (no sizing)
      _openInNewWindow(navigationPath, {}, client, logger, false);
    } else {
      // Navigate in current tab via client-side routing. Carry the click-origin
      // ancestry chain (SSOT, verb-agnostic) so the server records WHERE this
      // zURL was clicked onto the departing scope — same field zLink/zDelta use.
      // This was the gap: plain zURL nav recorded nothing, so the whole crumb
      // trail came back as empty scopes.
      if (client && typeof client._navigateToRoute === 'function') {
        const origin = client.navOriginKey ? client.navOriginKey(link) : null;
        // zBlock rides out-of-band (server stamped it from the zPath tail). The
        // URL is file-level; this tells execute_walker WHICH block to run, so a
        // zURL/zAlpha to a non-default block lands there — zCLI parity.
        logger.debug('[LinkPrimitives] Calling client._navigateToRoute:', navigationPath, 'origin:', origin, 'zBlock:', zBlock);
        client._navigateToRoute(navigationPath, { zOrigin: origin, zBlock });
      } else {
        logger.error('[LinkPrimitives] [ERROR] BifrostClient._navigateToRoute() not available:', {
          hasClient: !!client,
          clientType: client ? client.constructor.name : 'none',
          clientKeys: client ? Object.keys(client).filter(k => k.includes('nav')) : []
        });
      }
    }
  });
}

// 
// External Link Setup (Native Browser Navigation)
// 

/**
 * Setup external link with proper security and target attributes.
 *
 * Auto-adds rel="noopener noreferrer" for _blank to prevent window.opener
 * exploitation (Tabnabbing attack).
 *
 * @private
 * @param {HTMLAnchorElement} link - Link element to configure
 * @param {string} href - External URL
 * @param {string} target - Target behavior
 * @param {string} rel - Link relationship
 * @param {Object} windowFeatures - Custom window features
 * @param {Object} logger - Logger instance
 */
function _setupExternalLink(link, href, target, rel, windowFeatures, logger) {
  link.href = href;

  // Security: Auto-add rel="noopener noreferrer" when opening a new tab/window
  if ((target === TARGET_BLANK || target === TARGET_WINDOW) && !rel) {
    link.rel = 'noopener noreferrer';
  } else if (rel) {
    link.rel = rel;
  }

  // target: window → sized pop-up via window.open (size from `window:` or defaults)
  if (target === TARGET_WINDOW) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      logger.debug('[LinkPrimitives] External link clicked (window pop-up):', href);
      _openInNewWindow(href, windowFeatures, null, logger, true);
    });
    return;
  }

  // _self / _blank / _parent / _top → native <a> behavior (browser handles it)
  link.target = target;
  link.addEventListener('click', (_e) => {
    logger.debug('[LinkPrimitives] External link clicked (native):', href);
    // No preventDefault - let browser handle normally
  });
}

// 
// Anchor Link Setup (Smooth Scroll)
// 

/**
 * Setup anchor link for smooth scrolling to target element.
 *
 * Uses scrollIntoView with smooth behavior for better UX.
 * Warns if target element not found.
 *
 * @private
 * @param {HTMLAnchorElement} link - Link element to configure
 * @param {string} href - Anchor hash (e.g., "#features")
 * @param {Object} logger - Logger instance
 */
function _setupAnchorLink(link, href, logger) {
  link.href = href;
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const targetElement = document.querySelector(href);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth' });
    } else {
      logger.warn(`[LinkPrimitives] Anchor target not found: ${href}`);
    }
  });
}

// 
// Placeholder Link Setup (No Navigation)
// 

/**
 * Setup placeholder link (no navigation action).
 *
 * Used for design/mock purposes or "coming soon" links.
 * Prevents default click behavior.
 *
 * @private
 * @param {HTMLAnchorElement} link - Link element to configure
 */
function _setupPlaceholderLink(link) {
  link.href = '#';

  // Placeholder link setup (silent)

  link.addEventListener('click', (e) => {
    e.preventDefault();
    // No action - just styled text
  });
}

// 
// Window.open() Helper
// 

/**
 * Open URL in new window with custom features.
 *
 * Centers the window on screen and applies custom width, height, and
 * window features (menubar, toolbar, etc.).
 *
 * @private
 * @param {string} url - URL to open
 * @param {Object} features - Window features
 * @param {number} [features.width=800] - Window width
 * @param {number} [features.height=600] - Window height
 * @param {string} [features.features] - Custom window.open() features string
 * @param {Object} client - BifrostClient (for internal URLs)
 * @param {Object} logger - Logger instance
 * @returns {Window|null} New window reference or null if blocked
 */
function _openInNewWindow(url, features = {}, client = null, logger = console, asPopup = false) {
  // asPopup=false → a plain new tab (no features). asPopup=true → a sized
  // pop-up window, using `window:` overrides when present, else our defaults.
  let featuresStr = '';
  if (asPopup) {
    const { width = 800, height = 600, features: customFeatures = '' } = features;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    featuresStr = customFeatures ||
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  }

  // For internal URLs with client, construct full URL
  let fullUrl = url;
  if (client && (url.startsWith('$') || url.startsWith('@'))) {
    // Convert zPath to URL path first
    const navigationPath = _convertZPathToURL(url);
    // Then construct full URL (same origin)
    fullUrl = `${window.location.origin}${navigationPath}`;
    logger.debug('[LinkPrimitives] Opening internal link in new window:', { 
      original: url, 
      converted: navigationPath,
      fullUrl 
    });
  }

  // Open new window
  const newWindow = window.open(fullUrl, '_blank', featuresStr);

  if (newWindow) {
    newWindow.focus();
    return newWindow;
  } else {
    logger.error('[LinkPrimitives] Popup blocked or failed to open');
    return null;
  }
}

export default { renderLink };

