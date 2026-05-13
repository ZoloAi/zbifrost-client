/**
 * IconRenderer - Bootstrap Icons for Bifrost
 *
 * Renders Bootstrap Icons in web mode with support for:
 * - Icon name (with or without 'bi-' prefix)
 * - Size classes (zTitle-*, zIcon-*)
 * - Color classes (zText-*)
 * - Additional CSS classes (_zClass)
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
   * @param {string} [data.size] - Size class (e.g., "zTitle-2")
   * @param {string} [data.color] - Color class (e.g., "zText-primary")
   * @param {string} [data._zClass] - Additional CSS classes
   * @param {HTMLElement} targetElement - Target element to render into
   */
  render(data, targetElement) {
    if (!data || !data.name) {
      this.logger.warn('[IconRenderer] Missing icon name');
      return;
    }

    // Strip 'bi-' prefix if present
    const cleanName = data.name.replace(/^bi-/, '');

    // Create icon element
    const icon = document.createElement('i');
    icon.className = `bi bi-${cleanName}`;

    // Wrap in span if size/color/additional classes provided
    if (data.size || data.color || data._zClass) {
      const wrapper = document.createElement('span');
      
      // Build class list
      const classes = [];
      if (data.size) classes.push(data.size);
      if (data.color) classes.push(data.color);
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
      
      wrapper.appendChild(icon);
      targetElement.appendChild(wrapper);
    } else {
      // No wrapper needed - append icon directly
      targetElement.appendChild(icon);
    }

    this.logger.debug(`[IconRenderer] Rendered icon: %s`, `bi-${cleanName}`);
  }
}
