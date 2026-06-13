/**
 * IconRenderer - Bootstrap Icons for Bifrost
 *
 * Renders Bootstrap Icons in web mode with support for:
 * - Icon name (with or without 'bi-' prefix)
 * - SSOT semantic color value (primary, warning, …) — resolved via getTextColorClass
 * - Additional CSS classes (_zClass) — also the channel for sizing
 *
 * Features:
 * - Clean HTML generation
 * - Proper class composition
 * - Graceful fallback for missing icons
 *
 * Author: zOS Framework
 * Version: 1.0.0
 * Date: 2026-03-24
 */

import { getTextColorClass } from '../../../zSys/theme/ztheme_utils.js';
import { convertStyleToString } from '../../../zSys/dom/style_utils.js';

export default class IconRenderer {
  /**
   * @param {Object} logger - Logger instance
   */
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Render Bootstrap Icon
   * @param {Object} data - Icon configuration
   * @param {string} data.name - Icon name (e.g., "tools", "bi-tools")
   * @param {string} [data.color] - SSOT semantic color value (e.g., "primary", "warning")
   * @param {string} [data._zClass] - Additional CSS classes (also sizing)
   * @param {string|Object} [data._zStyle] - SSOT inline-style escape hatch
   * @param {HTMLElement} [targetElement] - Optional parent to append into
   * @returns {HTMLElement} The rendered node (bare <i>, or a styled <span> wrapper)
   */
  render(data, targetElement) {
    if (!data || !data.name) {
      this.logger.warn('[IconRenderer] Missing icon name');
      return null;
    }

    // Strip 'bi-' prefix if present
    const cleanName = data.name.replace(/^bi-/, '');

    // Create icon element
    const icon = document.createElement('i');
    icon.className = `bi bi-${cleanName}`;

    // Only wrap when the icon carries its OWN styling (colour / classes / inline
    // style). A bare icon returns the raw <i> so the container-unwrapper can
    // collapse any redundant parent frame instead of nesting a second box.
    let node = icon;
    if (data.color || data._zClass || data._zStyle) {
      const wrapper = document.createElement('span');

      // Build class list. color is an SSOT semantic value (primary, warning, …) —
      // resolved through the same mapping zText/zH use, never a raw class.
      const classes = [];
      if (data.color) classes.push(getTextColorClass(data.color));
      if (data._zClass) {
        // Handle _zClass as string or array
        if (Array.isArray(data._zClass)) {
          classes.push(...data._zClass);
        } else {
          classes.push(...data._zClass.split(' ').filter(c => c));
        }
      }

      if (classes.length > 0) {
        wrapper.className = classes.join(' ');
      }

      // _zStyle — the SSOT escape hatch, same as every other event.
      if (data._zStyle) {
        const cssString = convertStyleToString(data._zStyle, this.logger);
        if (cssString) {
          wrapper.setAttribute('style', cssString);
        }
      }

      wrapper.appendChild(icon);
      node = wrapper;
    }

    if (targetElement) targetElement.appendChild(node);

    this.logger.debug(`[IconRenderer] Rendered icon: %s`, `bi-${cleanName}`);
    return node;
  }
}
