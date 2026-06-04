/**
 * 
 * Text Renderer - Plain & Rich Text Display
 * 
 *
 * Renders text events from zCLI backend, supporting both plain text
 * and rich text with markdown inline formatting.
 *
 * @module rendering/text_renderer
 * @layer 3
 * @pattern Strategy (single event type)
 *
 * Philosophy:
 * - "Terminal first" - text is the foundation of all zCLI output
 * - Pure rendering (no WebSocket, no state, no side effects)
 * - Uses Layer 2 utilities exclusively (no inline logic)
 *
 * Supported Events:
 * - 'text': Plain text with no formatting
 * - 'rich_text': Text with markdown inline syntax (NEW)
 *
 * Markdown Syntax Supported:
 * - `code` -> <code>
 * - **bold** -> <strong>
 * - *italic* -> <em>
 * - __underline__ -> <u>
 * - ~~strikethrough~~ -> <del>
 * - ==highlight== -> <mark>
 * - [text](url) -> <a href>
 * - \ (backslash + newline) -> <br> (recommended for YAML)
 * - (double-space + newline) -> <br>
 * - <br> literal tag (passes through)
 *
 * Dependencies:
 * - Layer 2: dom_utils.js, ztheme_utils.js, error_boundary.js
 *
 * Exports:
 * - TextRenderer: Class for rendering text and rich_text events
 *
 * Example:
 * ```javascript
 * import { TextRenderer } from './text_renderer.js';
 *
 * const renderer = new TextRenderer(logger);
 *
 * // Plain text (returns element, orchestrator handles appending)
 * const textEl = renderer.render({
 *   content: 'Hello, zCLI!',
 *   color: 'primary',
 *   indent: 1
 * }, 'zVaF');
 *
 * // Rich text with markdown (returns element)
 * const richTextEl = renderer.renderRichText({
 *   content: 'Use **bold** and `code` syntax',
 *   color: 'info'
 * });
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 2: Utilities
import { createElement, setAttributes } from '../../../zSys/dom/dom_utils.js';
import { getTextColorClass } from '../../../zSys/theme/ztheme_utils.js';
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';
import emojiAccessibility from '../../../zSys/accessibility/emoji_accessibility.js';

// Link primitives: shared URL conversion and type detection (SSOT)
import { convertZPathToURL, detectLinkType, LINK_TYPE_EXTERNAL } from '../primitives/link_primitives.js';
import { escapeHtml, safeHref } from '../../../zSys/dom/encoding_utils.js';

// 
// Text Renderer Class
// 

/**
 * TextRenderer - Renders plain text events
 *
 * Handles the 'text' zDisplay event, which is the most basic
 * output primitive in zCLI. Renders a paragraph element with
 * optional color and indentation.
 */
export class TextRenderer {
  /**
   * Create a TextRenderer instance
   * @param {Object} logger - Logger instance for debugging
   */
  constructor(logger) {
    this.logger = logger || console;
    this.logger.debug('[TextRenderer] Initialized');

    // Wrap render methods with error boundary
    const originalRender = this.render.bind(this);
    this.render = withErrorBoundary(originalRender, {
      component: 'TextRenderer.render',
      logger: this.logger
    });

    const originalRenderRichText = this.renderRichText.bind(this);
    this.renderRichText = withErrorBoundary(originalRenderRichText, {
      component: 'TextRenderer.renderRichText',
      logger: this.logger
    });
  }

  /**
   * Parse markdown inline syntax to HTML
   *
   * @param {string} text - Text with markdown syntax
   * @returns {string} HTML string with inline elements
   * @private
   *
   * Supported markdown:
   * - `code` -> <code>
   * - **bold** -> <strong>
   * - *italic* -> <em>
   * - __underline__ -> <u>
   * - ~~strikethrough~~ -> <del>
   * - ==highlight== -> <mark>
   * - [text](url) -> <a href="url">
   * - \ (backslash + newline) -> <br> (YAML-friendly)
   * - (double-space + newline) -> <br> (standard markdown, but YAML may strip spaces)
   * - <br> literal tag -> <br> (passes through)
   */
  _parseMarkdown(text) {
    // STEP 1: Process semantic distinction for zMD
    // Convert \x1F (YAML multilines) to \n temporarily (for list processing)
    // We'll convert remaining \n to <br> after lists are processed
    let html = text.replace(/\x1F/g, '\n');
    
    // NOTE: Explicit \n will be handled in renderRichText (split into multiple <p> tags)
    
    // Trim trailing newlines to avoid extra <br> at the end
    html = html.replace(/\n+$/, '');

    // Code blocks: ```language\ncode\n``` -> <pre><code>code</code></pre>
    // Must be processed BEFORE inline code to avoid conflicts
    // Use placeholder to protect code blocks from heading regex
    // 
    // Prism.js syntax highlighting for ```zolo blocks:
    // - Fixed: Missing /g (global) flags caused only first occurrences to match
    // - CSS theme (prism-zolo-theme.css) auto-generated from zlsp SSOT colors:
    //   * Root-keys (zBlocks): Salmon orange (#ffaf87) - matches IDE
    //   * Display events (zH1, zMD, etc.): Orange red (#ff5f00)
    //   * Properties (nested keys): Golden yellow (#ffd787)
    //   * Metadata (_zClass, etc.): Cyan (#00ffff)
    // See: zlsp/themes/generators/prism.py, zlsp/themes/zolo_default.yaml
    const codeBlockPlaceholders = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, language, code) => {
      // Escape HTML in code
      const escapedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      
      // Special case: ```pre renders as semantic <pre> without <code> wrapper
      // Parallels zText semantic: pre option
      if (language === 'pre') {
        const placeholder = `___CODE_BLOCK_${codeBlockPlaceholders.length}___`;
        codeBlockPlaceholders.push(`<pre class="zFont-mono">${escapedCode}</pre>`);
        return placeholder;
      }
      
      // Apply language class if specified
      const langClass = language ? ` language-${language}` : '';
      const placeholder = `___CODE_BLOCK_${codeBlockPlaceholders.length}___`;
      codeBlockPlaceholders.push(`<pre class="zBg-dark zText-light zp-3 zRounded zOverflow-auto" tabindex="0"><code class="zFont-mono${langClass}">${escapedCode}</code></pre>`);
      return placeholder;
    });

    // Headings: # H1 through ###### H6
    // Process at line start or after newline, must be before bold/italic to avoid conflicts
    // Accept both "# Title" (standard) and "#Title" (lenient)
    html = html.replace(/(?:^|\n)(#{1,6})\s*(.+?)(?=\n|$)/g, (match, hashes, text) => {
      const level = hashes.length;
      const trimmedText = text.trim();
      return `\n<h${level}>${trimmedText}</h${level}>\n`;
    });

    // Tables: | Col1 | Col2 | -> <table>...</table>
    // Must be processed BEFORE inline code to preserve code in table cells
    // Pattern: header row, separator row (|---|---|), data rows
    html = html.replace(/(?:^|\n)(\|.+\|\n\|[-:|]+\|\n(?:\|.+\|\n?)+)/g, (match, tableBlock) => {
      const lines = tableBlock.trim().split('\n');
      if (lines.length < 3) return match; // Need at least header, separator, and 1 data row
      
      // Extract header
      const headerCells = lines[0].split('|').map(cell => cell.trim()).filter(cell => cell);
      
      // Skip separator line (lines[1])
      
      // Extract data rows
      const dataRows = lines.slice(2).map(line => 
        line.split('|').map(cell => cell.trim()).filter(cell => cell)
      );
      
      // Build HTML table
      let tableHTML = '\n<table class="table zmy-4">\n';
      
      // Header
      tableHTML += '  <thead>\n    <tr>\n';
      headerCells.forEach(cell => {
        tableHTML += `      <th>${cell}</th>\n`;
      });
      tableHTML += '    </tr>\n  </thead>\n';
      
      // Body
      tableHTML += '  <tbody>\n';
      dataRows.forEach(row => {
        tableHTML += '    <tr>\n';
        row.forEach(cell => {
          tableHTML += `      <td>${cell}</td>\n`;
        });
        tableHTML += '    </tr>\n';
      });
      tableHTML += '  </tbody>\n</table>\n';
      
      return tableHTML;
    });

    // Inline Code: `code` -> <code>code</code> (after code blocks to avoid conflicts)
    // Use placeholders to protect code content from further markdown processing
    const inlineCodeBlocks = [];
    // Double-backtick spans FIRST: `` `text` `` -> <code>`text`</code>
    // Allows single backticks inside; must precede single-backtick regex
    html = html.replace(/``(.+?)``/g, (match, code) => {
      const escaped = escapeHtml(code);
      const placeholder = `___INLINE_CODE_${inlineCodeBlocks.length}___`;
      inlineCodeBlocks.push(`<code>${escaped}</code>`);
      return placeholder;
    });
    html = html.replace(/`([^`]+)`/g, (match, code) => {
      // Escape HTML entities (SSOT) AND convert special chars to display literally
      const escaped = escapeHtml(code)
        .replace(/\n/g, '\\n')   // Convert actual newlines to literal \n for display
        .replace(/\t/g, '\\t');  // Convert actual tabs to literal \t for display
      const placeholder = `___INLINE_CODE_${inlineCodeBlocks.length}___`;
      inlineCodeBlocks.push(`<code>${escaped}</code>`);
      return placeholder;
    });

    // Links: [text](url){attrs} -> <a href="url" target=… class="classes">text</a>
    // MUST run AFTER inline code extraction so `[text](url)` inside backticks
    // is already shielded by ___INLINE_CODE_N___ placeholders.
    // Uses shared convertZPathToURL + detectLinkType from link_primitives.js (SSOT).
    //
    // The optional {…} brace is an attribute list (kramdown/pandoc-style):
    //   • target tokens override how the link opens —
    //       _blank | newtab | new-tab  → new tab
    //       _self  | sametab | same-tab → same tab
    //   • every other token is treated as a CSS class.
    // With no token, target falls back to link type (external → new tab).
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)(?:\{([^}]*)\})?/g, (match, text, url, attrs) => {
      // Harden against DOM-XSS: block dangerous href schemes + attr-escape the
      // resolved URL, and HTML-escape the link label (it can carry user content).
      // Inline markdown markers (**/*/etc.) survive escaping and convert later.
      const href = safeHref(convertZPathToURL(url));
      const label = escapeHtml(text);
      const ltype = detectLinkType(url);

      // Default target by link type; explicit {…} token wins.
      let target = ltype === LINK_TYPE_EXTERNAL ? '_blank' : '_self';
      const classTokens = [];
      if (attrs && attrs.trim()) {
        for (const tok of attrs.trim().split(/\s+/)) {
          const t = tok.toLowerCase();
          if (t === '_blank' || t === 'newtab' || t === 'new-tab') {
            target = '_blank';
          } else if (t === '_self' || t === 'sametab' || t === 'same-tab') {
            target = '_self';
          } else {
            classTokens.push(tok);
          }
        }
      }

      // _blank always carries rel="noopener noreferrer" (security), regardless of source.
      const rel = target === '_blank' ? ' rel="noopener noreferrer"' : '';
      let classAttr = '';
      if (classTokens.length) {
        const sanitized = classTokens.join(' ').replace(/[^a-zA-Z0-9\-_ ]/g, '').replace(/\s+/g, ' ').trim();
        if (sanitized) classAttr = ` class="${sanitized}"`;
      }
      return `<a href="${href}" target="${target}"${rel}${classAttr}>${label}</a>`;
    });

    // Lists -> <ul class="zList"> / <ol class="zList">. The marker is the type:
    //   UL  - * +              (disc / circle / square; - * + alone = empty nesting)
    //   OL  1- a- A- i- I-     (decimal / alpha / roman) — token = digits |
    //                          single letter | roman string, space-guarded.
    // Process before bold/italic to avoid conflicts with * markers.
    html = html.replace(
      /(?:^|\n)((?:[ \t]*(?:[-*+](?:[ \t]+[^\n]*|[ \t]*)|(?:\d+|[ivxlcdmIVXLCDM]+|[A-Za-z])-[ \t]+[^\n]*)(?:\n|$))+)/g,
      (match, listBlock) => '\n' + this._parseListBlock(listBlock.trimEnd()) + '\n'
    );

    // Blockquotes: > text -> <blockquote>text</blockquote>
    // Process before bold/italic to avoid conflicts
    // Updated: Keep empty > lines as line breaks within the same blockquote
    html = html.replace(/(?:^|\n)((?:>.*?(?:\n|$))+)/g, (match, quoteBlock) => {
      const lines = quoteBlock
        .trim()
        .split(/\n/)
        .map(line => {
          // Remove > prefix (and optional space after it)
          const content = line.replace(/^>\s?/, '');
          // If line had just >, it becomes empty string which will become <br>
          return content;
        });
      
      // Join lines with <br>, treating empty strings as visual line breaks
      const quoteContent = lines.join('<br>');
      // Clean semantic element — base styling lives in zSys/theme/zbase.css
      // (zTheme base), not hardcoded here, so it themes per-app and per-mode.
      return `\n<blockquote><p>${quoteContent}</p></blockquote>\n`;
    });

    // Bold: **text** -> <strong>text</strong>
    // Use non-greedy .*? to allow nested italics (e.g., **text with *italic* inside**)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text* -> <em>text</em> (but not ** from bold)
    // Use non-greedy .*? for consistency
    html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Underline/Strikethrough/Highlight run BEFORE inline code restoration
    // so their syntax inside backtick spans stays shielded by placeholders

    // Underline: __text__ -> <u>text</u>
    // Negative lookaround prevents matching ___INLINE_CODE_N___ placeholders
    html = html.replace(/(?<!_)__(?!_)([^_\n]+?)(?<!_)__(?!_)/g, '<u>$1</u>');

    // Strikethrough: ~~text~~ -> <del>text</del>
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Highlight: ==text== -> <mark>text</mark>
    html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>');

    // Restore inline code blocks — must be last so all inline syntax above
    // was shielded by ___INLINE_CODE_N___ placeholders
    html = html.replace(/___INLINE_CODE_(\d+)___/g, (match, index) => {
      return inlineCodeBlocks[parseInt(index)];
    });

    // Line breaks: backslash + newline -> <br> (won't be stripped by YAML)
    html = html.replace(/\\\n/g, '<br>');

    // Line breaks: double-space + newline -> <br> (markdown standard, but YAML may strip)
    html = html.replace(/ {2}\n/g, '<br>');

    // Convert remaining newlines to <br> (but NOT within <pre> tags or <ul>/<ol>)
    // These are from \x1F markers (YAML multilines), not explicit \n (which are handled by renderRichText)
    // Strategy: Extract code blocks and lists, convert newlines, then restore
    const preservedBlocks = [];
    html = html.replace(/(<pre[\s\S]*?<\/pre>|<ul[\s\S]*?<\/ul>|<ol[\s\S]*?<\/ol>)/g, (match) => {
      const placeholder = `___PRESERVED_BLOCK_${preservedBlocks.length}___`;
      preservedBlocks.push(match);
      return placeholder;
    });
    
    // Convert remaining newlines to <br> (from \x1F markers for line breaks)
    html = html.replace(/\n/g, '<br>');
    
    // Restore preserved blocks
    preservedBlocks.forEach((block, index) => {
      html = html.replace(`___PRESERVED_BLOCK_${index}___`, block);
    });
    
    // Restore code block placeholders (from earlier protection against heading regex)
    codeBlockPlaceholders.forEach((block, index) => {
      html = html.replace(`___CODE_BLOCK_${index}___`, block);
    });

    // Remove leading and trailing <br> tags (caused by newlines around lists/blocks)
    html = html.replace(/^(<br>)+/, '');  // Remove leading <br>
    html = html.replace(/(<br>)+$/, '');  // Remove trailing <br>

    return html;
  }

  /**
   * Render a rich_text event with markdown parsing
   *
   * @param {Object} data - Rich text event data
   * @param {string} data.content - Text content with markdown syntax
   * @param {string} [data.color] - Text color (primary, secondary, info, success, warning, error)
   * @param {number} [data.indent=0] - Indentation level (0 = no indent)
   * @param {string} [data._zClass] - Custom CSS class (optional, from YAML)
   * @param {string} [data._id] - Custom element ID (optional)
   * @returns {HTMLElement|null} Created paragraph element or null if failed
   *
   * @example
   * renderer.renderRichText({ content: 'This is **bold** and *italic*' });
   * renderer.renderRichText({ content: 'Use `code` for commands', color: 'info' });
   */
  renderRichText(data) {
    const { content, color, indent = 0, _zClass, _id } = data;

    // Validate required parameters
    if (!content) {
      this.logger.error('[TextRenderer] [ERROR] Missing required parameter: content');
      return null;
    }

    // Build CSS classes array
    const classes = [];

    // Add custom class if provided (from YAML)
    if (_zClass) {
      // Split space-separated classes (e.g., "zText-center zmt-3 zmb-4")
      const customClasses = _zClass.split(/\s+/).filter(c => c);
      classes.push(...customClasses);
    }

    // Add color class if provided (uses Layer 2 utility)
    if (color) {
      const colorClass = getTextColorClass(color);
      if (colorClass) {
        classes.push(colorClass);
      }
    }

    // Protect inline code from escape decoding (keep literal \n, \t, etc.)
    // Extract backtick content BEFORE decoding
    const inlineCodeBlocks = [];
    const protectedContent = content.replace(/`([^`]+)`/g, (match, code) => {
      const placeholder = `___INLINE_CODE_${inlineCodeBlocks.length}___`;
      inlineCodeBlocks.push(code); // Store BEFORE decoding (keeps literal \n)
      return placeholder;
    });
    
    // Now decode escapes in the text OUTSIDE of inline code
    const decodedContent = this._decodeUnicodeEscapes(protectedContent);
    
    // Check if decoded content contains explicit \n (paragraph breaks)
    // If so, split into multiple paragraphs; otherwise, render as single paragraph
    if (decodedContent.includes('\n')) {
      // MULTI-PARAGRAPH MODE: Group content blocks (keep list lines together)
      let paragraphs = this._groupContentBlocks(decodedContent);
      
      // Restore inline code in each paragraph (keep literal, no decoding)
      paragraphs = paragraphs.map(para => {
        let restored = para;
        inlineCodeBlocks.forEach((code, i) => {
          // Restore with backticks - markdown parser will handle escaping
          restored = restored.replace(`___INLINE_CODE_${i}___`, `\`${code}\``);
        });
        return restored;
      });
      
      // Create a container div for multiple paragraphs
      const container = createElement('div', classes);
      
      // Apply attributes to container
      const attributes = {};
      if (_id) {
        attributes.id = _id;
      }
      if (indent > 0) {
        attributes.style = `margin-left: ${indent}rem;`;
      }
      if (Object.keys(attributes).length > 0) {
        setAttributes(container, attributes);
      }
      
      // Parse each paragraph and create appropriate elements
      paragraphs.forEach((paragraphContent, index) => {
        const parsedMarkdown = this._parseMarkdown(paragraphContent);
        const accessibleHTML = emojiAccessibility.enhanceText(parsedMarkdown);
        
        // Check if parsed content contains block-level elements (headings, ul, ol, pre, etc.)
        // Block elements should NOT be wrapped in <p> tags
        const hasBlockElements = /<(h[1-6]|ul|ol|pre|blockquote|div|table)[\s>]/.test(accessibleHTML);
        
        if (hasBlockElements) {
          // Create a temporary container to parse the HTML
          const temp = document.createElement('div');
          temp.innerHTML = accessibleHTML;
          
          // Append all children directly (unwrap from paragraph)
          Array.from(temp.childNodes).forEach(child => {
            container.appendChild(child);
          });
        } else {
          // Regular text content - wrap in <p>
          const p = createElement('p', []);
          p.innerHTML = accessibleHTML;
          container.appendChild(p);
        }
        
        // Apply syntax highlighting to code blocks
        if (window.Prism) {
          const codeBlocks = container.querySelectorAll('pre code[class*="language-"]');
          codeBlocks.forEach((codeBlock) => {
            Prism.highlightElement(codeBlock);
          });
        }
      });
      
      this.logger.debug(`[TextRenderer] Rendered rich_text (%s paragraphs)`, paragraphs.length);
      return container;
      
    } else {
      // SINGLE-PARAGRAPH MODE: No explicit \n
      
      // Restore inline code before parsing markdown (keep literal, no decoding)
      let restoredContent = decodedContent;
      inlineCodeBlocks.forEach((code, i) => {
        // Restore with backticks - markdown parser will handle escaping
        restoredContent = restoredContent.replace(`___INLINE_CODE_${i}___`, `\`${code}\``);
      });
      
      const parsedMarkdown = this._parseMarkdown(restoredContent);
      const accessibleHTML = emojiAccessibility.enhanceText(parsedMarkdown);
      
      // Check if parsed content contains block-level elements (headings, lists, etc.)
      const hasBlockElements = /<(h[1-6]|ul|ol|pre|blockquote|div|table)[\s>]/.test(accessibleHTML);
      
      let element;
      if (hasBlockElements) {
        // Create a container div for block elements (don't wrap in <p>)
        element = createElement('div', classes);
        element.innerHTML = accessibleHTML;
      } else {
        // Regular text content - wrap in <p>
        element = createElement('p', classes);
        element.innerHTML = accessibleHTML;
      }
      
      // Apply syntax highlighting to code blocks (Prism.js)
      if (window.Prism) {
        const codeBlocks = element.querySelectorAll('pre code[class*="language-"]');
        codeBlocks.forEach((codeBlock) => {
          Prism.highlightElement(codeBlock);
        });
      }
      
      // Apply attributes
      const attributes = {};
      if (_id) {
        attributes.id = _id;
      }
      if (indent > 0) {
        attributes.style = `margin-left: ${indent}rem;`;
      }
      if (Object.keys(attributes).length > 0) {
        setAttributes(element, attributes);
      }
      
      this.logger.debug(`[TextRenderer] Rendered rich_text (single ${hasBlockElements ? 'block' : 'paragraph'})`);
      return element;
    }
  }

  /**
   * Render a text event
   *
   * @param {Object} data - Text event data
   * @param {string} data.content - Text content to display
   * @param {string} [data.color] - Text color (primary, secondary, info, success, warning, error)
   * @param {number} [data.indent=0] - Indentation level (0 = no indent)
   * @param {string} [data.class] - Custom CSS class (optional)
   * @param {string} zone - Target DOM element ID
   * @returns {HTMLElement|null} Created paragraph element or null if failed
   *
   * @example
   * renderer.render({ content: 'Hello!' }, 'zVaF');
   * renderer.render({ content: 'Success!', color: 'success' }, 'zVaF');
   * renderer.render({ content: 'Indented', indent: 2 }, 'zVaF');
   */
  render(data, zone) {
    const { content, color, indent = 0, class: customClass } = data;

    // Validate required parameters
    if (!content) {
      this.logger.error('[TextRenderer] [ERROR] Missing required parameter: content');
      return null;
    }

    // Get target container
    const container = document.getElementById(zone);
    if (!container) {
      this.logger.error(`[TextRenderer] [ERROR] Zone not found: ${zone}`);
      return null;
    }

    // Build CSS classes array
    const classes = [];

    // Add custom class if provided (from YAML)
    if (customClass) {
      // Split space-separated classes (e.g., "zText-center zmt-3 zmb-4")
      const customClasses = customClass.split(/\s+/).filter(c => c);
      classes.push(...customClasses);
    }

    // Add color class if provided (uses Layer 2 utility)
    if (color) {
      const colorClass = getTextColorClass(color);
      if (colorClass) {
        classes.push(colorClass);
      }
    }

    // Create paragraph element (using Layer 2 utility)
    const p = createElement('p', classes);
    p.textContent = content; // Use textContent for XSS safety

    // Apply attributes
    const attributes = {};

    // Apply indent as inline style (zTheme doesn't have indent utilities)
    // Each indent level = 1rem left margin
    if (indent > 0) {
      attributes.style = `margin-left: ${indent}rem;`;
    }

    if (Object.keys(attributes).length > 0) {
      setAttributes(p, attributes);
    }

    // Append to container
    container.appendChild(p);

    // Log success
    this.logger.debug(`[TextRenderer] Rendered text (%s chars, indent: %s)`, content.length, indent);

    return p;
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
   * Group multi-line content, keeping consecutive list lines together so they
   * are passed as a single block to _parseMarkdown rather than one line at a time.
   * @param {string} content - Decoded multi-line content
   * @returns {string[]} Array of content groups
   */
  _groupContentBlocks(content) {
    const lines = content.split('\n');
    const groups = [];
    let listBuffer = [];

    const isListLine = (line) => {
      const trimmed = line.trimStart();
      return /^[-*+][ \t]/.test(trimmed) ||                          // UL: - * + text
             /^(?:\d+|[ivxlcdmIVXLCDM]+|[A-Za-z])-[ \t]/.test(trimmed) || // OL: 1- a- A- i- I- text
             /^[-*+]\s*$/.test(trimmed) ||                           // empty marker: - alone
             (listBuffer.length > 0 && line.length > 0 &&
              (line[0] === ' ' || line[0] === '\t') &&
              /^(?:[-*+]|[A-Za-z0-9])/.test(trimmed));               // indented continuation
    };

    for (const line of lines) {
      if (!line.trim()) {
        if (listBuffer.length > 0) {
          groups.push(listBuffer.join('\n'));
          listBuffer = [];
        }
        continue;
      }
      if (isListLine(line)) {
        listBuffer.push(line);
      } else {
        if (listBuffer.length > 0) {
          groups.push(listBuffer.join('\n'));
          listBuffer = [];
        }
        groups.push(line);
      }
    }

    if (listBuffer.length > 0) {
      groups.push(listBuffer.join('\n'));
    }

    return groups.filter(g => g.trim());
  }

  /**
   * Parse a multi-line list block into nested <ul/ol class="zList"> HTML.
   *
   * The MARKER is the type (authored explicitly) — SSOT with zLSP str_hint and
   * the zCLI block_extractor:
   *   Unordered:  -  *  +              → disc / circle / square
   *   Ordered:    1-  a-  A-  i-  I-   → decimal / lower-alpha / upper-alpha /
   *                                      lower-roman / upper-roman
   * A list LEVEL's style is set by the first item at that indent. Nesting is
   * indentation-driven (a deeper indent opens a child list, shallower pops out).
   * Ordered token = digits | single letter | roman string (space-guarded).
   *
   * @param {string} block - Multi-line list content
   * @returns {string} HTML string
   */
  _parseListBlock(block) {
    const rawLines = block.split('\n').filter(l => l !== '');

    // Marker → { tag: 'ul'|'ol', style: <css list-style-type> }
    const classify = (marker) => {
      if (marker === '-') return { tag: 'ul', style: 'disc' };
      if (marker === '*') return { tag: 'ul', style: 'circle' };
      if (marker === '+') return { tag: 'ul', style: 'square' };
      if (/^\d+$/.test(marker)) return { tag: 'ol', style: 'decimal' };
      const upper = marker === marker.toUpperCase();
      const isRoman = /^[ivxlcdm]+$/.test(marker.toLowerCase());
      if (marker === 'i' || marker === 'I' || (marker.length > 1 && isRoman)) {
        return { tag: 'ol', style: upper ? 'upper-roman' : 'lower-roman' };
      }
      return { tag: 'ol', style: upper ? 'upper-alpha' : 'lower-alpha' };
    };

    const RE_UL = /^([-*+])[ \t]+(.*)$/;
    const RE_OL = /^(\d+|[ivxlcdmIVXLCDM]+|[A-Za-z])-[ \t]+(.*)$/;
    const RE_EMPTY = /^[-*+]\s*$/;

    const tokens = rawLines.map(line => {
      const indent = line.length - line.trimStart().length;
      const stripped = line.trimStart();
      if (RE_EMPTY.test(stripped)) return { indent, kind: 'empty' };
      let m = stripped.match(RE_UL);
      if (!m) m = stripped.match(RE_OL);
      if (!m) return null;
      const c = classify(m[1]);
      return { indent, kind: 'item', tag: c.tag, style: c.style, text: m[2].replace(/\s+$/, '') };
    }).filter(Boolean);

    const items = tokens.filter(t => t.kind === 'item');
    if (!items.length) return '';

    const root = { tag: items[0].tag, style: items[0].style, items: [] };
    const stack = [{ node: root, indent: -1 }];

    for (const token of tokens) {
      // Empty markers are nesting no-ops (parity with zCLI which skips them);
      // structure is driven purely by indentation.
      if (token.kind === 'empty') continue;

      let top = stack[stack.length - 1];

      if (top.indent < 0) {
        top.indent = token.indent;
      } else if (token.indent > top.indent) {
        const parentItems = top.node.items;
        if (parentItems.length > 0) {
          const lastItem = parentItems[parentItems.length - 1];
          if (!lastItem.children) {
            lastItem.children = { tag: token.tag, style: token.style, items: [] };
          }
          stack.push({ node: lastItem.children, indent: token.indent });
          top = stack[stack.length - 1];
        }
      } else if (token.indent < top.indent) {
        while (stack.length > 1 && token.indent < stack[stack.length - 1].indent) {
          stack.pop();
        }
        top = stack[stack.length - 1];
      }
      top.node.items.push({ text: token.text, children: null });
    }

    const renderNode = (node) => {
      const styleAttr = node.style ? ` style="list-style-type: ${node.style};"` : '';
      let html = `<${node.tag} class="zList"${styleAttr}>`;
      for (const item of node.items) {
        html += `<li>${item.text || ''}`;
        if (item.children) html += renderNode(item.children);
        html += '</li>';
      }
      html += `</${node.tag}>`;
      return html;
    };

    return renderNode(root);
  }

}

// 
// Default Export
// 
export default TextRenderer;

