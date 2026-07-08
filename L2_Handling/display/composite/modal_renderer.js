/**
 * ModalRenderer — the Bifrost skin of the zModal CALL verb
 *
 * A zModal is a glance, not a move: the server ran the detour (zNavigation),
 * staged the woven block, and the bridge shipped it as a `render_modal` frame.
 * This renderer paints that declarative block into a floating overlay mounted
 * on <body> and owns dismissal LOCALLY (backdrop click / ESC / ×) — the route
 * never moved server-side, so closing needs no round-trip. Trail-invisible by
 * construction: the page underneath is untouched, zBack behaves as if the
 * modal never happened.
 *
 * Content parity: the block renders through the SAME zDisplayOrchestrator
 * walk a render_chunk gets, so anything a page can show a modal can show.
 *
 * @module display/composite/modal_renderer
 * @layer L2 (Handling)
 */

const OVERLAY_CLASS = 'zModal-overlay';
const CARD_CLASS = 'zModal-card';
const CLOSE_CLASS = 'zModal-close';

export class ModalRenderer {
  constructor(logger, client) {
    this.logger = logger;
    this.client = client;
    this._overlay = null;
    this._escHandler = null;
  }

  /**
   * Render a render_modal message into a floating overlay.
   * @param {Object} message - { data: <decoded block dict>, source, keys }
   */
  async render(message) {
    const data = message && message.data;
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      this.logger.warn('[ModalRenderer] Empty modal payload — nothing to render');
      return;
    }

    // One modal at a time — a new frame replaces the current overlay.
    this.dismiss();

    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;
    overlay.setAttribute('data-zmodal', message.source || 'zModal');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = CARD_CLASS;

    const closeBtn = document.createElement('button');
    closeBtn.className = CLOSE_CLASS;
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';
    card.appendChild(closeBtn);

    const content = document.createElement('div');
    content.className = 'zModal-content';
    card.appendChild(content);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this._overlay = overlay;

    // Dismiss wiring — all three affordances funnel into one path.
    closeBtn.addEventListener('click', () => this.dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismiss();
    });
    this._escHandler = (e) => {
      if (e.key === 'Escape') this.dismiss();
    };
    document.addEventListener('keydown', this._escHandler);

    // Paint the declarative block with full page parity.
    try {
      await this.client._ensureZDisplayOrchestrator();
      await this.client.zDisplayOrchestrator.renderItems(data, content);
    } catch (err) {
      this.logger.error('[ModalRenderer] Failed to render modal content:', err);
      content.textContent = 'Failed to render modal content';
    }

    this.logger.debug('[ModalRenderer] Modal open:', message.source || Object.keys(data));
  }

  /** Close the overlay and release the ESC listener. */
  dismiss() {
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
      this.logger.debug('[ModalRenderer] Modal dismissed');
    }
  }
}

export default ModalRenderer;
