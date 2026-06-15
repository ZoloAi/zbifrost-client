/**
 * ListRenderer - Renders list elements (ul/ol) with zTheme styling
 * Part of the modular bifrost rendering architecture
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 2: Utilities
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

// Layer 0: Primitives (semantic factories — renderer never hand-builds tags)
import { createList, createListItem } from '../primitives/lists_primitives.js';

// zMD inline seam + emoji a11y — a list item is an inline context, exactly like
// a table cell, so item text delegates here (SSOT) instead of raw textContent.
import { TextRenderer } from '../outputs/text_renderer.js';
import emojiAccessibility from '../../../zSys/accessibility/emoji_accessibility.js';

export class ListRenderer {
  constructor(logger, client) {
    this.client = client;
    this.logger = logger;

    // TextRenderer gives us _parseInline (bold/italic/underline/code/links) —
    // the same inline seam table cells use. DRY: never reinvent inline markdown.
    this.textRenderer = new TextRenderer(this.logger);

    // Wrap render method with error boundary
    const originalRender = this.render.bind(this);
    this.render = withErrorBoundary(originalRender, {
      component: 'ListRenderer',
      logger: this.logger
    });
  }

  /**
   * Parse a list item's INLINE markdown via the zMD inline seam (DRY/SSOT).
   *
   * A list item is inline-only — like a table cell — so it delegates to
   * TextRenderer._parseInline (never the block parser: an item must not emit a
   * heading/list/blockquote). Emojis then run through the shared safe-emoji a11y
   * util, matching the zCLI list path (parse_inline + convert_emojis_for_terminal).
   * @param {string} text - Raw item text
   * @returns {string} Inline HTML
   * @private
   */
  _parseItemContent(text) {
    if (!text || typeof text !== 'string') return text || '';
    const inlineHtml = this.textRenderer._parseInline(text);
    return emojiAccessibility.enhanceText(inlineHtml);
  }

  /**
   * Render a list element (bulleted or numbered)
   * Supports plain text items, nested arrays, and nested zDisplay events
   * NEW v1.7: Supports cascading styles for nested arrays!
   * @param {Object} eventData - zDisplay event data with items array
   * @param {number} level - Internal: current nesting level for cascading (default: 0)
   * @returns {Promise<HTMLElement>} - Rendered list element (ul or ol)
   */
  async render(eventData, level = 0) {
    this.logger.debug(`[ListRenderer] Rendering list: ${eventData.items?.length || 0} items`);

    // Determine current style based on cascading
    let currentStyle;
    let cascadeStyles = null;
    
    if (Array.isArray(eventData.style)) {
      // Cascading styles: cycle through array based on nesting level
      cascadeStyles = eventData.style;
      currentStyle = eventData.style[level % eventData.style.length];
      this.logger.log(`[ListRenderer] Using cascading style: ${currentStyle} (level ${level})`);
    } else {
      // Single style: use for all levels
      currentStyle = eventData.style || 'bullet';
    }

    // Pick <ol> vs <ul> and the canonical marker class. The glyph/sequence is
    // owned by zbase (.zList-circle/square/letter/roman) — NEVER inline style.
    let listElement;
    let markerClass = null;

    if (currentStyle === 'number') {
      listElement = createList(true);
    } else if (currentStyle === 'letter') {
      listElement = createList(true);
      markerClass = 'zList-letter';
    } else if (currentStyle === 'roman') {
      listElement = createList(true);
      markerClass = 'zList-roman';
    } else if (currentStyle === 'circle') {
      listElement = createList(false);
      markerClass = 'zList-circle';
    } else if (currentStyle === 'square') {
      listElement = createList(false);
      markerClass = 'zList-square';
    } else {
      // bullet (default) or any other style
      listElement = createList(false);
    }

    // Apply base zTheme class + canonical marker variant
    listElement.className = 'zList';
    if (markerClass) {
      listElement.classList.add(markerClass);
    }

    // _zClass is applied centrally by the orchestrator (SSOT, append mode) on the
    // returned listElement — we only read it below to detect inline layout.

    // TODO: DEPRECATE - Remove `indent` property from list events
    // Rationale: Conflicts with native HTML nesting, redundant with _zClass/_zStyle,
    // only used in 2 places (markdown parser, traceback). Natural nesting is better.
    // NOTE: Manual removal only - do not auto-fix with agents
    // Apply indent using zms (margin-start) classes
    if (eventData.indent && eventData.indent > 0) {
      listElement.className += ` zms-${eventData.indent}`;
    }

    // Apply custom id if provided (_id parameter - ignored by terminal)
    if (level === 0 && eventData._id) {
      listElement.setAttribute('id', eventData._id);
    }

    // Check if this is an inline list (for horizontal layout)
    const isInline = level === 0 && eventData._zClass && eventData._zClass.includes('zList-inline');

    // Render list items (async to support nested zDisplay events)
    const items = eventData.items || [];
    let lastLi = null;  // Track last created <li> for appending nested lists
    
    for (const item of items) {
      // NEW v1.7: Handle nested arrays naturally!
      if (Array.isArray(item)) {
        this.logger.debug('[ListRenderer] Rendering nested array');
        
        // Nested array should be appended to the PREVIOUS list item
        if (lastLi) {
          try {
            const nestedEventData = {
              items: item,
              style: cascadeStyles || currentStyle,  // Pass cascading styles or current style
              indent: 0  // Nested lists use native HTML indentation
            };
            const nestedList = await this.render(nestedEventData, level + 1);
            lastLi.appendChild(nestedList);
          } catch (error) {
            this.logger.error('[ListRenderer] Error rendering nested array:', error);
            lastLi.textContent += ` [Error: ${error.message}]`;
          }
        } else {
          this.logger.warn('[ListRenderer] Nested array without previous list item - creating standalone');
          // Fallback: create a new <li> if no previous item exists
          const li = createListItem();
          try {
            const nestedEventData = {
              items: item,
              style: cascadeStyles || currentStyle,
              indent: 0
            };
            const nestedList = await this.render(nestedEventData, level + 1);
            li.appendChild(nestedList);
            listElement.appendChild(li);
            lastLi = li;
          } catch (error) {
            this.logger.error('[ListRenderer] Error rendering nested array:', error);
            li.textContent = `[Error: ${error.message}]`;
            listElement.appendChild(li);
            lastLi = li;
          }
        }
        // Don't update lastLi - nested arrays attach to previous item
        continue;
      }

      // Create new <li> for non-array items (via primitive — no hand-built tags)
      const li = createListItem();

      // Apply zList-inline-item class if this is an inline list
      if (isInline) {
        li.className = 'zList-inline-item';
      }

      // Check if item contains a nested zDisplay event
      if (item && typeof item === 'object' && item.zDisplay) {
        this.logger.debug('[ListRenderer] Rendering nested zDisplay event');
        
        // Recursively render the nested zDisplay event
        try {
          const nestedElement = await this.client.zDisplayOrchestrator.renderZDisplayEvent(item.zDisplay);
          if (nestedElement) {
            li.appendChild(nestedElement);
          } else {
            this.logger.warn('[ListRenderer] Nested zDisplay returned null, using fallback');
            li.textContent = JSON.stringify(item);
          }
        } catch (error) {
          this.logger.error('[ListRenderer] Error rendering nested zDisplay:', error);
          li.textContent = `[Error: ${error.message}]`;
        }
      } else {
        // Plain text item — inline context: delegate to the zMD inline seam
        // (parse_inline + emoji), exactly like a table cell. SSOT, not textContent.
        const content = typeof item === 'string' ? item : (item.content || '');
        li.innerHTML = this._parseItemContent(content);
      }

      listElement.appendChild(li);
      lastLi = li;  // Track this as the last created <li>
    }

    this.logger.log(`[ListRenderer] Rendered ${currentStyle} list with ${items.length} items`);
    return listElement;
  }
}

export default ListRenderer;
