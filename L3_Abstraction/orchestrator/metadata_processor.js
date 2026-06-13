/**
 * L3_Abstraction/orchestrator/metadata_processor.js
 * 
 * Metadata Processing for Declarative Rendering
 * 
 * Handles extraction and application of metadata from YAML data:
 * - _zClass: CSS classes
 * - _zStyle: Inline styles
 * - _zHTML: Element type (div, section, article, etc.)
 * - _zId / zId: Element ID
 * - _zGroup: Grouped rendering context
 * - _zGroupLabel: Label for input groups
 * - _zScripts: Client-side scripts
 * 
 * Extracted from zdisplay_orchestrator.js (Phase 4.4a)
 */

// Layer 0: Primitives
import { createSemanticElement } from '../../L2_Handling/display/primitives/semantic_element_primitive.js';
import { convertStyleToString } from '../../zSys/dom/style_utils.js';

/**
 * MetadataProcessor - Extracts and applies metadata to DOM elements
 */
export class MetadataProcessor {
  constructor(logger) {
    this.logger = logger;
    
    // Define metadata keys that should be skipped during iteration
    this.METADATA_KEYS = [
      '_zClass',
      '_zStyle',
      '_zHTML',
      '_zId',
      'zScripts',
      '_zScripts',
      '_zGroup',
      '_zGroupLabel',
      'zId'
    ];
  }

  /**
   * Extract metadata from data object (underscore-prefixed keys)
   * @param {Object} data - YAML data object
   * @returns {Object} Metadata object with extracted keys
   */
  extractMetadata(data) {
    const metadata = {};
    
    if (!data || typeof data !== 'object') {
      return metadata;
    }

    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('_') || key === 'zId') {
        metadata[key] = value;
      }
    }

    return metadata;
  }

  /**
   * Check if a key is a metadata key (should be skipped during iteration)
   * @param {string} key - Key to check
   * @returns {boolean} True if key is metadata
   */
  isMetadataKey(key) {
    return this.METADATA_KEYS.includes(key) || key.startsWith('~');
  }

  /**
   * Create a container element with metadata applied
   * @param {string} zKey - Key for data-zkey attribute
   * @param {Object} metadata - Metadata object
   * @param {Object} logger - Logger instance
   * @returns {HTMLElement} Container element with metadata applied
   */
  createContainer(zKey, metadata, logger = this.logger) {
    // Use centralized semantic element primitive (SSOT for _zHTML)
    const elementType = metadata._zHTML || 'div';
    const container = createSemanticElement(elementType, {}, logger);

    // Apply metadata
    this.applyMetadata(container, metadata, zKey, logger);

    // Add form submit logging for debugging
    if (container.tagName.toLowerCase() === 'form') {
      container.addEventListener('submit', (event) => {
        logger.log(`[MetadataProcessor] Form submitted: ${zKey}`);
        logger.log('[MetadataProcessor] Form data:', new FormData(container));
        logger.log('[MetadataProcessor] Form validity:', container.checkValidity());
      });
    }

    return container;
  }

  /**
   * Normalize a _zClass value (string with comma/space separators, or array)
   * into a clean array of class tokens. SSOT for the "how do I read _zClass"
   * question that every tier (block / key / event) used to answer differently.
   * @param {string|Array} zClass
   * @returns {string[]}
   */
  normalizeClasses(zClass) {
    if (!zClass) return [];
    const parts = Array.isArray(zClass)
      ? zClass
      : (zClass.includes(',') ? zClass.split(',') : zClass.split(' '));
    return parts.map(c => String(c).trim()).filter(Boolean);
  }

  /**
   * Apply metadata to an existing element.
   *
   * Two class modes:
   *  - overwrite (default): _zClass OWNS className — used by zBlock/zKey wrappers
   *    that are freshly created and have no intrinsic classes.
   *  - append (options.append): _zClass LAYERS on top via classList.add — used by
   *    zEvent elements that already carry renderer-intrinsic classes (zText,
   *    bi-*, zTable …) which must survive. Empty/absent _zClass is a no-op.
   *
   * @param {HTMLElement} element - Element to apply metadata to
   * @param {Object} metadata - Metadata object (_zClass, _zStyle, zId)
   * @param {string} [zKey] - Optional key for data-zkey attribute
   * @param {Object} [logger] - Optional logger instance
   * @param {Object} [options] - { append?: boolean }
   */
  applyMetadata(element, metadata, zKey = null, logger = this.logger, options = {}) {
    const append = options.append === true;

    // Apply custom classes
    if (append) {
      // Event tier: layer on top of intrinsic classes, never clear.
      const extra = this.normalizeClasses(metadata._zClass);
      if (extra.length) element.classList.add(...extra);
    } else if (metadata._zClass !== undefined) {
      if (metadata._zClass === '' || metadata._zClass === null) {
        // Empty string or null = no container classes
        element.className = '';
      } else {
        element.className = this.normalizeClasses(metadata._zClass).join(' ');
      }
    } else if (!element.className) {
      // Default: NO classes (bare element, following HTML/CSS convention)
      element.className = '';
    }

    // Apply inline styles if provided (supports string or nested object)
    if (metadata._zStyle !== undefined && metadata._zStyle !== '' && metadata._zStyle !== null) {
      const cssString = convertStyleToString(metadata._zStyle, logger);
      if (cssString) {
        element.setAttribute('style', cssString);
      }
    }

    // Apply custom ID if provided (no underscore = passed to both Bifrost & Terminal)
    if (metadata.zId !== undefined && metadata.zId !== '' && metadata.zId !== null) {
      element.setAttribute('id', metadata.zId);
    }

    // Add data attribute for debugging/testing
    if (zKey) {
      element.setAttribute('data-zkey', zKey);
    }
  }

  /**
   * Apply classes to an element (helper for adding classes without replacing)
   * @param {HTMLElement} element - Element to add classes to
   * @param {string|Array} classes - Classes to add (string or array)
   */
  applyClasses(element, classes) {
    if (!classes) return;

    if (Array.isArray(classes)) {
      element.classList.add(...classes.filter(c => c.trim()));
    } else if (typeof classes === 'string') {
      const classList = classes.includes(',')
        ? classes.split(',').map(c => c.trim())
        : classes.split(' ').filter(c => c.trim());
      element.classList.add(...classList);
    }
  }

  /**
   * Check if data has block-level metadata
   * @param {Object} data - Data object to check
   * @returns {boolean} True if data has metadata keys
   */
  hasBlockMetadata(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }
    return Object.keys(data).some(k => k.startsWith('_'));
  }

  /**
   * Detect if metadata indicates input-group context
   * @param {Object} metadata - Metadata object
   * @returns {boolean} True if input-group context
   */
  isInputGroupContext(metadata) {
    return metadata._zGroup === 'input-group' ||
           (metadata._zClass && metadata._zClass.includes('zInputGroup'));
  }
}
