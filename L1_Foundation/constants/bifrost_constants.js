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
 * - EVENT_TYPES: DOM event names (browser-native)
 * - PROTOCOL_EVENTS / PROTOCOL_REASONS: zBifrost WebSocket protocol vocabulary (SSOT)
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
// DOM event names (browser-native — used with addEventListener).
export const EVENT_TYPES = {
  CLICK: 'click',
  CHANGE: 'change',
  SUBMIT: 'submit',
  INPUT: 'input',
  FOCUS: 'focus',
  BLUR: 'blur',
  KEYDOWN: 'keydown',
  KEYUP: 'keyup',
};

// ─────────────────────────────────────────────────────────────────
// zBifrost WebSocket Protocol Events (SSOT)
// ─────────────────────────────────────────────────────────────────
// Control-plane + display event names that arrive on `message.event`.
// This is the single source of truth for the client's protocol vocabulary —
// message_handler dispatch MUST reference these instead of raw string
// literals. Keep in sync with the server's emitted event names. Render-node
// *display* ops carried inside a render_chunk are decoded separately via the
// opcode map (mirror of render_opcodes.py) in message_handler.
export const PROTOCOL_EVENTS = {
  // Transport / connection control
  RENDER_CHUNK: 'render_chunk',
  CONNECTION_INFO: 'connection_info',
  NAVIGATE_BACK: 'navigate_back',
  OPEN_URL: 'open_url',
  ERROR: 'error',

  // Display / output
  DISPLAY: 'display',
  OUTPUT: 'output',
  ZTABLE: 'zTable',
  ZDASH: 'zDash',
  ZMENU: 'zMenu',
  ZDIALOG: 'zDialog',
  SWIPER_INIT: 'swiper_init',

  // Progress / spinner
  PROGRESS_BAR: 'progress_bar',
  PROGRESS_UPDATE: 'progress_update',
  PROGRESS_COMPLETE: 'progress_complete',
  SPINNER_START: 'spinner_start',
  SPINNER_STOP: 'spinner_stop',

  // Input request / response
  REQUEST_INPUT: 'request_input',
  INPUT_REQUEST: 'input_request',
  INPUT_RESPONSE: 'input_response',

  // Execution / wizard / RBAC
  EXECUTE_WALKER: 'execute_walker',
  EXECUTE_ZFUNC_RESPONSE: 'execute_zfunc_response',
  EXECUTE_CODE_RESPONSE: 'execute_code_response',
  ZFUNC_EXEC: 'zfunc_exec',
  WIZARD_GATE_RESULT: 'wizard_gate_result',
  RBAC_DENIED: 'rbac_denied',

  // Logging
  APP_LOG: 'app_log',
};

// navigate_back `reason` discriminators (SSOT).
export const PROTOCOL_REASONS = {
  BOUNCE_BACK_COMPLETED: 'bounce_back_block_completed',
  RBAC_DENIED: 'rbac_denied',
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
