/**
 *
 * Embed Renderer - Media Display Events (sandboxed iframe)
 *
 * Terminal-First Design:
 * - Backend sends a VETTED payload only: src (already provider-normalized),
 *   sandbox + allow envelopes, and aspect. The server-side zEmbed policy
 *   (embed_policy / embed_trust) is the trust boundary; an off-list URL never
 *   reaches this renderer as an embed — it arrives as a plain zURL link instead.
 * - This renderer is therefore deliberately "dumb": it applies the server's
 *   sandbox/allow exactly, never widens them, and never re-derives trust on the
 *   client (the client is public and can't be a security boundary).
 * - Terminal mode shows metadata + an open-in-browser gate (zOpen); only Bifrost
 *   builds the live <iframe>.
 *
 * Mirrors VideoRenderer: primitives-first, _zClass / _id passthrough, optional
 * <figure>/<figcaption> when a caption is present.
 *
 * @module rendering/embed_renderer
 * @layer 3
 * @pattern Primitives-First
 *
 * Exports:
 * - EmbedRenderer: Class for rendering embed events
 *
 * Example:
 * ```javascript
 * import EmbedRenderer from './embed_renderer.js';
 * const renderer = new EmbedRenderer(logger);
 * const el = renderer.render({
 *   src: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
 *   alt_text: 'Demo reel',
 *   caption: 'Our latest work',
 *   provider: 'youtube',
 *   sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups',
 *   allow: 'autoplay; encrypted-media; fullscreen',
 *   aspect: '16:9'
 * });
 * ```
 */

import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

// Conservative fallback if the server ever omits sandbox tokens (it shouldn't —
// allowed embeds always carry them). Never WIDENS beyond what the server sent.
const FALLBACK_SANDBOX = 'allow-scripts allow-same-origin';
const DEFAULT_ASPECT = '16:9';

export class EmbedRenderer {
  constructor(logger) {
    this.logger = logger;

    const originalRender = this.render.bind(this);
    this.render = withErrorBoundary(originalRender, {
      component: 'EmbedRenderer',
      logger: this.logger
    });
  }

  /**
   * Render a sandboxed <iframe> from the server's vetted embed payload.
   *
   * @param {Object} eventData - Vetted event data from the server policy
   * @param {string} eventData.src - Normalized, allow-listed embed URL
   * @param {string} [eventData.alt_text] - Accessibility label (→ <iframe title>)
   * @param {string} [eventData.caption] - Optional caption (→ <figcaption>)
   * @param {string} [eventData.provider] - Provider name (→ data-provider)
   * @param {string} [eventData.sandbox] - iframe sandbox tokens (server-owned)
   * @param {string} [eventData.allow] - iframe allow / feature-policy (server-owned)
   * @param {string} [eventData.aspect] - Aspect ratio "W:H" (default 16:9)
   * @param {string} [eventData._zClass] - Custom classes for styling
   * @param {string} [eventData._id] - Custom DOM id for targeting
   * @returns {HTMLElement} The embed container (or <figure> when captioned)
   */
  render(eventData) {
    const { src, alt_text, caption, provider, sandbox, allow, aspect,
            _zClass, _id } = eventData;

    if (!src) {
      this.logger.error('[EmbedRenderer] Missing src parameter');
      return this._createErrorElement();
    }

    this.logger.debug(`[EmbedRenderer] Rendering embed: ${src}`);

    const iframe = document.createElement('iframe');
    iframe.src = src;
    // Server-owned security envelope — applied verbatim, never widened here.
    iframe.setAttribute('sandbox', sandbox || FALLBACK_SANDBOX);
    if (allow) iframe.setAttribute('allow', allow);
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.setAttribute('title', alt_text || caption || 'Embedded content');
    if (provider) iframe.setAttribute('data-provider', provider);
    // Responsive fill — wrapper owns the aspect box; iframe fills it.
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';

    // Aspect-ratio container keeps the embed responsive without layout shift.
    const container = document.createElement('div');
    container.className = 'zEmbed-container';
    container.style.aspectRatio = this._aspectRatio(aspect);
    container.style.width = '100%';
    container.appendChild(iframe);

    if (_zClass) container.className = `zEmbed-container ${_zClass}`;
    if (_id) container.setAttribute('id', _id);

    if (caption) {
      const figure = document.createElement('figure');
      figure.appendChild(container);
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = caption;  // bare semantic node — styled by zbase.css figcaption (SSOT)
      figure.appendChild(figcaption);
      // _zClass/_zStyle live on the inner container; skip the central pass on the wrapper.
      figure.__zMetaScoped = true;
      this.logger.debug('[EmbedRenderer] Embed with caption rendered');
      return figure;
    }

    this.logger.debug('[EmbedRenderer] Embed rendered');
    return container;
  }

  /**
   * Parse a "W:H" aspect string into a CSS aspect-ratio ("W / H").
   * Falls back to 16/9 for anything malformed.
   */
  _aspectRatio(aspect) {
    const raw = String(aspect || DEFAULT_ASPECT);
    const m = raw.match(/^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) return '16 / 9';
    return `${m[1]} / ${m[2]}`;
  }

  _createErrorElement() {
    const error = document.createElement('div');
    error.className = 'zAlert zAlert-danger';
    error.textContent = '[WARN] Embed source missing';
    return error;
  }
}

export default EmbedRenderer;
