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
 * - escapeHtml(text): Escape the 5 HTML-significant chars (SSOT — text & attr safe)
 * - safeHref(url): Block dangerous URL schemes + attr-escape (SSOT for href values)
 * 
 * Example:
 * ```javascript
 * import { decodeUnicodeEscapes, escapeHtml, safeHref } from '../../zSys/dom/encoding_utils.js';
 * const decoded = decodeUnicodeEscapes('Hello \\u2764\\uFE0F'); // "Hello ❤️"
 * el.innerHTML = `<a href="${safeHref(url)}">${escapeHtml(label)}</a>`;
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// HTML Escaping (SSOT) — replaces per-renderer ad-hoc escape chains
// ─────────────────────────────────────────────────────────────────

const _HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

/**
 * Escape the five HTML-significant characters. Safe for both element text and
 * double/single-quoted attribute contexts (escapes both " and '). Deterministic,
 * no DOM dependency. This is the single source of truth for HTML escaping in the
 * client — renderers must not hand-roll their own `.replace(/&/g, ...)` chains.
 *
 * @param {*} text - Value to escape (coerced to string; null/undefined → '')
 * @returns {string} Escaped string
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, (ch) => _HTML_ESCAPES[ch]);
}

// Schemes that can execute script / smuggle payloads when placed in href/src.
const _DANGEROUS_SCHEME = /^(javascript|data|vbscript):/i;

/**
 * Sanitize a URL for safe embedding in an href/src attribute. Blocks dangerous
 * schemes (javascript:, data:, vbscript:) — including whitespace/control-char
 * obfuscation — then attribute-escapes the result. Returns '#' for blocked or
 * empty input. http(s)/mailto/tel/anchor/relative/zPath URLs pass through.
 *
 * @param {*} url - Candidate URL (already zPath-resolved by the caller)
 * @returns {string} Safe, attribute-escaped URL or '#'
 */
export function safeHref(url) {
  if (url === null || url === undefined) return '#';
  const raw = String(url).trim();
  if (!raw) return '#';
  // Strip whitespace + control chars before the scheme test so "java\tscript:"
  // and "  javascript:" cannot slip past the guard.
  const probe = raw.replace(/[\u0000-\u001F\u007F\s]/g, '');
  if (_DANGEROUS_SCHEME.test(probe)) return '#';
  return escapeHtml(raw);
}

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
