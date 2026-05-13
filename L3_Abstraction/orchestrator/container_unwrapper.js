/**
 * L3_Abstraction/orchestrator/container_unwrapper.js
 * 
 * Container Unwrapping Logic
 * 
 * Prevents double-nesting and unnecessary wrapper divs by detecting
 * when a container and its child have identical classes or when a
 * container has no styling purpose.
 * 
 * Unwrapping rules:
 * 1. If container and element have identical classes → unwrap
 * 2. If container has no classes AND no styles → unwrap
 * 3. If element has all container classes (superset) → unwrap
 * 4. Otherwise → keep wrapper
 * 
 * Extracted from zdisplay_orchestrator.js (Phase 4.4c)
 */

/**
 * ContainerUnwrapper - Detects and handles unnecessary wrapper divs
 */
export class ContainerUnwrapper {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Check if container should be unwrapped (element appended directly to parent)
   * @param {HTMLElement} container - The wrapper container
   * @param {HTMLElement} element - The child element
   * @returns {boolean} True if should unwrap
   */
  shouldUnwrap(container, element) {
    // Never unwrap comment nodes (delegated elements)
    if (element.nodeType === Node.COMMENT_NODE) {
      return false;
    }

    const containerClasses = container.className ? container.className.split(' ').filter(c => c.trim()) : [];
    const elementClasses = element.className ? element.className.split(' ').filter(c => c.trim()) : [];
    const hasAllContainerClasses = containerClasses.length > 0 && containerClasses.every(cls => elementClasses.includes(cls));

    // Case 1: Container and element have identical classes (or element has all container classes)
    if (container.className && element.className && (container.className === element.className || hasAllContainerClasses)) {
      this.logger.debug(`[ContainerUnwrapper] Should unwrap: element has same/superset classes`);
      return true;
    }

    // Case 2: Container has no classes AND no styles (no styling purpose)
    if ((!container.className || container.className === '') && !container.getAttribute('style')) {
      this.logger.debug(`[ContainerUnwrapper] Should unwrap: container has no styling`);
      return true;
    }

    // Case 3: Keep wrapper
    this.logger.debug(`[ContainerUnwrapper] Keep wrapper (classes: ${container.className || 'none'})`);
    return false;
  }

  /**
   * Unwrap a container by transferring metadata to element and returning element
   * @param {HTMLElement} container - The wrapper container
   * @param {HTMLElement} element - The child element
   * @param {string} key - The data-zkey value
   * @returns {HTMLElement} The unwrapped element
   */
  unwrap(container, element, key) {
    // Transfer data-zkey and id to the element
    element.setAttribute('data-zkey', key);
    if (!element.id) {
      element.setAttribute('id', key);
    }

    this.logger.debug(`[ContainerUnwrapper] Unwrapped ${key}: appending directly to parent`);
    return element;
  }

  /**
   * Process element unwrapping and return result
   * Returns { shouldAppendContainer: boolean, elementToAppend: HTMLElement }
   * @param {HTMLElement} container - The wrapper container
   * @param {HTMLElement} element - The child element
   * @param {string} key - The data-zkey value
   * @returns {{shouldAppendContainer: boolean, elementToAppend: HTMLElement}}
   */
  processUnwrapping(container, element, key) {
    if (this.shouldUnwrap(container, element)) {
      return {
        shouldAppendContainer: false,
        elementToAppend: this.unwrap(container, element, key)
      };
    } else {
      this.logger.debug(`[ContainerUnwrapper] Keeping wrapper for ${key} (classes: ${container.className || 'none'})`);
      container.appendChild(element);
      return {
        shouldAppendContainer: true,
        elementToAppend: container
      };
    }
  }
}
