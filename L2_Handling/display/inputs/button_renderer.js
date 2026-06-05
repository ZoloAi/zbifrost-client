/**
 * 
 * Button Renderer - Interactive Button Input Events
 * 
 *
 * Terminal-First Design (Refactored Micro-Step 8):
 * - Backend sends semantic color (danger, success, warning, etc.)
 * - Terminal displays colored prompts matching semantic meaning
 * - Bifrost renders buttons using zTheme button variants (.zBtn-primary, etc.)
 *
 * Renders button input events from zCLI backend. Creates interactive
 * button elements with zTheme button component classes and WebSocket
 * response handling.
 *
 * @module rendering/button_renderer
 * @layer 3
 * @pattern Strategy (single event type)
 *
 * Dependencies:
 * - Layer 0: primitives/interactive_primitives.js (createButton)
 * - Layer 2: dom_utils.js (createElement, replaceElement)
 * - zTheme: Button component classes (.zBtn, .zBtn-primary, etc.)
 *
 * Exports:
 * - ButtonRenderer: Class for rendering button events
 *
 * Example:
 * ```javascript
 * import ButtonRenderer from './button_renderer.js';
 *
 * const renderer = new ButtonRenderer(logger, client);
 * renderer.render({
 *   label: 'Submit',
 *   action: 'process_form',
 *   color: 'primary',
 *   requestId: '123'
 * }, 'zVaF');
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 0: Primitives
import { createButton } from '../primitives/interactive_primitives.js';
import { convertStyleToString } from '../../../zSys/dom/style_utils.js';

// 
// Main Implementation
// 

/**
 * Renders button input events for zDisplay
 *
 * Handles the 'button' event type from zCLI backend, creating
 * interactive button elements with zTheme styling and WebSocket
 * response handling.
 *
 * @class
 */
export default class ButtonRenderer {
  /**
   * Create a button renderer
   * @param {Object} logger - Logger instance for debugging
   * @param {Object} client - BifrostClient instance for sending responses
   */
  constructor(logger, client = null) {
    if (!logger) {
      throw new Error('[ButtonRenderer] logger is required');
    }

    this.logger = logger;
    this.client = client;
    this.defaultZone = 'zVaF-content';
  }

  /**
   * Render a button input request
   *
   * Terminal-First Design:
   * - Backend sends semantic color (danger, success, warning, primary, info, secondary)
   * - Bifrost renders button with matching zTheme color class
   *
   * @param {Object} data - Button configuration
   * @param {string} data.label - Button label text (or 'prompt')
   * @param {string} data.action - Action identifier (or '#' for placeholder)
   * @param {string} [data.color='primary'] - Button semantic color
   *   - primary: Default action (blue)
   *   - danger: Destructive action (red)
   *   - success: Positive action (green)
   *   - warning: Cautious action (yellow)
   *   - info: Informational (cyan)
   *   - secondary: Neutral (gray)
   * @param {string} [data.zIcon] - Optional icon name (e.g., "bi-backspace") - renders instead of label
   * @param {string} data.requestId - Request ID for response correlation
   * @param {string} zone - Target DOM element ID
   * @returns {HTMLElement|null} Created button container, or null if zone not found
   */
  render(data, zone) {
    // Validate inputs
    if (!data) {
      this.logger.error('[ButtonRenderer] data is required');
      return null;
    }

    // Extract data (support both direct and nested formats)
    const requestId = data.requestId || data.data?.requestId;
    const label = data.label || data.prompt || data.data?.prompt || 'Click Me';
    let action = data.action || data.data?.action || null;

    // zDelegate dict action — first-class dual-mode "internal rewiring" verb.
    // {zDelegate: "$Block.Sub"} (or {zDelegate: {target: …}}) means: on click,
    // run the target in place (routeless, AJAX-like). Two flavours, by target shape:
    //   • DOTTED ($Block.Section) → render the nested section IN PLACE within this
    //     carrier's parent key container (the way descending into a sub-block feels
    //     in CLI). Routed to client.zDelegateInline — no panel swap, no crumb push.
    //   • SINGLE ($Block) → routeless panel swap via the existing zDelta click path
    //     (used by menu options + Back affordances).
    let delegateInline = null;
    if (action && typeof action === 'object') {
      if (action.zDelegate !== undefined) {
        const spec = action.zDelegate;
        const target = (spec && typeof spec === 'object')
          ? (spec.target || spec.to || spec.zDelta)
          : spec;
        const norm = (typeof target === 'string' && target)
          ? (target.startsWith('$') ? target : `$${target.replace(/^[%^~]/, '')}`)
          : null;
        if (norm && norm.replace(/^\$/, '').includes('.')) {
          delegateInline = norm;
          action = null;
          this.logger.log('[ButtonRenderer] zDelegate (inline, dotted) →', delegateInline);
        } else {
          action = norm;
          this.logger.log('[ButtonRenderer] zDelegate → routeless delta to:', action);
        }
      } else {
        action = null; // unknown object action — ignore rather than crash
      }
    }
    const rawColor = data.color || data.data?.color || 'primary';
    const color = rawColor.toLowerCase(); // Normalize to lowercase for consistency
    const type = data.type || data.data?.type || 'button'; // Default to 'button' for safety
    const rawZIcon = data.zIcon || data.data?.zIcon || null;
    // Normalize: zIcon may arrive as {name:'bi-...'} or {zDisplay:{name:'bi-...'}} if Python pre-processed YAML
    const zIcon = typeof rawZIcon === 'string' ? rawZIcon
                : (rawZIcon && typeof rawZIcon === 'object')
                  ? (rawZIcon.name || rawZIcon.content || rawZIcon.zDisplay?.name || null)
                  : null;

    this.logger.log('[ButtonRenderer] Rendering button:', { requestId, label, action, color, type, zIcon });

    // Create button primitive (just the button, no container)
    const button = this._createButton(label, color, data._zClass, data._id, type, zIcon);
    const customStyle = data._zStyle || data.data?._zStyle || null;
    if (customStyle) {
      const cssString = convertStyleToString(customStyle, this.logger);
      if (cssString) {
        button.style.cssText = cssString;
      }
    }
    if (delegateInline) {
      // Inline delegate: render the dotted target section within this carrier's
      // parent key container, with a Back affordance — no route change, no panel
      // swap. The carrier itself stays a normal button (no wizard-action wiring).
      button.dataset.zdelegateInline = delegateInline;
      button.addEventListener('click', () => {
        const client = this.client || window.bifrostClient;
        if (client?.zDelegateInline) {
          client.zDelegateInline(delegateInline, button);
        } else {
          this.logger.warn('[ButtonRenderer] zDelegateInline unavailable on client');
        }
      });
    } else {
      const renderInline = data._renderInline || data.data?._renderInline || false;
      this._attachClickHandler(button, requestId, label, true, type, action, renderInline);

      // Mark step-key actions (non-plugin, non-placeholder) for wizard restart handling
      if (action && action !== '#' && !action.startsWith('&')) {
        button.dataset.wizardAction = action;
        this.logger.log('[ButtonRenderer] Added wizard-action:', action, 'to button:', label);
      }
    }

    // _zDelegate on a button → delegate label/value to a target input on click
    // Suppress visual rendering (SSOT: _zDelegate always suppresses output)
    if (data._zDelegate) {
      button.dataset.zdelegate = data._zDelegate;
      button.style.display = 'none'; // Hide but keep in DOM for wiring
      this.logger.log('[ButtonRenderer] Button delegated to:', data._zDelegate, '| action:', action, '| suppressing visual output');
    }

    // NO cancel button in Bifrost! (Terminal-first: y/n, GUI: click or ignore)
    // In terminal, button is y/n prompt. In GUI, button is click or don't click.
    // We're asynchronous - user can just ignore the button.

    // If zone is provided, append to DOM (legacy behavior for direct calls)
    // If no zone, just return element (orchestrator pattern)
    if (zone) {
      const targetZone = zone || data.target || this.defaultZone;
      const container = document.getElementById(targetZone);

      if (!container) {
        this.logger.error(`[ButtonRenderer] Zone not found: ${targetZone}`);
        return button; // Still return element even if zone not found
      }

      // Add to page
      container.appendChild(button);
      this.logger.log('[ButtonRenderer] Button rendered and appended to zone');
    }

    this.logger.log('[ButtonRenderer] Button rendered successfully');
    return button;
  }

  /**
   * Create a single button element from primitives + zTheme button variants
   *
   * Architecture:
   * - Layer 0.0: createButton() - Raw <button> element
   * - Layer 3 (here): Apply zTheme button variant classes (.zBtn-primary, etc.)
   *
   * Terminal-First Design:
   * - Uses semantic color from backend (matches terminal prompt color)
   * - Maps to zTheme button variant classes for consistent styling
   *
   * @private
   * @param {string} label - Button text
   * @param {string} color - Button semantic color (primary, danger, success, warning, info, secondary)
   * @param {string} [customClass] - Optional custom classes for layout (_zClass from YAML)
   * @param {string} [customId] - Optional custom id for targeting (_id from YAML)
   * @param {string} [type='button'] - Button type (button, submit, reset)
   * @param {string} [zIcon] - Optional icon name (e.g., "bi-backspace") - renders instead of label
   * @returns {HTMLElement} Button element
   */
  _createButton(label, color, customClass, customId, type = 'button', zIcon = null) {
    this.logger.log(`[ButtonRenderer] Creating button "${label}" | color: ${color} | type: ${type} | id: ${customId || 'auto'} | icon: ${zIcon || 'none'}`);

    // Layer 0.0: Create raw button primitive with attributes
    const attrs = { class: 'zBtn' }; // Base button styling only (padding, border, etc.)
    if (customId) {
      attrs.id = customId;
    }  // Pass _id to primitive
    const button = createButton(type, attrs);

    // Render icon or label
    if (zIcon) {
      // Render Bootstrap icon instead of label
      const iconName = zIcon.replace(/^bi-/, ''); // Strip 'bi-' prefix if present
      const icon = document.createElement('i');
      icon.className = `bi bi-${iconName}`;
      button.appendChild(icon);
      this.logger.log(`[ButtonRenderer] Rendered icon: bi-${iconName}`);
    } else {
      button.textContent = label;
    }

    // Apply semantic button variant classes (zTheme button components)
    // Map zCLI semantic colors to zTheme button variant classes (.zBtn-primary, etc.)
    const colorMap = {
      'primary': 'zBtn-primary',       // Green (zCLI brand)
      'danger': 'zBtn-danger',         // Red (destructive action)
      'success': 'zBtn-success',       // Green (positive action)
      'warning': 'zBtn-warning',       // Orange (cautious action)
      'info': 'zBtn-info',             // Blue (informational)
      'secondary': 'zBtn-secondary'    // Purple (secondary action)
    };

    const btnClass = colorMap[color] || 'zBtn-primary';
    button.classList.add(btnClass);
    this.logger.log(`[ButtonRenderer] Applied button variant class: ${btnClass}`);

    // Apply custom classes if provided (_zClass from YAML - for layout/spacing)
    if (customClass) {
      button.className += ` ${customClass}`;
      this.logger.log(`[ButtonRenderer] Applied custom classes: ${customClass}`);
    }

    if (customId) {
      this.logger.log(`[ButtonRenderer] Applied custom id: ${customId}`);
    }

    // Proper composition: Primitive + zTheme Button Variant = Styled Button
    // Uses semantic button classes (.zBtn-primary) per zTheme conventions

    return button;
  }

  /**
   * Attach click handler to button
   * @private
   * @param {HTMLElement} button - Button element
   * @param {string} requestId - Request ID for response
   * @param {string} originalLabel - Original button label
   * @param {boolean} value - Response value (true for primary, false for cancel)
   * @param {string} type - Button type (button, submit, reset)
   * @param {string} action - Optional action string (e.g., "&plugin.func(zHat[0])")
   */
  _attachClickHandler(button, requestId, originalLabel, value, type = 'button', action = null, renderInline = false) {
    button.addEventListener('click', (event) => {
      this.logger.log(`[ButtonRenderer]  Button clicked: "${button.textContent}" (type: ${type}, value: ${value}, action: ${action})`);
      this.logger.log(`[ButtonRenderer] Button clicked: ${button.textContent} (type: ${type}, value: ${value}, action: ${action})`);

      // For submit/reset buttons, let the form handle it naturally
      if (type === 'submit' || type === 'reset') {
        this.logger.log(`[ButtonRenderer] ${type} button - letting form handle submission`);
        this.logger.log(`[ButtonRenderer] ${type} button - letting form handle submission`);
        // Don't preventDefault, don't send WebSocket response
        // The form's submit event will fire and can be handled separately
        return;
      }

      // zLink action — auto-redirect, mirrors CLI semantics
      if (action && action.startsWith('zLink(')) {
        const path = action.slice(6, -1).trim();
        this.logger.log(`[ButtonRenderer] zLink action — navigating to: ${path}`);
        const client = this.client || window.bifrostClient;
        if (client?.zLink) {
          client.zLink(path);
        }
        return;
      }

      // zBack action — navigate back one block, mirrors CLI semantics
      if (action === 'zBack') {
        this.logger.log('[ButtonRenderer] zBack action — navigating back');
        const client = this.client || window.bifrostClient;
        if (client?.zBack) {
          client.zBack();
        }
        return;
      }

      // zDelta action — intra-file block hop, mirrors CLI semantics
      if (action && (action.startsWith('zDelta(') || action.startsWith('$'))) {
        const blockName = action.startsWith('zDelta(')
          ? action.slice(7, -1).replace(/^\$/, '').trim()
          : action.slice(1).trim();
        this.logger.log(`[ButtonRenderer] zDelta action — block hop to: ${blockName}`);
        const client = this.client || window.bifrostClient;
        if (client?.zDelta) {
          client.zDelta(blockName);
        }
        return;
      }

      // For regular buttons (type="button"), check if it has an action
      if (action && action.startsWith('&')) {
        this.logger.log(`[ButtonRenderer]  Button has plugin action: ${action}`);

        // Collect wizard input values (look for sibling inputs in same wizard container)
        const collectedValues = this._collectWizardValues(button);
        this.logger.log(`[ButtonRenderer]  Collected wizard values:`, collectedValues);

        // Send button action event with collected values
        this._sendButtonAction(requestId, action, collectedValues);
        button.disabled = true; // prevent double-fire
      } else if (requestId) {
        // Interactive button awaiting a backend response (zDialog / zWizard).
        // A parked wizard gate carries _renderInline: collect the pre-gate
        // field values, pin the reveal to this button's own container (append),
        // and send them alongside the truthy value. The button stays dumb — it
        // just resolves its requestId; the runtime owns the wizard knowledge.
        if (renderInline) {
          const ctx = this._collectInlineContext(button);
          if (ctx.container) {
            const client = this.client || window.bifrostClient;
            if (client) {
              client._renderTarget = { el: ctx.container, mode: 'append', once: true };
            }
          }
          this._sendResponse(requestId, value, ctx.values);
        } else {
          this.logger.log('[ButtonRenderer] Regular button - sending WebSocket response');
          this._sendResponse(requestId, value);
        }
        button.disabled = true; // prevent double-submission
      } else {
        // Standalone / declarative button: no action and no pending request — a
        // plain showcase button. Nothing to fire; leave it interactive.
        this.logger.log('[ButtonRenderer] Button has no action and no pending request — no-op');
      }

      // NOTE: never rewrite button.textContent on click. The `[ok]` confirmation
      // is a log signal only — rendering it injected text and wiped icon buttons.
    });
  }

  /**
   * Send button response to backend
   * @private
   * @param {string} requestId - Request ID
   * @param {boolean} value - Response value
   */
  _sendResponse(requestId, value, values = null) {
    // Try to get connection from client or global window object
    const connection = this.client?.connection || window.bifrostClient?.connection;

    if (!connection) {
      this.logger.error('[ButtonRenderer] No WebSocket connection available');
      return;
    }

    try {
      const payload = { event: 'input_response', requestId, value };
      if (values && Object.keys(values).length) {
        payload.values = values;
      }
      connection.send(JSON.stringify(payload));

      this.logger.log('[ButtonRenderer] Response sent:', payload);
    } catch (error) {
      this.logger.error('[ButtonRenderer] Failed to send response:', error);
    }
  }

  /**
   * Collect inline-reveal context for a parked wizard gate button.
   *
   * Walks up to the button's container (nearest [data-zkey] ancestor) and
   * harvests the value of every field inside it, keyed by each field's own
   * enclosing [data-zkey] (the wizard step key, e.g. Ask_Name). Generic — the
   * button forwards nearby field values; the runtime decides their meaning.
   *
   * @private
   * @param {HTMLElement} button
   * @returns {{container: HTMLElement|null, values: Object}}
   */
  _collectInlineContext(button) {
    const values = {};
    const container = button.closest('[data-zkey]') || button.parentElement;
    if (!container) {
      return { container: null, values };
    }
    const fields = container.querySelectorAll(
      'input.zForm-control, input[type="text"], input[type="email"], ' +
      'input[type="number"], input[type="password"], textarea, select'
    );
    fields.forEach((field) => {
      const keyEl = field.closest('[data-zkey]');
      const key = keyEl ? keyEl.getAttribute('data-zkey') : (field.id || field.name);
      if (key && key !== container.getAttribute('data-zkey')) {
        values[key] = field.value || '';
      }
    });
    this.logger.log('[ButtonRenderer] Inline gate context:', values);
    return { container, values };
  }

  /**
   * Collect wizard input values from sibling inputs
   * Looks for input elements in the same container as the button
   * @private
   * @param {HTMLElement} button - Button element
   * @returns {Array} Array of input values in order
   */
  _collectWizardValues(button) {
    const values = [];
    
    // Strategy: Look upward for wizard container markers, then fallback to parent
    // 1. Try data-zwizard attribute (explicit wizard)
    // 2. Try data-zkey containing "zWizard" (orchestrator pattern)
    // 3. Fallback to nearest parent with multiple children
    
    let container = button.closest('[data-zwizard]');
    
    if (!container) {
      // Try to find parent with data-zkey attribute (orchestrator pattern)
      let current = button.parentElement;
      while (current && !container) {
        if (current.hasAttribute('data-zkey')) {
          container = current;
          break;
        }
        current = current.parentElement;
      }
    }
    
    // Fallback to direct parent
    if (!container) {
      container = button.parentElement;
    }
    
    if (!container) {
      this.logger.warn('[ButtonRenderer] [WARN]  Could not find wizard container');
      return values;
    }
    
    this.logger.log('[ButtonRenderer] Searching for inputs in container:', container.getAttribute('data-zkey') || container.id || container.className);
    
    // Find all input elements in the same container (look for .zForm-control class from form_primitives)
    const inputs = container.querySelectorAll('input.zForm-control, input[type="text"], input[type="email"], input[type="number"], textarea');
    
    this.logger.log('[ButtonRenderer]  Found', inputs.length, 'input(s)');
    
    inputs.forEach((input, index) => {
      const value = input.value || '';
      this.logger.log(`[ButtonRenderer]   Input ${index}: "${value}" (id: ${input.id}, placeholder: ${input.placeholder})`);
      values.push(value);
    });
    
    return values;
  }

  /**
   * Send button action event to backend
   * @private
   * @param {string} requestId - Request ID
   * @param {string} action - Plugin action string (e.g., "&plugin.func(zHat[0])")
   * @param {Array} collectedValues - Collected wizard input values
   */
  _sendButtonAction(requestId, action, collectedValues) {
    // Try to get connection from client or global window object
    const connection = this.client?.connection || window.bifrostClient?.connection;

    if (!connection) {
      this.logger.error('[ButtonRenderer] No WebSocket connection available');
      this.logger.error('[ButtonRenderer] [ERROR] No WebSocket connection');
      return;
    }

    try {
      const payload = {
        event: 'button_action',
        requestId: requestId,
        action: action,
        collected_values: collectedValues
      };
      
      this.logger.log('[ButtonRenderer] Sending button action:', payload);
      connection.send(JSON.stringify(payload));

      this.logger.log('[ButtonRenderer] Button action sent:', payload);
    } catch (error) {
      this.logger.error('[ButtonRenderer] Failed to send button action:', error);
      this.logger.error('[ButtonRenderer] [ERROR] Failed to send:', error);
    }
  }

}
