/**
 * CDN Loader - External asset loading utilities
 * 
 * Centralized logic for loading external CSS/JS from CDNs.
 * Extracted from bifrost_client.js to reduce main file size.
 * 
 * @module bootstrap/cdn_loader
 * @layer -1 (Bootstrap)
 * 
 * Pattern: ES module (not UMD - only used by bifrost_client.js)
 * 
 * Usage:
 * ```javascript
 * import { loadZThemeCDN, loadBootstrapIcons, loadPrismJS } from './bootstrap/cdn_loader.js';
 * await loadZThemeCDN('https://cdn.jsdelivr.net/gh/ZoloAi/zTheme@main/dist');
 * await loadBootstrapIcons();
 * await loadPrismJS();
 * ```
 * 
 * Created in Phase 2
 */

/**
 * Load zTheme CSS and JS from CDN
 * 
 * @param {string} cdnBaseUrl - CDN base URL (default: jsdelivr ZoloAi/zTheme)
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
export async function loadZThemeCDN(cdnBaseUrl = 'https://cdn.jsdelivr.net/gh/ZoloAi/zTheme@main/dist', logger = console) {
  if (typeof document === 'undefined') {
    logger.warn('[CDN] Not in browser environment - skipping zTheme CDN load');
    return;
  }

  // Check if already loaded
  if (document.querySelector('link[href*="zTheme"]')) {
    logger.log('[CDN] zTheme CSS already loaded');
    return;
  }

  logger.log(`[CDN] Loading zTheme from: ${cdnBaseUrl}`);

  // Load CSS
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = `${cdnBaseUrl}/zTheme.css`;
  document.head.appendChild(cssLink);

  // Load JS (if exists)
  try {
    const jsScript = document.createElement('script');
    jsScript.src = `${cdnBaseUrl}/zTheme.js`;
    jsScript.async = true;
    document.head.appendChild(jsScript);
    
    await new Promise((resolve, reject) => {
      jsScript.onload = resolve;
      jsScript.onerror = () => {
        logger.warn('[CDN] zTheme JS not found (CSS-only mode)');
        resolve(); // Non-fatal
      };
    });
  } catch (err) {
    logger.warn('[CDN] Failed to load zTheme JS:', err);
  }

  logger.log('[CDN] zTheme loaded successfully');
}

/**
 * Load Bootstrap Icons from CDN
 * 
 * @param {string} cdnUrl - CDN URL (default: jsdelivr bootstrap-icons)
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
export async function loadBootstrapIcons(
  cdnUrl = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  logger = console
) {
  if (typeof document === 'undefined') {
    logger.warn('[CDN] Not in browser environment - skipping Bootstrap Icons');
    return;
  }

  // Check if already loaded
  if (document.querySelector('link[href*="bootstrap-icons"]')) {
    logger.log('[CDN] Bootstrap Icons already loaded');
    return;
  }

  logger.log('[CDN] Loading Bootstrap Icons');

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cdnUrl;
  document.head.appendChild(link);

  await new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = () => {
      logger.warn('[CDN] Failed to load Bootstrap Icons');
      resolve(); // Non-fatal
    };
  });

  logger.log('[CDN] Bootstrap Icons loaded');
}

/**
 * Load Prism.js from CDN
 * 
 * @param {string} baseUrl - Base URL for Prism assets
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
export async function loadPrismJS(baseUrl = null, logger = console) {
  if (typeof document === 'undefined') {
    logger.warn('[CDN] Not in browser environment - skipping Prism.js');
    return;
  }

  // Check if already loaded
  if (window.Prism) {
    logger.log('[CDN] Prism.js already loaded');
    return;
  }

  logger.log('[CDN] Loading Prism.js');

  // Determine base URL (prefer local, fallback to CDN)
  const prismBaseUrl = baseUrl || 'https://cdn.jsdelivr.net/npm/prismjs@1.29.0';

  // Load CSS
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = `${prismBaseUrl}/themes/prism.css`;
  document.head.appendChild(cssLink);

  // Load JS
  const script = document.createElement('script');
  script.src = `${prismBaseUrl}/prism.js`;
  script.async = true;
  document.head.appendChild(script);

  await new Promise((resolve) => {
    script.onload = resolve;
    script.onerror = () => {
      logger.warn('[CDN] Failed to load Prism.js');
      resolve(); // Non-fatal
    };
  });

  logger.log('[CDN] Prism.js loaded');
}

/**
 * Generic CSS loader
 * 
 * @param {string} href - CSS file URL
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
export async function loadCSS(href, logger = console) {
  if (typeof document === 'undefined') {
    return;
  }

  // Check if already loaded
  if (document.querySelector(`link[href="${href}"]`)) {
    logger.debug(`[CDN] CSS already loaded: ${href}`);
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);

  await new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = () => {
      logger.warn(`[CDN] Failed to load CSS: ${href}`);
      resolve(); // Non-fatal
    };
  });
}

/**
 * Generic JS loader
 * 
 * @param {string} src - JS file URL
 * @param {Object} logger - Logger instance
 * @returns {Promise<void>}
 */
export async function loadJS(src, logger = console) {
  if (typeof document === 'undefined') {
    return;
  }

  // Check if already loaded
  if (document.querySelector(`script[src="${src}"]`)) {
    logger.debug(`[CDN] JS already loaded: ${src}`);
    return;
  }

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  document.head.appendChild(script);

  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load: ${src}`));
  });
}
