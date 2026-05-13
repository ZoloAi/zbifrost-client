/**
 * TypographyRenderer - Renders text, headers, and dividers
 *
 * Uses typography primitives for DOM creation
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 0: Primitives
import { createHeading, createParagraph } from '../primitives/typography_primitives.js';
import { createSemanticElement, createLanguagePre } from '../primitives/semantic_element_primitive.js';
import { convertStyleToString } from '../../../zSys/dom/style_utils.js';

export class TypographyRenderer {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Convert newlines to <br> tags for Bifrost GUI
   * Handles BOTH literal \n strings (from YAML without quotes) AND actual newlines (from YAML with quotes)
   * @param {string} text - Text with potential newlines
   * @returns {string} HTML-safe text with <br> tags
   * @private
   */
  _convertNewlinesToBr(text) {
    // STEP 1: Process zText semantic distinction
    // \x1E (YAML multilines) → space (for readability)
    // \n (explicit escapes) → <br> (line break)
    const processedText = text.replace(/\x1E/g, ' ');
    
    // STEP 2: Escape HTML entities for XSS safety
    const escaped = processedText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    
    // STEP 3: Convert explicit \n to <br> tags
    return escaped.replace(/\n/g, '<br>');
  }

  /**
   * Render text element
   * @param {Object} eventData - Event data with content, color, indent, zId, semantic, etc.
   * @returns {HTMLElement}
   */
  renderText(eventData) {
    const classes = this._buildTextClasses(eventData);
    const attrs = {};
    if (classes) {
      attrs.class = classes;
    }
    
    // Support zId (universal), _zId (from zUI files), and _id (legacy)
    if (eventData.zId || eventData._zId || eventData._id) {
      attrs.id = eventData.zId || eventData._zId || eventData._id;
    }
    
    // Support _for attribute for labels (maps to 'for' HTML attribute)
    if (eventData._for) {
      attrs.for = eventData._for;
    }
    
    // Decode content once at function scope for delegation
    const content = this._decodeUnicodeEscapes(eventData.content || '');
    
    // Check semantic parameter (_zHTML takes precedence, semantic for backward compatibility)
    const semantic = eventData._zHTML || eventData.semantic;
    
    // Log deprecation warning if using legacy semantic parameter
    if (eventData.semantic && !eventData._zHTML && this.logger) {
      this.logger.warn(`[TypographyRenderer] DEPRECATED: Use _zHTML instead of semantic parameter`);
    }
    let element;
    
    // 
    // LANGUAGE-SPECIFIC PRE SUPPORT (2026-01-28)
    // Enables: semantic: pre-html, pre-css, pre-zolo, pre-js, etc.
    // Creates <pre><code class="language-xxx">...</code></pre> for Prism.js
    // 
    const preLanguageMatch = semantic && semantic.match(/^pre-(\w+)$/);
    const isLanguagePre = !!preLanguageMatch;
    const preLanguage = preLanguageMatch ? preLanguageMatch[1] : null;
    
    if (isLanguagePre) {
      // Use centralized language-specific pre primitive
      element = createLanguagePre(preLanguage, content, attrs);
    } else if (semantic && semantic !== 'p') {
      // Use centralized semantic element primitive (SSOT for semantic parameter)
      element = createSemanticElement(semantic, attrs, this.logger);
      
      // For plain pre/code elements, use textContent to display HTML as literal text
      if (semantic === 'pre' || semantic === 'code') {
        element.textContent = content;
      } else {
        element.innerHTML = this._convertNewlinesToBr(content);
      }
    } else {
      // Default: <p> for standard text
      const p = createParagraph(attrs);
      p.innerHTML = this._convertNewlinesToBr(content);
      element = p;
    }
    
    // Apply indent as margin-left (each level = 1rem)
    if (eventData.indent > 0) {
      element.style.marginLeft = `${eventData.indent}rem`;
    }

    // Apply inline styles if provided (_zStyle metadata)
    if (eventData._zStyle) {
      const cssString = convertStyleToString(eventData._zStyle, this.logger);
      if (cssString) {
        element.setAttribute('style', cssString);
      }
    }
    
    // Handle _zDelegate: update target input with this text's content
    if (eventData._zDelegate) {
      this._handleDelegation(eventData._zDelegate, content);
      // Return empty element to suppress visual output
      return document.createComment('delegated');
    }
    
    return element;
  }

  /**
   * Render header element
   * @param {Object} eventData - Event data with label, indent (level), zId, etc.
   * @returns {HTMLElement}
   */
  renderHeader(eventData) {
    // Backend sends 'indent' with header level (zH0=0, zH1=1, zH2=2, etc.)
    // Use nullish coalescing to handle indent=0 correctly (0 is a valid level for h0)
    const level = eventData.indent ?? eventData.level ?? 1;
    const classes = this._buildTextClasses(eventData);
    const attrs = {};
    if (classes) {
      attrs.class = classes;
    }
    // Support zId (universal), _zId (from zUI files), and _id (legacy)
    if (eventData.zId || eventData._zId || eventData._id) {
      attrs.id = eventData.zId || eventData._zId || eventData._id;
    }
    const h = createHeading(level, attrs);
    
    // Apply inline styles if provided (_zStyle metadata)
    if (eventData._zStyle) {
      const cssString = convertStyleToString(eventData._zStyle, this.logger);
      if (cssString) {
        h.setAttribute('style', cssString);
      }
    }
    
    // Decode Unicode escapes and convert newlines to <br> for Bifrost
    const content = eventData.label || eventData.content || '';
    const decoded = this._decodeUnicodeEscapes(content);
    h.innerHTML = this._convertNewlinesToBr(decoded);
    
    // Handle _zDelegate: update target element with this header's content
    if (eventData._zDelegate) {
      this._handleDelegation(eventData._zDelegate, decoded);
      // Return empty element to suppress visual output
      return document.createComment('delegated');
    }
    
    return h;
  }

  /**
   * Render divider element
   * @param {Object} eventData - Event data with color, zId, etc.
   * @returns {HTMLElement}
   */
  renderDivider(eventData) {
    const hr = document.createElement('hr');
    const classes = ['zDivider'];
    if (eventData.color) {
      classes.push(`zBorder-${eventData.color}`);
    }
    hr.className = classes.join(' ');
    // Support zId (universal), _zId (from zUI files), and _id (legacy)
    if (eventData.zId || eventData._zId || eventData._id) {
      hr.setAttribute('id', eventData.zId || eventData._zId || eventData._id);
    }
    return hr;
  }

  /**
   * Build text classes from event data
   * @private
   */
  _buildTextClasses(eventData) {
    const classes = [];

    // Color: normalize to lowercase for zTheme consistency
    if (eventData.color) {
      const color = eventData.color.toLowerCase();
      classes.push(`zText-${color}`);
    }

    // Custom classes from YAML (_zClass parameter - ignored by terminal)
    if (eventData._zClass) {
      classes.push(eventData._zClass);
    }

    return classes.length > 0 ? classes.join(' ') : '';
  }

  /**
   * Decode Unicode escape sequences to actual characters
   * Supports: \uXXXX (standard) and \UXXXXXXXX (extended) formats
   * 
   * Note: Basic escape sequences (\n, \t, etc.) are handled by JSON.parse()
   * automatically when receiving data from backend. We only need to decode
   * custom Unicode formats that JSON doesn't handle.
   * 
   * @param {string} text - Text containing Unicode escapes
   * @returns {string} - Decoded text
   * @private
   */
  _decodeUnicodeEscapes(text) {
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') return String(text);
    
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
    text = text
      .replace(/\\n/g, '\n')   // Newline
      .replace(/\\t/g, '\t')   // Tab
      .replace(/\\r/g, '\r')   // Carriage return
      .replace(/\\'/g, "'")    // Single quote
      .replace(/\\"/g, '"')    // Double quote
      .replace(/\\\\/g, '\\'); // Backslash (must be last!)
    
    return text;
  }

  /**
   * Handle _zDelegate: update target input/element with provided value.
   * Resolves the delegate path (e.g., "one", "_GUI.Btn_Eq") to a DOM element
   * and updates its value (for inputs) or textContent (for other elements).
   * @param {string} delegatePath - The zKey path to the target element
   * @param {string} value - The value to set
   * @private
   */
  _handleDelegation(delegatePath, value) {
    if (!delegatePath) return;

    // Resolve the target element using data-zkey attributes
    const targetContainer = this._resolveZDelegatePath(delegatePath, document);
    if (!targetContainer) {
      this.logger.warn('[Delegate] Target not found for path:', delegatePath);
      return;
    }

    // Find input/textarea/select within the container
    const targetInput = targetContainer.querySelector('input, textarea, select');
    if (targetInput) {
      targetInput.value = value;
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      this.logger.log('[Delegate] Updated input:', delegatePath, '→', value);
    } else {
      // Fallback: update textContent for non-input elements
      targetContainer.textContent = value;
      this.logger.log('[Delegate] Updated textContent:', delegatePath, '→', value);
    }
  }

  /**
   * Resolve a _zDelegate path (e.g., "one", "_GUI.Btn_Eq") to a DOM element.
   * Uses data-zkey attributes to traverse the DOM hierarchy.
   * @param {string} path - Dot-separated zKey path
   * @param {HTMLElement} scope - Starting scope for resolution (usually document)
   * @returns {HTMLElement|null}
   * @private
   */
  _resolveZDelegatePath(path, scope) {
    if (!path) return null;
    const parts = path.split('.');
    let el = scope;

    for (const part of parts) {
      el = el.querySelector(`[data-zkey="${part}"]`);
      if (!el) {
        this.logger.warn('[Delegate] Path resolution failed at:', part, 'in', path);
        return null;
      }
    }

    return el;
  }
}

export default TypographyRenderer;

