/**
 * 
 * Semantic Element Primitive - Universal _zHTML/semantic Handler
 * 
 *
 * SSOT for creating semantic HTML elements with validation.
 * Centralized logic for _zHTML (container-level) and semantic (event-level).
 *
 * @module rendering/semantic_element_primitive
 * @layer 0.0 (RAWEST - semantic primitives)
 * @pattern Pure Factory Functions
 *
 * Philosophy:
 * - Single source of truth for element type validation
 * - Unified allowlist for security (prevent script/iframe/embed injection)
 * - Reused by MetadataProcessor (_zHTML) and TypographyRenderer (semantic)
 * - NO styling, NO classes (dress up later)
 *
 * Dependencies:
 * - utils/dom_utils.js (createElement, setAttributes)
 *
 * Exports:
 * - createSemanticElement(tagName, attributes) → HTMLElement
 * - VALID_SEMANTIC_ELEMENTS: Array<string>
 *
 * Example:
 * ```javascript
 * import { createSemanticElement } from './semantic_element_primitive.js';
 *
 * // Container-level (_zHTML: form)
 * const form = createSemanticElement('form', { id: 'myForm' });
 *
 * // Event-level (semantic: div)
 * const div = createSemanticElement('div', { class: 'content' });
 *
 * // Invalid element → fallback to div
 * const safe = createSemanticElement('script', {}); // → <div>
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 2: Utilities
import { createElement, setAttributes } from '../../../zSys/dom/dom_utils.js';

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

/**
 * Valid semantic elements (SSOT)
 * 
 * Security: Excludes dangerous elements (script, iframe, embed, object, style)
 * 
 * Categories:
 * - Generic: div, span
 * - Document Structure: header, footer, main, nav, section, article, aside
 * - Forms: form, fieldset, legend, label
 * - Interactive: button, details, summary, dialog
 * - Typography: h1-h6, p, blockquote, pre, code
 * 
 * @type {Array<string>}
 */
export const VALID_SEMANTIC_ELEMENTS = [
  // Generic containers
  'div',
  'span',
  
  // Document structure (HTML5 landmarks)
  'header',
  'footer',
  'main',
  'nav',
  'section',
  'article',
  'aside',
  
  // Form elements (container-level)
  'form',
  'fieldset',
  'legend',
  'label',
  
  // Interactive elements
  'button',
  'details',
  'summary',
  'dialog',
  
  // Typography (block-level)
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'blockquote',
  'pre',
  'code',
  
  // Additional semantic elements
  'address',
  'figure',
  'figcaption',
  'mark',
  'time',
  'abbr',
  'cite',
  'dfn',
  'kbd',
  'samp',
  'var',
  'sub',
  'sup',
  'small',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'del',
  'ins'
];

// ─────────────────────────────────────────────────────────────────
// Core Primitive
// ─────────────────────────────────────────────────────────────────

/**
 * Create a semantic HTML element with validation
 * 
 * SSOT for _zHTML (container-level) and semantic (event-level).
 * 
 * Security:
 * - Validates tagName against VALID_SEMANTIC_ELEMENTS
 * - Prevents XSS via script/iframe/embed injection
 * - Falls back to 'div' for invalid/dangerous elements
 * 
 * @param {string} tagName - Desired HTML element type
 * @param {Object} [attributes={}] - HTML attributes (id, class, data-*, aria-*, etc.)
 * @param {Object} [logger=null] - Optional logger for debugging
 * @returns {HTMLElement} The created element (or div fallback)
 * 
 * @example
 * // Valid semantic element
 * const form = createSemanticElement('form', { id: 'login' });
 * 
 * // Invalid element → fallback to div
 * const safe = createSemanticElement('script', {}); // → <div>
 * 
 * // With logger (for debugging)
 * const element = createSemanticElement('iframe', {}, console);
 * // Logs warning: "Invalid semantic element: iframe, falling back to div"
 */
export function createSemanticElement(tagName, attributes = {}, logger = null) {
  // Normalize tagName (lowercase, trim whitespace)
  const normalizedTag = (tagName || '').toLowerCase().trim();
  
  // Validate against allowlist
  const isValid = VALID_SEMANTIC_ELEMENTS.includes(normalizedTag);
  
  // Fallback to div for invalid/dangerous elements
  const safeTag = isValid ? normalizedTag : 'div';
  
  // Log warning if fallback occurred
  if (!isValid && logger) {
    logger.warn(`[SemanticElementPrimitive] Invalid semantic element: "${tagName}", falling back to div`);
  }
  
  // Create element
  const element = createElement(safeTag);
  
  // Apply attributes
  if (Object.keys(attributes).length > 0) {
    setAttributes(element, attributes);
  }
  
  return element;
}

// ─────────────────────────────────────────────────────────────────
// Helper: Language-Specific Pre Elements
// ─────────────────────────────────────────────────────────────────

/**
 * Create a <pre><code> element for syntax highlighting
 * 
 * Handles semantic: pre-html, pre-css, pre-zolo, etc.
 * Creates <pre><code class="language-xxx">...</code></pre> structure for Prism.js
 * 
 * @param {string} language - Language identifier (html, css, zolo, js, etc.)
 * @param {string} content - Code content
 * @param {Object} [attributes={}] - HTML attributes for <pre> element
 * @returns {HTMLElement} Pre element with nested code element
 * 
 * @example
 * const codeBlock = createLanguagePre('zolo', 'zMain:\n  zDisplay:\n    event: text', { class: 'code-block' });
 */
export function createLanguagePre(language, content, attributes = {}) {
  const pre = createSemanticElement('pre', attributes);
  const code = createElement('code');
  code.className = `zFont-mono language-${language}`;
  code.textContent = content;
  pre.appendChild(code);
  
  // Trigger Prism highlighting if available
  if (typeof window !== 'undefined' && window.Prism) {
    window.Prism.highlightElement(code);
  }
  
  return pre;
}

// ─────────────────────────────────────────────────────────────────
// Default Export
// ─────────────────────────────────────────────────────────────────

export default {
  createSemanticElement,
  createLanguagePre,
  VALID_SEMANTIC_ELEMENTS
};
