/**
 * ═══════════════════════════════════════════════════════════════
 * Bifrost Constants - Centralized Constants (SSOT)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Single source of truth for all constants used across the Bifrost
 * client architecture. Eliminates 730+ instances of duplication.
 * 
 * @module bifrost_constants
 * @layer 0 (Constants - imported by all layers)
 * 
 * Dependencies: None
 * 
 * Exports:
 * - TIMEOUTS: Request/connection/animation timeouts
 * - COLORS: Semantic color names
 * - SIZES: Component size variants
 * - EVENT_TYPES: DOM and WebSocket event types
 * - CSS_CLASSES: Common zTheme class names
 * - TYPOGRAPHY: Font weights and styles
 * 
 * Usage:
 * ```javascript
 * import { TIMEOUTS, CSS_CLASSES } from '../constants/bifrost_constants.js';
 * setTimeout(() => {}, TIMEOUTS.FADE_TRANSITION);
 * element.classList.add(CSS_CLASSES.CARD.BODY);
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Timeout Constants (30+ occurrences across 10 files)
// ─────────────────────────────────────────────────────────────────
export const TIMEOUTS = {
  // Request/Connection timeouts
  REQUEST_TIMEOUT: 30000,        // 30 seconds - Default request timeout
  RECONNECT_DELAY: 3000,         // 3 seconds - Delay between reconnect attempts
  
  // Auto-dismiss timeouts
  AUTO_DISMISS: 10000,           // 10 seconds - Default auto-dismiss for alerts
  AUTO_DISMISS_SHORT: 5000,      // 5 seconds - Short auto-dismiss
  
  // Animation/Transition timeouts
  FADE_TRANSITION: 300,          // 300ms - Fade in/out transitions
  AUTO_REMOVE_SPINNER: 3000,     // 3 seconds - Auto-remove spinner
  AUTO_REMOVE_PROGRESS: 2000,    // 2 seconds - Auto-remove progress bar
  
  // Debounce/Throttle timeouts
  DEBOUNCE_WIDGET: 1000,         // 1 second - Widget hook debounce
};

// ─────────────────────────────────────────────────────────────────
// Color Constants (150+ occurrences across 29 files)
// ─────────────────────────────────────────────────────────────────
export const COLORS = {
  // Semantic colors (primary UI actions)
  SEMANTIC: ['primary', 'secondary', 'success', 'danger', 'warning', 'info'],
  
  // Neutral colors (backgrounds, borders)
  NEUTRAL: ['light', 'dark', 'white', 'black'],
  
  // State colors (alerts, signals)
  STATES: ['error', 'success', 'warning', 'info'],
  
  // Individual color names (for validation)
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  SUCCESS: 'success',
  DANGER: 'danger',
  WARNING: 'warning',
  INFO: 'info',
  ERROR: 'error',
  LIGHT: 'light',
  DARK: 'dark',
  WHITE: 'white',
  BLACK: 'black',
};

// ─────────────────────────────────────────────────────────────────
// Size Constants (20+ occurrences across 6 files)
// ─────────────────────────────────────────────────────────────────
export const SIZES = {
  // Button sizes
  BUTTON: ['sm', 'md', 'lg'],
  
  // Spinner sizes
  SPINNER: ['sm', 'md', 'lg'],
  
  // Icon sizes
  ICON: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
  
  // Individual size names
  EXTRA_SMALL: 'xs',
  SMALL: 'sm',
  MEDIUM: 'md',
  LARGE: 'lg',
  EXTRA_LARGE: 'xl',
  EXTRA_LARGE_2X: '2xl',
};

// ─────────────────────────────────────────────────────────────────
// Event Type Constants (80+ occurrences across 18 files)
// ─────────────────────────────────────────────────────────────────
export const EVENT_TYPES = {
  // DOM Events
  CLICK: 'click',
  CHANGE: 'change',
  SUBMIT: 'submit',
  INPUT: 'input',
  FOCUS: 'focus',
  BLUR: 'blur',
  KEYDOWN: 'keydown',
  KEYUP: 'keyup',
  
  // WebSocket Events (zBifrost protocol)
  RENDER_CHUNK: 'render_chunk',
  CONNECTION_INFO: 'connection_info',
  NAVIGATE_BACK: 'navigate_back',
  ERROR: 'error',
};

// ─────────────────────────────────────────────────────────────────
// CSS Class Constants (300+ occurrences across 30 files)
// ─────────────────────────────────────────────────────────────────
export const CSS_CLASSES = {
  // Card classes
  CARD: {
    BASE: 'zCard',
    BODY: 'zCard-body',
    TITLE: 'zCard-title',
    SUBTITLE: 'zCard-subtitle',
    TEXT: 'zCard-text',
    HEADER: 'zCard-header',
    FOOTER: 'zCard-footer',
    IMG: 'zCard-img',
    IMG_TOP: 'zCard-img-top',
  },
  
  // Input group classes
  INPUT_GROUP: {
    BASE: 'zInputGroup',
    TEXT: 'zInputGroup-text',
    PREPEND: 'zInputGroup-prepend',
    APPEND: 'zInputGroup-append',
  },
  
  // List group classes
  LIST_GROUP: {
    BASE: 'zList-group',
    ITEM: 'zList-group-item',
    ITEM_ACTION: 'zList-group-item-action',
  },
  
  // Navbar classes
  NAVBAR: {
    BASE: 'zNavbar',
    LIGHT: 'zNavbar-light',
    DARK: 'zNavbar-dark',
    EXPAND_LG: 'zNavbar-expand-lg',
  },
  
  // Background classes (prefix)
  BG_PREFIX: 'zBg-',
  
  // Text color classes (prefix)
  TEXT_PREFIX: 'zText-',
  
  // Border classes (prefix)
  BORDER_PREFIX: 'zBorder-',
  
  // Button classes (prefix)
  BUTTON_PREFIX: 'zBtn',
};

// ─────────────────────────────────────────────────────────────────
// Typography Constants (10+ occurrences across 4 files)
// ─────────────────────────────────────────────────────────────────
export const TYPOGRAPHY = {
  FONT_WEIGHTS: {
    LIGHT: '300',
    NORMAL: '400',
    MEDIUM: '500',
    SEMIBOLD: '600',
    BOLD: '700',
  },
};

// ─────────────────────────────────────────────────────────────────
// Z-Index Layers (Stacking Context)
// ─────────────────────────────────────────────────────────────────
export const Z_INDEX = {
  ERROR_CONTAINER: 10000,  // Error display container (highest)
  MODAL: 1000,             // Modal overlays
  DROPDOWN: 100,           // Dropdowns and popovers
  STICKY: 10,              // Sticky headers
  BASE: 1,                 // Base layer
};

// ─────────────────────────────────────────────────────────────────
// WebSocket Close Codes
// ─────────────────────────────────────────────────────────────────
export const WS_CLOSE_CODES = {
  NORMAL: 1000,            // Normal closure
  GOING_AWAY: 1001,        // Endpoint going away
  PROTOCOL_ERROR: 1002,    // Protocol error
  UNSUPPORTED: 1003,       // Unsupported data
  ABNORMAL: 1006,          // Abnormal closure (no status)
};

// ─────────────────────────────────────────────────────────────────
// Spacing Values (Rem-based spacing scale)
// ─────────────────────────────────────────────────────────────────
export const SPACING = {
  NONE: '0',
  XXS: '0.25rem',    // 4px
  XS: '0.5rem',      // 8px
  SM: '0.75rem',     // 12px
  MD: '1rem',        // 16px
  LG: '1.5rem',      // 24px
  XL: '2rem',        // 32px
  XXL: '3rem',       // 48px
};

// ─────────────────────────────────────────────────────────────────
// Position Constants
// ─────────────────────────────────────────────────────────────────
export const POSITIONS = {
  TOP_RIGHT: 'top-right',
  TOP_LEFT: 'top-left',
  BOTTOM_RIGHT: 'bottom-right',
  BOTTOM_LEFT: 'bottom-left',
  TOP_CENTER: 'top-center',
  BOTTOM_CENTER: 'bottom-center',
};
