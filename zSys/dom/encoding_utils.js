/**
 * ═══════════════════════════════════════════════════════════════
 * Encoding Utilities - String Encoding/Decoding (Layer 2)
 * ═══════════════════════════════════════════════════════════════
 * 
 * Pure utility functions for string encoding and decoding operations.
 * Extracted from duplicate implementations in 4 renderer files.
 * 
 * @module utils/encoding_utils
 * @layer 2 (Utilities - Pure functions)
 * 
 * Dependencies: None (Layer 0 - Browser APIs only)
 * 
 * Exports:
 * - decodeUnicodeEscapes(text): Decode Unicode escape sequences
 * 
 * Example:
 * ```javascript
 * import { decodeUnicodeEscapes } from '../../zSys/theme/encoding_utils.js';
 * const decoded = decodeUnicodeEscapes('Hello \\u2764\\uFE0F'); // "Hello ❤️"
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Unicode Decoding
// ─────────────────────────────────────────────────────────────────

/**
 * Decode Unicode escape sequences in text
 * 
 * Handles multiple Unicode escape formats:
 * - \uXXXX: Standard 4-digit Unicode escape (e.g., \u2764 → ❤)
 * - \UXXXXXXXX: Extended 4-8 digit for supplementary characters & emojis
 * - Basic escape sequences: \n, \t, \r, etc.
 * 
 * @param {string} text - Text containing Unicode escapes
 * @returns {string} Decoded text
 * 
 * @example
 * decodeUnicodeEscapes('Hello \\u2764\\uFE0F'); // "Hello ❤️"
 * decodeUnicodeEscapes('Line 1\\nLine 2'); // "Line 1\nLine 2"
 * decodeUnicodeEscapes('\\U0001F600'); // "😀"
 */
export function decodeUnicodeEscapes(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Replace \uXXXX format (standard 4-digit Unicode escape)
  text = text.replace(/\\u([0-9A-Fa-f]{4})/g, (match, hexCode) => {
    return String.fromCodePoint(parseInt(hexCode, 16));
  });
  
  // Replace \UXXXXXXXX format (extended 4-8 digit for supplementary characters & emojis)
  text = text.replace(/\\U([0-9A-Fa-f]{4,8})/g, (match, hexCode) => {
    return String.fromCodePoint(parseInt(hexCode, 16));
  });
  
  // Replace basic escape sequences (literal strings like \\n, \\t, etc.)
  // These come from JSON where Python sends "\n" which becomes "\\n" in JSON
  text = text.replace(/\\n/g, '\n');
  text = text.replace(/\\r/g, '\r');
  text = text.replace(/\\t/g, '\t');
  text = text.replace(/\\\\/g, '\\');
  
  return text;
}
