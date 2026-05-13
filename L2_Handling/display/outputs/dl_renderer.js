/**
 * DL Renderer - Description List Rendering
 * 
 * Renders HTML description lists (<dl>, <dt>, <dd>) from zDisplay events.
 * 
 * Extracted from zdisplay_renderer.js (Phase 9, Task 3.2)
 * 
 * @module display/outputs/dl_renderer
 * @layer L2 (Handling)
 */

export class DLRenderer {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Render a description list element
   * @param {Object} event - DL event data
   * @param {Array} event.items - Array of {term, desc} objects
   * @param {string} event._zClass - Optional CSS classes
   * @param {number} event.indent - Optional indent level
   * @returns {HTMLElement} - Description list element
   */
  render(event) {
    const dl = document.createElement('dl');

    // Apply custom _zClass if provided
    if (event._zClass) {
      dl.className = event._zClass;
    }

    // Apply indent as left margin
    if (event.indent && event.indent > 0) {
      dl.style.marginLeft = `${event.indent}rem`;
    }

    // Render description list items
    const items = event.items || [];
    items.forEach(item => {
      // Create <dt> for the term
      const dt = document.createElement('dt');
      const termContent = item.term || '';
      dt.innerHTML = this._sanitizeHTML(this._decodeUnicodeEscapes(termContent));
      dl.appendChild(dt);

      // Create <dd> for description(s)
      // desc can be a string or an array of strings
      const descriptions = Array.isArray(item.desc) ? item.desc : [item.desc];
      descriptions.forEach(desc => {
        const dd = document.createElement('dd');
        const descContent = desc || '';
        dd.innerHTML = this._sanitizeHTML(this._decodeUnicodeEscapes(descContent));
        dl.appendChild(dd);
      });
    });

    return dl;
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
    if (!text || typeof text !== 'string') return text;
    
    // Replace \uXXXX format (standard 4-digit Unicode escape)
    text = text.replace(/\\u([0-9A-Fa-f]{4})/g, (match, hexCode) => {
      return String.fromCodePoint(parseInt(hexCode, 16));
    });
    
    // Replace \UXXXXXXXX format (extended 4-8 digit for supplementary characters & emojis)
    text = text.replace(/\\U([0-9A-Fa-f]{4,8})/g, (match, hexCode) => {
      return String.fromCodePoint(parseInt(hexCode, 16));
    });
    
    return text;
  }

  /**
   * Sanitize HTML to prevent XSS attacks
   * Allows common safe tags: <strong>, <em>, <code>, <a>, <br>, <span>
   * 
   * @param {string} html - HTML string to sanitize
   * @returns {string} - Sanitized HTML
   * @private
   */
  _sanitizeHTML(html) {
    if (!html) {
      return '';
    }

    // Allow common safe tags: <strong>, <em>, <code>, <a>, <br>
    // This is a basic sanitizer - for production, consider using DOMPurify
    const allowedTags = ['strong', 'em', 'code', 'a', 'br', 'span'];

    // Create a temporary div to parse HTML
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Remove script tags and event handlers
    const scripts = temp.querySelectorAll('script');
    scripts.forEach(script => script.remove());

    // Remove event handler attributes (onclick, onerror, etc.)
    const allElements = temp.querySelectorAll('*');
    allElements.forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });

      // Remove elements not in allowed list (except text nodes)
      if (!allowedTags.includes(el.tagName.toLowerCase())) {
        // Keep the text content but remove the tag
        const textContent = el.textContent;
        const textNode = document.createTextNode(textContent);
        el.parentNode.replaceChild(textNode, el);
      }
    });

    return temp.innerHTML;
  }
}
