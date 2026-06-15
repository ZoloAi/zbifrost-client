/**
 *
 * Video Renderer - Media Display Events
 *
 * Terminal-First Design:
 * - Backend sends src, alt_text, caption (works with URLs, served paths)
 * - Terminal displays metadata + button to open (zOpen)
 * - Bifrost renders a native <video controls> element with zTheme styling
 *
 * Mirrors ImageRenderer: primitives-first, _zClass / _id passthrough,
 * optional <figure>/<figcaption> when a caption is present.
 *
 * @module rendering/video_renderer
 * @layer 3
 * @pattern Primitives-First
 *
 * Exports:
 * - VideoRenderer: Class for rendering video events
 *
 * Example:
 * ```javascript
 * import VideoRenderer from './video_renderer.js';
 * const renderer = new VideoRenderer(logger);
 * const el = renderer.render({
 *   src: '/zcloud-static/media/demos/reel.mp4',
 *   alt_text: 'Studio reel',
 *   caption: 'Our latest work',
 *   _zClass: 'zRounded',
 *   _id: 'reel'
 * });
 * ```
 */

import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

export class VideoRenderer {
  constructor(logger) {
    this.logger = logger;

    const originalRender = this.render.bind(this);
    this.render = withErrorBoundary(originalRender, {
      component: 'VideoRenderer',
      logger: this.logger
    });
  }

  /**
   * Render a <video> element from event primitives.
   *
   * @param {Object} eventData - Event data from backend
   * @param {string} eventData.src - Video source (URL or served path)
   * @param {string} [eventData.alt_text] - Accessibility label (→ aria-label)
   * @param {string} [eventData.caption] - Optional caption (→ <figcaption>)
   * @param {boolean} [eventData.autoplay] - Autoplay (implies muted)
   * @param {boolean} [eventData.loop] - Loop playback
   * @param {boolean} [eventData.muted] - Mute audio track
   * @param {string} [eventData.poster] - Poster image shown before playback
   * @param {string} [eventData._zClass] - Custom classes for styling
   * @param {string} [eventData._id] - Custom DOM id for targeting
   * @returns {HTMLElement} Video element (or <figure> when captioned)
   */
  render(eventData) {
    const { src, alt_text, caption, _zClass, _id,
            autoplay, loop, muted, poster } = eventData;

    if (!src) {
      this.logger.error('[VideoRenderer] Missing src parameter');
      return this._createErrorElement();
    }

    this.logger.debug(`[VideoRenderer] Rendering video: ${src}`);

    const video = document.createElement('video');
    video.src = src;
    video.controls = true;          // always give the user native controls
    video.preload = 'metadata';     // fetch dimensions/duration, not the whole file

    // Responsive sizing (max-width:100% + height:auto) is bifrost-owned in
    // zbase.css; _zClass still wins for app-specific shaping.

    if (_zClass) video.className = _zClass;
    if (_id) video.setAttribute('id', _id);
    if (alt_text) video.setAttribute('aria-label', alt_text);
    if (poster) video.poster = poster;
    if (loop) video.loop = true;
    // Autoplay only works muted in modern browsers — enforce that pairing.
    if (autoplay) { video.autoplay = true; video.muted = true; }
    else if (muted) video.muted = true;

    if (caption) {
      const figure = document.createElement('figure');
      figure.appendChild(video);
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = caption;  // bare semantic node — styled by zbase.css figcaption (SSOT)
      figure.appendChild(figcaption);
      // _zClass/_zStyle live on the inner <video>; skip the central pass on the wrapper.
      figure.__zMetaScoped = true;
      this.logger.debug('[VideoRenderer] Video with caption rendered');
      return figure;
    }

    this.logger.debug('[VideoRenderer] Video rendered');
    return video;
  }

  _createErrorElement() {
    const error = document.createElement('div');
    error.className = 'zAlert zAlert-danger';
    error.textContent = '[WARN] Video source missing';
    return error;
  }
}

export default VideoRenderer;
