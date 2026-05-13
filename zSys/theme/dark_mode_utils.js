/**
 * ═══════════════════════════════════════════════════════════════
 * Dark Mode Utilities - Theme Management (Layer 2)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Pure utility functions for managing dark/light theme modes.
 * Extracted from duplicate implementations in hooks.js and bifrost_client.js.
 * 
 * @module utils/dark_mode_utils
 * @layer 2 (Utilities - Pure functions)
 * 
 * Dependencies: None (Layer 0 - Browser APIs only)
 * 
 * Exports:
 * - applyDarkModeClasses(isDark, options): Apply/remove dark mode classes
 * - toggleDarkMode(currentIsDark): Toggle between dark/light and persist
 * - getDarkModeFromStorage(): Get saved theme preference
 * - saveDarkModeToStorage(isDark): Persist theme preference
 * 
 * Example:
 * ```javascript
 * import { applyDarkModeClasses, toggleDarkMode } from '../../zSys/theme/dark_mode_utils.js';
 * applyDarkModeClasses(true); // Enable dark mode
 * const newTheme = toggleDarkMode(false); // Returns 'dark'
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'zTheme-mode';
const THEME_DARK = 'dark';
const THEME_LIGHT = 'light';
const COLOR_WHITE = '#ffffff';

const SELECTORS = {
  NAVBAR: '.zNavbar',
  NAVBAR_TOGGLER: '.zNavbar-toggler',
  THEME_TOGGLE: '.zTheme-toggle',
  BOOTSTRAP_ICON: 'i.bi',
  CARD: '.zCard',
  HEADERS: 'h1, h2, h3, h4, h5, h6',
  PARAGRAPHS: 'p',
};

const CLASSES = {
  BG_DARK: 'zBg-dark',
  TEXT_LIGHT: 'zText-light',
  NAVBAR_LIGHT: 'zNavbar-light',
  NAVBAR_DARK: 'zNavbar-dark',
  NAVBAR_TOGGLER_DARK: 'zNavbar-toggler-dark',
};

// ─────────────────────────────────────────────────────────────────
// Storage Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Get dark mode preference from localStorage
 * @returns {boolean} True if dark mode is enabled
 */
export function getDarkModeFromStorage() {
  return localStorage.getItem(STORAGE_KEY) === THEME_DARK;
}

/**
 * Save dark mode preference to localStorage
 * @param {boolean} isDark - Whether dark mode is enabled
 */
export function saveDarkModeToStorage(isDark) {
  localStorage.setItem(STORAGE_KEY, isDark ? THEME_DARK : THEME_LIGHT);
}

// ─────────────────────────────────────────────────────────────────
// Theme Application Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Apply or remove dark mode classes to page elements
 * @param {boolean} isDark - Whether to apply dark mode
 * @param {Object} options - Configuration options
 * @param {HTMLElement} [options.contentArea] - Content area element (defaults to body)
 * @param {Function} [options.logger] - Optional logger for debugging
 * @returns {void}
 */
export function applyDarkModeClasses(isDark, options = {}) {
  const { contentArea = document.body, logger = null } = options;
  
  const body = document.body;
  const navbars = document.querySelectorAll(SELECTORS.NAVBAR);
  const togglers = document.querySelectorAll(SELECTORS.NAVBAR_TOGGLER);
  
  if (logger && logger.log) {
    logger.log(`[DarkMode] Applying ${isDark ? 'DARK' : 'LIGHT'} mode`);
    logger.log(`[DarkMode] Found ${navbars.length} navbar(s), ${togglers.length} toggler(s)`);
  }
  
  if (isDark) {
    // Apply dark mode
    _applyDarkMode(body, navbars, togglers, contentArea, logger);
  } else {
    // Remove dark mode
    _removeDarkMode(body, navbars, togglers, contentArea, logger);
  }
}

/**
 * Apply dark mode classes and styles
 * @private
 */
function _applyDarkMode(body, navbars, togglers, contentArea, logger) {
  // Apply dark background to body
  body.classList.add(CLASSES.BG_DARK);
  body.style.backgroundColor = 'var(--color-dark)';
  
  // Apply white text to headers/paragraphs outside cards
  _applyLightTextToElements(contentArea, logger);
  
  // Update navbars
  navbars.forEach(nav => {
    nav.classList.remove(CLASSES.NAVBAR_LIGHT);
    nav.classList.add(CLASSES.NAVBAR_DARK);
    if (logger && logger.log) {
      logger.log('[DarkMode] Navbar classes:', nav.className);
    }
  });
  
  // Update navbar togglers (hamburger icons)
  togglers.forEach((toggler, idx) => {
    toggler.classList.add(CLASSES.NAVBAR_TOGGLER_DARK);
    const icon = toggler.querySelector(SELECTORS.BOOTSTRAP_ICON);
    if (icon) {
      icon.style.color = COLOR_WHITE;
    }
    if (logger && logger.log) {
      const computedColor = icon ? window.getComputedStyle(icon).color : 'not found';
      logger.log(`[DarkMode] Toggler ${idx} classes:`, toggler.className);
      logger.log(`[DarkMode] Toggler ${idx} icon color:`, computedColor);
    }
  });
  
  // Update theme toggle button icon
  const themeToggleBtn = document.querySelector(SELECTORS.THEME_TOGGLE);
  if (themeToggleBtn) {
    const icon = themeToggleBtn.querySelector(SELECTORS.BOOTSTRAP_ICON);
    if (icon) {
      icon.style.color = COLOR_WHITE;
      if (logger && logger.log) {
        logger.log('[DarkMode] Theme toggle icon color set to white');
      }
    }
  } else if (logger && logger.log) {
    logger.log('[DarkMode] Theme toggle button not found yet');
  }
}

/**
 * Remove dark mode classes and styles
 * @private
 */
function _removeDarkMode(body, navbars, togglers, contentArea, logger) {
  // Remove dark background from body
  body.classList.remove(CLASSES.BG_DARK);
  body.style.backgroundColor = '';
  body.style.color = '';
  
  // Remove white text from elements
  _removeLightTextFromElements(contentArea, logger);
  
  // Update navbars
  navbars.forEach(nav => {
    nav.classList.remove(CLASSES.NAVBAR_DARK);
    nav.classList.add(CLASSES.NAVBAR_LIGHT);
    if (logger && logger.log) {
      logger.log('[DarkMode] Navbar classes:', nav.className);
    }
  });
  
  // Update navbar togglers
  togglers.forEach((toggler, idx) => {
    toggler.classList.remove(CLASSES.NAVBAR_TOGGLER_DARK);
    const icon = toggler.querySelector(SELECTORS.BOOTSTRAP_ICON);
    if (icon) {
      icon.style.color = '';
    }
    if (logger && logger.log) {
      const computedColor = icon ? window.getComputedStyle(icon).color : 'not found';
      logger.log(`[DarkMode] Toggler ${idx} classes:`, toggler.className);
      logger.log(`[DarkMode] Toggler ${idx} icon color:`, computedColor);
    }
  });
  
  // Clear theme toggle button icon color
  const themeToggleBtn = document.querySelector(SELECTORS.THEME_TOGGLE);
  if (themeToggleBtn) {
    const icon = themeToggleBtn.querySelector(SELECTORS.BOOTSTRAP_ICON);
    if (icon) {
      icon.style.color = '';
      if (logger && logger.log) {
        logger.log('[DarkMode] Theme toggle icon color cleared');
      }
    }
  }
}

/**
 * Apply light text to headers and paragraphs outside cards
 * @private
 */
function _applyLightTextToElements(contentArea, logger) {
  if (!contentArea) return;
  
  // Apply white text to headers outside cards
  contentArea.querySelectorAll(SELECTORS.HEADERS).forEach(header => {
    if (!header.closest(SELECTORS.CARD)) {
      header.classList.add(CLASSES.TEXT_LIGHT);
    }
  });
  
  // Apply white text to paragraphs outside cards
  contentArea.querySelectorAll(SELECTORS.PARAGRAPHS).forEach(p => {
    if (!p.closest(SELECTORS.CARD)) {
      p.classList.add(CLASSES.TEXT_LIGHT);
    }
  });
}

/**
 * Remove light text from all elements
 * @private
 */
function _removeLightTextFromElements(contentArea, logger) {
  if (!contentArea) return;
  
  contentArea.querySelectorAll(`.${CLASSES.TEXT_LIGHT}`).forEach(el => {
    el.classList.remove(CLASSES.TEXT_LIGHT);
  });
}

// ─────────────────────────────────────────────────────────────────
// Toggle Function
// ─────────────────────────────────────────────────────────────────

/**
 * Toggle between dark and light mode
 * @param {boolean} currentIsDark - Current dark mode state
 * @param {Object} options - Configuration options (passed to applyDarkModeClasses)
 * @returns {string} New theme ('dark' or 'light')
 */
export function toggleDarkMode(currentIsDark, options = {}) {
  const newIsDark = !currentIsDark;
  saveDarkModeToStorage(newIsDark);
  applyDarkModeClasses(newIsDark, options);
  return newIsDark ? THEME_DARK : THEME_LIGHT;
}

// ─────────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────────

/**
 * Initialize dark mode from localStorage on page load
 * @param {Object} options - Configuration options (passed to applyDarkModeClasses)
 * @returns {boolean} Whether dark mode is active
 */
export function initializeDarkMode(options = {}) {
  const isDark = getDarkModeFromStorage();
  if (isDark) {
    applyDarkModeClasses(true, options);
  }
  return isDark;
}
