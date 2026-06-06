/**
 * ProgressBarRenderer - Render progress bars with percentage and ETA
 *
 * Terminal-first implementation matching backend zDisplay.progress_bar()
 *
 * Backend Events (from display_event_timebased.py):
 * - progress_bar: Update progress
 * - progress_complete: Finish progress
 *
 * Terminal Paradigm:
 * - Carriage return (\r) updates: Overwrites same line for smooth updates
 * - ETA calculation: Based on elapsed time and remaining work
 * - Visual bars:  80% (2m 30s remaining)
 *
 * Bifrost Paradigm:
 * - WebSocket events trigger updates
 * - CSS transitions for smooth width changes
 * - Multiple progress bars can be active simultaneously
 * - Striped/animated variants for indeterminate or processing states
 *
 * Features:
 * - Determinate progress (0-100%)
 * - Percentage display (show_percentage)
 * - ETA display (show_eta)
 * - Color variants (primary, success, danger, warning, info)
 * - Striped/animated variants
 * - Height variants (using size_utils)
 * - Auto-removal on completion
 *
 * @see https://github.com/ZoloAi/zTheme/blob/main/Manual/ztheme-progress.html
 */

// Layer 2: Utilities
import { getBackgroundClass } from '../../../zSys/theme/color_utils.js';
import { applyHeight } from '../../../zSys/theme/size_utils.js';
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';

// Layer 3: Primitives
import { createDiv, createSpan } from '../primitives/generic_containers.js';

// Constants
import { TIMEOUTS, COLORS } from '../../../L1_Foundation/constants/bifrost_constants.js';

export default class ProgressBarRenderer {
  /**
   * @param {Object} logger - Logger instance
   */
  constructor(logger) {
    this.logger = logger;
    this._activeProgressBars = new Map(); // Track active progress bars by progressId

    // Wrap render method with error boundary
    if (typeof this.render === 'function') {
      const originalRender = this.render.bind(this);
      this.render = withErrorBoundary(originalRender, {
        component: 'ProgressBarRenderer',
        logger: this.logger
      });
    }
  }

  /**
   * Start or update a progress bar (progress_bar event)
   * @param {Object} event - Progress bar event
   * @param {string} event.progressId - Unique progress bar ID
   * @param {string} event.label - Progress bar label text
   * @param {number} event.current - Current progress value
   * @param {number} event.total - Total value (max progress)
   * @param {boolean} [event.showPercentage=true] - Show percentage text
   * @param {boolean} [event.showETA=true] - Show ETA text
   * @param {string} [event.eta] - ETA string from backend
   * @param {string} [event.color='primary'] - Progress bar color
   * @param {string} [event.container='#app'] - Target container selector
   * @param {boolean} [event.striped=false] - Use striped variant
   * @param {boolean} [event.animated=false] - Animate stripes
   * @param {string} [event.height='md'] - Height (sm, md, lg)
   * @returns {HTMLElement} Progress bar container element
   */
  render(event) {
    const {
      progressId,
      label = 'Processing...',
      current = 0,
      total = 100,
      eta = null,
      color = 'primary',
      container = '#app',
      striped = false,
      animated = false,
      height = 'md'
    } = event;

    // Accept backend snake_case (show_percentage / show_eta) as well as camelCase.
    const showPercentage = event.showPercentage ?? event.show_percentage ?? true;
    const showETA = event.showETA ?? event.show_eta ?? false;

    this.logger.log('[ProgressBarRenderer] Rendering progress:', {
      progressId,
      label,
      progress: `${current}/${total}`
    });

    // Check if progress bar already exists
    let progressContainer;
    if (this._activeProgressBars.has(progressId)) {
      // Update existing progress bar
      progressContainer = this._activeProgressBars.get(progressId).element;
      this._updateProgressBar(progressContainer, current, total, showPercentage, eta, showETA);
    } else {
      // Create new progress bar
      progressContainer = this._createProgressBarContainer(
        progressId,
        label,
        current,
        total,
        showPercentage,
        showETA,
        eta,
        color,
        striped,
        animated,
        height
      );

      // Find target container. The backend default is the literal "default"
      // (not a selector) — treat that (and any unresolved selector) as the app
      // root so a streamed bar lands in the page flow, never orphaned on <body>.
      const selector = (container && container !== 'default') ? container : '#app';
      const targetElement = document.querySelector(selector)
        || document.querySelector('#app')
        || document.body;
      targetElement.appendChild(progressContainer);

      // Track active progress bar
      this._activeProgressBars.set(progressId, {
        element: progressContainer,
        label,
        startTime: Date.now()
      });
    }

    // Check if complete
    if (current >= total) {
      this.complete({ progressId });
    }

    this.logger.log('[ProgressBarRenderer] Progress updated successfully');
    return progressContainer;
  }

  /**
   * Build a progress bar element WITHOUT appending it (inline/declarative use).
   *
   * The orchestrator's renderZDisplayEvent() switch returns a node that the
   * caller places in the page flow — same contract as image/table renderers.
   * We still register the bar by progressId so a later streamed update (a wizard
   * advancing, same id) finds and animates this exact element in place.
   *
   * Accepts both camelCase (showPercentage) and the backend's snake_case
   * (show_percentage); leaving `total` off yields an indeterminate striped bar.
   * @param {Object} event - Progress bar event (declarative or streamed)
   * @returns {HTMLElement} Progress bar container element (not yet attached)
   */
  renderInline(event) {
    const {
      progressId = `progress-${Date.now()}`,
      label = 'Processing...',
      current = 0,
      color = 'primary',
      height = 'md',
      eta = null
    } = event;

    const showPercentage = event.showPercentage ?? event.show_percentage ?? true;
    const showETA = event.showETA ?? event.show_eta ?? false;

    // Indeterminate (no total) → a full striped/animated bar that reads as "working".
    let { total, striped = false, animated = false } = event;
    if (!total) {
      total = 100;
      striped = true;
      animated = true;
    }

    // Re-render of a bar we already drew (a wizard advancing past its gate
    // re-emits the SAME progressId at 100%). Update it in place and return null
    // so the caller never appends a duplicate — the existing node animates to its
    // new width where it sits (the bar stays at the top of the wizard).
    if (event.progressId && this._activeProgressBars.has(event.progressId)) {
      const existing = this._activeProgressBars.get(event.progressId).element;
      if (existing && document.contains(existing)) {
        this._updateProgressBar(existing, current, total, showPercentage, eta, showETA);
        return null;
      }
    }

    const element = this._createProgressBarContainer(
      progressId, label, current, total,
      showPercentage, showETA, eta, color, striped, animated, height
    );

    // Register so streamed updates (same progressId) update this node in place.
    this._activeProgressBars.set(progressId, {
      element,
      label,
      startTime: Date.now()
    });

    return element;
  }

  /**
   * Complete a progress bar (progress_complete event)
   * @param {Object} event - Progress complete event
   * @param {string} event.progressId - Unique progress bar ID
   */
  complete(event) {
    const { progressId } = event;

    this.logger.log('[ProgressBarRenderer] Completing progress:', progressId);

    const progressData = this._activeProgressBars.get(progressId);
    if (!progressData) {
      this.logger.warn('[ProgressBarRenderer] Progress bar not found:', progressId);
      return;
    }

    const { element } = progressData;

    // Auto-remove after configured timeout
    setTimeout(() => {
      if (element.parentNode) {
        element.style.transition = 'opacity 0.3s';
        element.style.opacity = '0';
        setTimeout(() => {
          if (element.parentNode) {
            element.parentNode.removeChild(element);
          }
        }, TIMEOUTS.FADE_TRANSITION);
      }
    }, TIMEOUTS.AUTO_REMOVE_PROGRESS);

    // Remove from active progress bars
    this._activeProgressBars.delete(progressId);

    this.logger.log('[ProgressBarRenderer] Progress completed successfully');
  }

  /**
   * Create progress bar container using primitives
   * @private
   */
  _createProgressBarContainer(
    progressId,
    label,
    current,
    total,
    showPercentage,
    showETA,
    eta,
    color,
    striped,
    animated,
    height
  ) {
    // Main container (using primitive)
    const container = createDiv({
      id: progressId,
      class: 'zProgress-container zMy-3'
    });

    // Label row (using primitives)
    const labelRow = createDiv({
      class: 'zD-flex zFlex-justify-between zMb-1'
    });

    const labelSpan = createSpan({
      class: 'zText-dark zFw-bold'
    });
    labelSpan.textContent = label;

    const infoSpan = createSpan({
      class: 'zText-muted',
      'data-info': 'progress-info'
    });
    infoSpan.textContent = this._formatProgressInfo(current, total, showPercentage, eta, showETA);

    labelRow.appendChild(labelSpan);
    labelRow.appendChild(infoSpan);

    // Progress bar wrapper (using primitive + zTheme classes)
    const progressWrapper = createDiv({
      class: 'zProgress'
    });

    // Apply height using size_utils (consolidated to avoid duplication)
    // TODO: Add .zProgress-sm, .zProgress-md, .zProgress-lg to zTheme
    const PROGRESS_HEIGHT_MAP = { 
      sm: '0.5rem',  // SIZE_SCALE[2]
      md: '1rem',    // SIZE_SCALE[4]
      lg: '1.5rem'   // SIZE_SCALE[6]
    };
    if (PROGRESS_HEIGHT_MAP[height]) {
      applyHeight(progressWrapper, PROGRESS_HEIGHT_MAP[height]);
    }

    // Progress bar (using primitive + composition pattern)
    const progressBar = createDiv({
      class: 'zProgress-bar',
      role: 'progressbar',
      'aria-valuenow': current,
      'aria-valuemin': '0',
      'aria-valuemax': total,
      'data-bar': 'progress-bar'
    });

    // Apply color using color_utils (Layer 2 composition)
    const bgClass = getBackgroundClass(color);
    progressBar.classList.add(bgClass);

    // Apply variants
    if (striped) {
      progressBar.classList.add('zProgress-bar-striped');
    }
    if (animated) {
      progressBar.classList.add('zProgress-bar-animated');
    }

    // Set initial width
    const percentage = Math.min(100, Math.max(0, (current / total) * 100));
    progressBar.style.width = `${percentage}%`;
    progressBar.style.transition = 'width 0.3s ease-in-out';

    // Assemble
    progressWrapper.appendChild(progressBar);
    container.appendChild(labelRow);
    container.appendChild(progressWrapper);

    return container;
  }

  /**
   * Update existing progress bar
   * @private
   */
  _updateProgressBar(container, current, total, showPercentage, eta, showETA) {
    // Update progress bar width
    const progressBar = container.querySelector('[data-bar="progress-bar"]');
    if (progressBar) {
      const percentage = Math.min(100, Math.max(0, (current / total) * 100));

      // Step-oriented vs time-oriented. A real step landing (finite total,
      // still in progress) means this is determinate progress — it should
      // "just slowly fill", not borrow the indeterminate/time treatment. Drop
      // the marching marquee + flowing stripes so only the smooth width
      // transition (zbase: width 0.45s) shows. Time/indeterminate bars never
      // reach here with current < total, so they keep their motion.
      const determinate = Number.isFinite(total) && total > 0 && current < total;
      if (determinate) {
        const track = container.querySelector('.zProgress');
        if (track) track.classList.remove('zProgress--indeterminate');
        progressBar.classList.remove('zProgress-bar-striped', 'zProgress-bar-animated');
      }

      progressBar.style.width = `${percentage}%`;
      progressBar.setAttribute('aria-valuenow', current);
    }

    // Update info text
    const infoSpan = container.querySelector('[data-info="progress-info"]');
    if (infoSpan) {
      infoSpan.textContent = this._formatProgressInfo(current, total, showPercentage, eta, showETA);
    }
  }

  /**
   * Format progress info text (percentage + ETA)
   * @private
   */
  _formatProgressInfo(current, total, showPercentage, eta, showETA) {
    const parts = [];

    if (showPercentage) {
      const percentage = Math.min(100, Math.max(0, (current / total) * 100));
      parts.push(`${Math.round(percentage)}%`);
    }

    if (showETA && eta) {
      parts.push(`ETA: ${eta}`);
    }

    return parts.join(' • ');
  }

  /**
   * Get active progress bar count
   * @returns {number} Number of active progress bars
   */
  getActiveCount() {
    return this._activeProgressBars.size;
  }

  /**
   * Clear all progress bars (cleanup utility)
   */
  clearAll() {
    this.logger.log('[ProgressBarRenderer] Clearing all progress bars');

    for (const [_progressId, data] of this._activeProgressBars) {
      if (data.element.parentNode) {
        data.element.parentNode.removeChild(data.element);
      }
    }

    this._activeProgressBars.clear();
  }
}

