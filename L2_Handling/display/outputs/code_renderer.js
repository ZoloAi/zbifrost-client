/**
 * Code Renderer - Renders `code` display events
 *
 * Handles the 'code' zDisplay event, which is the SSOT for code block
 * rendering shared by:
 * - zCode shorthand
 * - zMD code fences (delegated from markdown_parser.py)
 * - zTerminal preview (delegated from terminal_executor.py)
 *
 * Produces a <pre><code class="language-{lang}"> block.
 * Prism.js (if loaded) will auto-highlight based on the language class.
 *
 * @module rendering/code_renderer
 * @layer 3
 * @pattern Strategy (single event type)
 */

import { createLanguagePre } from '../primitives/semantic_element_primitive.js';
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

export class CodeRenderer {
  /**
   * @param {Object} logger - Logger instance
   */
  constructor(logger) {
    this.logger = logger || console;
    this.logger.debug('[CodeRenderer] Initialized');

    const originalRenderCode = this.renderCode.bind(this);
    this.renderCode = withErrorBoundary(originalRenderCode, {
      component: 'CodeRenderer.renderCode',
      logger: this.logger
    });
  }

  /**
   * Render a code block element.
   *
   * @param {Object} eventData
   * @param {string} eventData.content   - Raw code content
   * @param {string} [eventData.language] - Programming language (e.g. 'python', 'js', 'zolo')
   * @param {number} [eventData.indent]   - Indentation level (unused in HTML; kept for symmetry)
   * @returns {HTMLElement} <pre><code> element
   */
  renderCode(eventData) {
    const content = eventData.content || '';
    const language = eventData.language || null;

    this.logger.debug(`[CodeRenderer] renderCode: language=${language}, length=${content.length}`);

    const attrs = {};
    if (eventData.zId || eventData._zId || eventData._id) {
      attrs.id = eventData.zId || eventData._zId || eventData._id;
    }
    if (eventData._zClass || eventData.class) {
      attrs.class = eventData._zClass || eventData.class;
    }

    const element = createLanguagePre(language || 'text', content, attrs);
    return element;
  }
}

export default CodeRenderer;
