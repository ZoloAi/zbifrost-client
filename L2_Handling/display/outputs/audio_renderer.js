/**
 *
 * Audio Renderer - Media Display Events
 *
 * Terminal-First Design:
 * - Backend sends src, alt_text, caption (works with URLs, served paths)
 * - Terminal displays metadata + button to open (zOpen)
 * - Bifrost renders a native <audio controls> element with zTheme styling
 *
 * Mirrors ImageRenderer / VideoRenderer: primitives-first, _zClass / _id
 * passthrough, optional <figure>/<figcaption> when a caption is present.
 *
 * @module rendering/audio_renderer
 * @layer 3
 * @pattern Primitives-First
 *
 * Exports:
 * - AudioRenderer: Class for rendering audio events
 */

import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

export class AudioRenderer {
  constructor(logger) {
    this.logger = logger;

    const originalRender = this.render.bind(this);
    this.render = withErrorBoundary(originalRender, {
      component: 'AudioRenderer',
      logger: this.logger
    });
  }

  /**
   * Render an <audio> element from event primitives.
   *
   * @param {Object} eventData - Event data from backend
   * @param {string} eventData.src - Audio source (URL or served path)
   * @param {string} [eventData.alt_text] - Accessibility label (→ aria-label)
   * @param {string} [eventData.caption] - Optional caption (→ <figcaption>)
   * @param {boolean} [eventData.loop] - Loop playback
   * @param {boolean} [eventData.muted] - Start muted
   * @param {string} [eventData._zClass] - Custom classes for styling
   * @param {string} [eventData._id] - Custom DOM id for targeting
   * @returns {HTMLElement} Audio element (or <figure> when captioned)
   */
  render(eventData) {
    const { src, alt_text, caption, _zClass, _id, loop, muted } = eventData;

    if (!src) {
      this.logger.error('[AudioRenderer] Missing src parameter');
      return this._createErrorElement();
    }

    this.logger.debug(`[AudioRenderer] Rendering audio: ${src}`);

    const audio = document.createElement('audio');
    audio.src = src;
    audio.controls = true;
    audio.preload = 'metadata';
    audio.style.maxWidth = '100%';

    if (_zClass) audio.className = _zClass;
    if (_id) audio.setAttribute('id', _id);
    if (alt_text) audio.setAttribute('aria-label', alt_text);
    if (loop) audio.loop = true;
    if (muted) audio.muted = true;

    if (caption) {
      const figure = document.createElement('figure');
      figure.appendChild(audio);
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = caption;
      figcaption.className = 'zText-muted zText-center zmt-2';
      figure.appendChild(figcaption);
      this.logger.debug('[AudioRenderer] Audio with caption rendered');
      return figure;
    }

    this.logger.debug('[AudioRenderer] Audio rendered');
    return audio;
  }

  _createErrorElement() {
    const error = document.createElement('div');
    error.className = 'zAlert zAlert-danger';
    error.textContent = '[WARN] Audio source missing';
    return error;
  }
}

export default AudioRenderer;
