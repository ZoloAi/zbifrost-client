/**
 * zSys/dom/style_utils.js
 * 
 * Style Conversion Utilities
 * 
 * Handles _zStyle metadata conversion from various formats to CSS strings.
 * Supports both legacy inline string format and new nested object syntax.
 * 
 * Created: 2026-04-19 - Phase 1.0 - _zStyle nested syntax migration
 */

/**
 * Convert _zStyle to CSS string
 * 
 * Supports two formats:
 * 1. String (legacy): "color: red; font-size: 16px"
 * 2. Object (nested): { "color": "red", "font-size": "16px" }
 * 
 * @param {string|Object} style - CSS string or object with CSS properties
 * @param {Object} [logger=null] - Optional logger for warnings
 * @returns {string} CSS string for style attribute (empty string if invalid)
 * 
 * @example
 * // String passthrough (legacy/inline)
 * convertStyleToString("color: red; font-size: 16px")
 * // => "color: red; font-size: 16px"
 * 
 * @example
 * // Object to CSS string (new nested syntax)
 * convertStyleToString({
 *   "border-bottom": "2px solid var(--color-primary)",
 *   "background": "red",
 *   "letter-spacing": "0.1em"
 * })
 * // => "border-bottom: 2px solid var(--color-primary); background: red; letter-spacing: 0.1em"
 * 
 * @example
 * // CSS variables work in both formats
 * convertStyleToString({ "color": "var(--color-primary)" })
 * // => "color: var(--color-primary)"
 * 
 * @example
 * // Empty/null/undefined values filtered out
 * convertStyleToString({ "color": "red", "background": null, "font-size": "" })
 * // => "color: red"
 */
export function convertStyleToString(style, logger = null) {
  // Handle null/undefined
  if (style === null || style === undefined || style === '') {
    return '';
  }

  // Legacy format: inline CSS string
  if (typeof style === 'string') {
    return style.trim();
  }
  
  // New format: nested object (CSS-in-YAML)
  if (typeof style === 'object' && !Array.isArray(style)) {
    const cssString = Object.entries(style)
      .filter(([_, value]) => value !== undefined && value !== null && value !== '')
      .map(([prop, value]) => `${prop}: ${value}`)
      .join('; ');
    
    return cssString;
  }
  
  // Invalid type
  logger?.warn(`[StyleUtils] Invalid _zStyle type: ${typeof style}`, style);
  return '';
}
