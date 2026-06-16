/**
 * FormRenderer - Async Form Rendering for zDialog in Bifrost Mode
 *
 * This renderer handles the display and submission of zDialog forms in the browser.
 * Unlike Terminal mode (which collects input field-by-field), Bifrost displays the
 * entire form at once with all fields visible.
 *
 * Key Differences from Terminal:
 * - Terminal: Blocking, field-by-field, synchronous
 * - Bifrost: Non-blocking, all-at-once, asynchronous
 *
 * Flow:
 * 1. Backend sends zDialog event with form context
 * 2. FormRenderer displays full HTML form
 * 3. User fills and clicks Submit
 * 4. FormRenderer sends form_submit WebSocket message
 * 5. Backend validates and executes onSubmit
 * 6. Backend sends result back to frontend
 *
 * Architecture:
 * - Uses form_primitives.js for raw HTML element creation
 * - Uses dom_utils.js for DOM manipulation
 * - Applies zTheme classes for styling
 * - Handles WebSocket communication for submission
 *
 * @module FormRenderer
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 2: Utilities
import { createElement, clearElement } from '../../../zSys/dom/dom_utils.js';
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';
import { convertZPathToURL } from '../primitives/link_primitives.js';

// Layer 0: Primitives
import {
  createForm,
  createInput,
  createTextarea,
  createSelect,
  createOption,
  createLabel
} from '../primitives/form_primitives.js';

/**
 * Append a red required marker (*) to a label/legend when the field is required.
 * SSOT — styled by .zRequired in zbase.css. Mirrors input_event_handler so a
 * field looks identical whether it is standalone or inside a zDialog form.
 */
function appendRequiredMark(labelEl, required) {
  if (!required || !labelEl) return;
  const star = createElement('span', ['zRequired']);
  star.textContent = ' *';
  star.setAttribute('aria-hidden', 'true');
  labelEl.appendChild(star);
}

export class FormRenderer {
  constructor(logger, client = null) {
    if (!logger) {
      throw new Error('[FormRenderer] logger is required');
    }
    this.logger = logger;
    this.client = client;
    // Use Map to store multiple form contexts, keyed by _dialogId
    this.formContexts = new Map();

    // Wrap renderForm with the error boundary (public API is renderForm).
    const originalRender = this.renderForm.bind(this);
    this.renderForm = withErrorBoundary(originalRender, {
      component: 'FormRenderer',
      logger: this.logger
    });
  }

  /**
   * Render a zDialog form
   * @param {Object} eventData - Form context from backend
   * @param {string} eventData.title - Form title
   * @param {string} eventData.model - Schema model path (optional)
   * @param {Array} eventData.fields - Field definitions
   * @param {Object} eventData.onSubmit - Submit action to execute
   * @param {string} eventData._dialogId - Unique form identifier
   * @returns {HTMLElement} Form container element
   */
  renderForm(eventData) {
    this.logger.log('[FormRenderer] Rendering form:', eventData.title);

    const {
      title = 'Form',
      model,
      table,
      fields = [],
      dialog_mode,
      onSubmit,
      _dialogId
    } = eventData;

    // Store form context in Map, keyed by unique _dialogId
    this.formContexts.set(_dialogId, {
      model,
      table,
      onSubmit,
      fields,
      title
    });

    // dialog_mode: "confirm" → confirm button (backend-declared, SSOT signal)
    // Backend sets this when fields: [] — we read the server signal, not fields.length
    if (dialog_mode === 'confirm') {
      return this._renderConfirmButton(title, onSubmit, _dialogId);
    }

    // Create form container using primitives
    const formContainer = createElement('div', ['zDialog-container', 'zCard', 'zp-4'], {
      'data-dialog-id': _dialogId
    });

    // Form title
    if (title) {
      const titleElement = createElement('h2', ['zDialog-title', 'zCard-title', 'zmb-3']);
      titleElement.textContent = title;
      formContainer.appendChild(titleElement);
    }

    // Create HTML form element using primitive
    const form = createForm({
      class: 'zDialog-form',
      'data-dialog-id': _dialogId
    });

    // Render fields
    fields.forEach(fieldDef => {
      const fieldGroup = this._createFieldGroup(fieldDef);
      form.appendChild(fieldGroup);
    });

    // Actions row — Submit + Reset. Reset is a native type=reset (restores each
    // field to its default for free); we only clear the feedback slot on top.
    const actions = createElement('div', ['zDialog-actions']);

    const submitButton = createElement('button', ['zBtn', 'zBtn-primary'], {
      type: 'submit'
    });
    submitButton.textContent = 'Submit';
    actions.appendChild(submitButton);

    const resetButton = createElement('button', ['zBtn', 'zBtn-outline-secondary'], {
      type: 'reset'
    });
    resetButton.textContent = 'Reset';
    actions.appendChild(resetButton);

    form.appendChild(actions);

    // Feedback slot — success/error signals render here, below the actions.
    const feedback = createElement('div', ['zDialog-feedback']);
    form.appendChild(feedback);

    // Handle form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleSubmit(form, _dialogId);
    });

    // Reset clears any standing feedback (native reset restores field defaults).
    form.addEventListener('reset', () => {
      const slot = form.querySelector('.zDialog-feedback');
      if (slot) clearElement(slot);
    });

    formContainer.appendChild(form);
    return formContainer;
  }

  /**
   * Render a confirm button for zDialog with fields: []
   * No input collection — action is pre-baked into onSubmit.
   * Color is derived from the action type: delete → danger, others → primary.
   * @private
   * @param {string} title - Dialog title (shown above the button)
   * @param {Object} onSubmit - onSubmit action from the dialog definition
   * @param {string} dialogId - Unique dialog identifier
   * @returns {HTMLElement} Confirm button container
   */
  _renderConfirmButton(title, onSubmit, dialogId) {
    const action = onSubmit?.zData?.action || 'submit';
    const isDangerous = action === 'delete';
    const btnClass = isDangerous ? 'zBtn-danger' : 'zBtn-primary';
    const btnLabel = isDangerous ? 'Confirm Delete' : 'Confirm';

    this.logger.log(`[FormRenderer] fields:[] → confirm button mode | action: ${action} | dialogId: ${dialogId}`);

    const container = createElement('div', ['zDialog-container', 'zCard', 'zp-4'], {
      'data-dialog-id': dialogId
    });

    if (title) {
      const titleElement = createElement('p', ['zmb-2', 'zText-muted']);
      titleElement.textContent = title;
      container.appendChild(titleElement);
    }

    const btn = createElement('button', ['zBtn', btnClass]);
    btn.textContent = btnLabel;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Processing...';
      const slot = container.querySelector('.zDialog-feedback');
      if (slot) clearElement(slot);

      try {
        const formContext = this.formContexts.get(dialogId);
        if (!formContext) {
          this.logger.error('[FormRenderer] No form context for confirm button:', dialogId);
          return;
        }

        const response = await this.client.send({
          event: 'form_submit',
          dialogId: dialogId,
          data: {},
          model: formContext.model,
          table: formContext.table
        });

        if (response.success) {
          await this._emitSignal(container, 'success', response.message || 'Action completed.');
          btn.textContent = 'Done';
          this.formContexts.delete(dialogId);
        } else {
          await this._emitSignal(container, 'error', response.message || 'Action failed.');
          btn.disabled = false;
          btn.textContent = btnLabel;
        }
      } catch (error) {
        this.logger.error('[FormRenderer] Confirm button error:', error);
        await this._emitSignal(container, 'error', 'Failed to execute action. Please try again.');
        btn.disabled = false;
        btn.textContent = btnLabel;
      }
    });

    container.appendChild(btn);

    // Feedback slot — success/error signals render here, below the button.
    const feedback = createElement('div', ['zDialog-feedback']);
    container.appendChild(feedback);
    return container;
  }

  /**
   * Create a form field group (label + input)
   * @private
   * @param {string|Object} fieldDef - Field definition (string or object)
   * @returns {HTMLElement} Field group element
   */
  _createFieldGroup(fieldDef) {
    // Handle both string and object field definitions
    const fieldName = typeof fieldDef === 'string' ? fieldDef : fieldDef.name;

    // Auto-detect field type from field name if not explicitly provided
    let fieldType = 'text';
    if (typeof fieldDef === 'object' && fieldDef.type) {
      // Explicit type provided
      fieldType = fieldDef.type;
    } else {
      // Auto-detect based on field name
      const lowerName = fieldName.toLowerCase();
      if (lowerName === 'password' || lowerName.includes('password')) {
        fieldType = 'password';
      } else if (lowerName === 'email' || lowerName.includes('email')) {
        fieldType = 'email';
      } else if (lowerName === 'phone' || lowerName === 'tel' || lowerName.includes('phone')) {
        fieldType = 'tel';
      }
    }

    const fieldLabel = typeof fieldDef === 'object' ? (fieldDef.label || fieldName) : fieldName;
    const required = typeof fieldDef === 'object' ? (fieldDef.required === true) : false;

    // radio / checkbox → canonical .zForm-check-group (label lives inside the group)
    if (fieldType === 'radio' || fieldType === 'checkbox') {
      return this._createCheckGroup(fieldName, fieldType, fieldLabel, required, fieldDef);
    }

    // Field group container
    const fieldGroup = createElement('div', ['zmb-3']);

    // Label using primitive — canonical .zLabel + .zRequired marker
    const label = createLabel(fieldName, { class: 'zLabel' });
    label.textContent = this._formatLabel(fieldLabel);
    appendRequiredMark(label, required);
    fieldGroup.appendChild(label);

    // Input field using primitive
    const input = this._createInput(fieldName, fieldType, required, fieldDef);
    fieldGroup.appendChild(input);

    return fieldGroup;
  }

  /**
   * Create a radio / checkbox field as a canonical .zForm-check-group.
   * Mirrors input_event_handler emission: a .zLabel heading followed by
   * .zForm-check rows (.zForm-check-input + .zForm-check-label) so dialog
   * choices look identical to standalone zSelect/zCheckbox controls.
   * @private
   */
  _createCheckGroup(fieldName, fieldType, fieldLabel, required, fieldDef) {
    const isRadio = fieldType === 'radio';
    const defaultOpts = isRadio ? ['true', 'false'] : ['true'];
    const options = (fieldDef && typeof fieldDef === 'object' && Array.isArray(fieldDef.options))
      ? fieldDef.options : defaultOpts;
    const defaultVal = (fieldDef && typeof fieldDef === 'object' && fieldDef.default != null)
      ? String(fieldDef.default) : null;

    const group = createElement('div', ['zForm-check-group', 'zmb-3']);

    const heading = createElement('div', ['zLabel']);
    heading.textContent = this._formatLabel(fieldLabel);
    appendRequiredMark(heading, required);
    group.appendChild(heading);

    options.forEach((opt, i) => {
      const optId = `${fieldName}_${i}`;
      const row = createElement('div', ['zForm-check', 'zmb-2']);
      const control = createInput(isRadio ? 'radio' : 'checkbox', {
        id: optId,
        name: fieldName,
        value: opt,
        class: 'zForm-check-input'
      });
      if (String(opt) === defaultVal) control.checked = true;
      const optLabel = createLabel(optId, { class: 'zForm-check-label' });
      optLabel.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
      row.appendChild(control);
      row.appendChild(optLabel);
      group.appendChild(row);
    });

    return group;
  }

  /**
   * Create an input element based on field type using primitives
   * @private
   * @param {string} fieldName - Field name
   * @param {string} fieldType - Field type (text, password, email, select, textarea, etc.)
   * @param {boolean} required - Whether field is required
   * @param {string|Object} fieldDef - Original field definition (for options/default)
   * @returns {HTMLElement} Input element
   */
  _createInput(fieldName, fieldType, required, fieldDef = null) {
    let input;

    if (fieldType === 'select') {
      // Render <select> for enum fields — canonical .zSelect (dropdown styling)
      const options = (fieldDef && typeof fieldDef === 'object' && fieldDef.options) ? fieldDef.options : [];
      const defaultVal = (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null;

      input = createSelect({
        name: fieldName,
        class: 'zSelect',
        required: required
      });

      // Add blank placeholder option when no default
      if (!defaultVal) {
        const placeholder = createOption('', `— select ${this._formatLabel(fieldName).toLowerCase()} —`);
        placeholder.disabled = true;
        placeholder.selected = true;
        input.appendChild(placeholder);
      }

      options.forEach(opt => {
        const optEl = createOption(opt, opt);
        if (String(opt) === String(defaultVal)) {
          optEl.selected = true;
        }
        input.appendChild(optEl);
      });

    } else if (fieldType === 'textarea') {
      const defaultVal = (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null;
      input = createTextarea({
        name: fieldName,
        class: 'zForm-control',
        rows: 4,
        required: required,
        placeholder: `Enter ${this._formatLabel(fieldName).toLowerCase()}`,
        ...(defaultVal != null && { value: String(defaultVal) })
      });
    } else {
      // Map field types to HTML5 input types (covered field primitives)
      const TYPE_MAP = {
        password: 'password', email: 'email', number: 'number',
        tel: 'tel', phone: 'tel',
        date: 'date', time: 'time',
        datetime: 'datetime-local', 'datetime-local': 'datetime-local',
        week: 'week', month: 'month', color: 'color'
      };
      const inputType = TYPE_MAP[fieldType] || 'text';

      // Date/time/color carry their own value, not a text placeholder
      const isPicker = ['date', 'time', 'datetime-local', 'week', 'month', 'color'].includes(inputType);
      const defaultVal = (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null;
      input = createInput(inputType, {
        name: fieldName,
        class: 'zForm-control',
        required: required,
        ...(isPicker ? {} : { placeholder: `Enter ${this._formatLabel(fieldName).toLowerCase()}` }),
        ...(defaultVal != null && { value: String(defaultVal) })
      });
    }

    return input;
  }

  /**
   * Format field name to human-readable label
   * @private
   * @param {string} fieldName - Field name (snake_case or camelCase)
   * @returns {string} Formatted label (Title Case)
   */
  _formatLabel(fieldName) {
    // Convert snake_case or camelCase to Title Case
    return fieldName
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Handle form submission
   * @private
   * @param {HTMLFormElement} formElement - Form element
   * @param {string} dialogId - Dialog identifier
   */
  async _handleSubmit(formElement, dialogId) {
    this.logger.log('[FormRenderer] Form submit triggered:', dialogId);

    // Retrieve form context from Map using dialogId
    const formContext = this.formContexts.get(dialogId);
    if (!formContext) {
      this.logger.error('[FormRenderer] No form context found for dialogId:', dialogId);
      return;
    }

    // Clear any standing feedback signal before re-submitting.
    const feedback = formElement.querySelector('.zDialog-feedback');
    if (feedback) clearElement(feedback);

    // Collect form data
    const formData = new FormData(formElement);
    const data = {};
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }

    this.logger.log('[FormRenderer] Collected form data:', Object.keys(data));

    // Disable submit button during submission
    const submitButton = formElement.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';

    try {
      // Send form submission to backend via WebSocket
      const response = await this.client.send({
        event: 'form_submit',
        dialogId: dialogId,
        data: data,
        model: formContext.model,
        table: formContext.table
      });

      this.logger.log('[FormRenderer] Submission response:', response);

      // Handle response
      if (response.success) {
        this._handleSuccess(formElement, response);
      } else {
        this._handleError(formElement, response);
      }

      // Integration seam: announce the outcome on the DOM so client plugins
      // (zScripts) can react with the submitted values — confetti, overlays,
      // analytics — without touching the renderer. Same data the backend got.
      this._emitFormEvent(formElement, formContext, response.success, data, response);

    } catch (error) {
      this.logger.error('[FormRenderer] Submission error:', error);
      this._handleError(formElement, {
        success: false,
        message: 'Failed to submit form. Please try again.',
        errors: [error.message]
      });
    } finally {
      // Re-enable submit button
      submitButton.disabled = false;
      submitButton.textContent = originalText;
    }
  }

  /**
   * Handle successful form submission
   * @private
   * @param {HTMLFormElement} formElement - Form element
   * @param {Object} response - Server response
   */
  _handleSuccess(formElement, response) {
    this.logger.log('[FormRenderer] Form submission successful');

    // Terminal states first — navigate/reload leave this view, so the form and
    // its context are done. Fire the signal, drop context, then hand off.
    if (response.navigate) {
      this._emitSignal(formElement, 'success', response.message || 'Done.');
      this._dropFormContext(formElement);
      const routePath = convertZPathToURL(response.navigate);
      this.logger.log('[FormRenderer] Server requested navigation to:', routePath);
      setTimeout(() => {
        if (this.client && typeof this.client._navigateToRoute === 'function') {
          // Navigate, THEN refresh the navbar — login changed the session, so the
          // RBAC-filtered nav (zAccount/logout) must rebuild for the new role.
          this.client._navigateToRoute(routePath).then(() => {
            if (typeof this.client._fetchAndPopulateNavBar === 'function') {
              this.client._fetchAndPopulateNavBar().catch(err => {
                this.logger.error('[FormRenderer] Failed to refresh navbar:', err);
              });
            }
          }).catch(err => {
            this.logger.error('[FormRenderer] Navigation failed:', err);
          });
        } else {
          window.location.href = routePath;
        }
      }, 800);
      return;
    }

    if (response.reload === true) {
      this._emitSignal(formElement, 'success', response.message || 'Done.');
      this._dropFormContext(formElement);
      this.logger.log('[FormRenderer] Server requested page reload for RBAC sidebar refresh');
      setTimeout(() => { window.location.reload(); }, 800);
      return;
    }

    // Plain success — the form STAYS (like a real website): emit a success
    // signal below the actions and reset fields to their defaults so the user
    // can submit again. The form context is kept for the next submit.
    this._emitSignal(formElement, 'success', response.message || 'Form submitted successfully.');
    formElement.reset();

    // Refresh navbar (e.g. RBAC change) without leaving the form.
    if (this.client && typeof this.client._fetchAndPopulateNavBar === 'function') {
      this.client._fetchAndPopulateNavBar().catch(err => {
        this.logger.error('[FormRenderer] Failed to refresh navbar:', err);
      });
    }
  }

  /**
   * Handle form submission error — surface it as an inline error signal,
   * keeping the form (and the user's input) in place.
   * @private
   * @param {HTMLFormElement} formElement - Form element
   * @param {Object} response - Server error response
   */
  _handleError(formElement, response) {
    this.logger.error('[FormRenderer] Form submission failed:', response);
    const messages = (Array.isArray(response.errors) && response.errors.length)
      ? response.errors
      : [response.message || 'Validation failed. Please check your input.'];
    this._emitSignal(formElement, 'error', messages.join(' · '));
  }

  /**
   * Render a zSignal (success/error/…) into a root's .zDialog-feedback slot,
   * via the display orchestrator — the same SSOT path standalone signals use.
   * @private
   * @param {HTMLElement} root - Form or container holding the feedback slot
   */
  async _emitSignal(root, event, content) {
    const slot = root.querySelector('.zDialog-feedback');
    if (!slot) return;
    clearElement(slot);

    const orch = this.client && this.client.zDisplayOrchestrator;
    if (orch && typeof orch.renderZDisplayEvent === 'function') {
      const el = await orch.renderZDisplayEvent({ event, content }, slot);
      if (el) slot.appendChild(el);
      return;
    }
    // Fallback (orchestrator unavailable): build the canonical signal card.
    const card = createElement('div', ['zSignal', `zSignal-${event}`, 'zAlert']);
    card.textContent = content;
    slot.appendChild(card);
  }

  /**
   * Emit a bubbling DOM CustomEvent (zForm:success / zForm:error) carrying the
   * submitted values, the form title, and the server response — the public hook
   * client plugins use to react to a form result.
   * @private
   * @param {HTMLFormElement} formElement - Form element
   * @param {Object} formContext - Stored context (title/model/table)
   * @param {boolean} success - Whether the submission succeeded
   * @param {Object} data - Collected field values
   * @param {Object} response - Server response
   */
  _emitFormEvent(formElement, formContext, success, data, response) {
    const name = success ? 'zForm:success' : 'zForm:error';
    const detail = {
      title: (formContext && formContext.title) || null,
      data,
      response
    };
    (formElement || document).dispatchEvent(
      new CustomEvent(name, { bubbles: true, detail })
    );
    this.logger.log(`[FormRenderer] dispatched ${name}`, detail.title);
  }

  /**
   * Drop a form's stored context (used on terminal navigate/reload).
   * @private
   */
  _dropFormContext(formElement) {
    const container = formElement.closest('.zDialog-container');
    const dialogId = container && container.getAttribute('data-dialog-id');
    if (dialogId) {
      this.formContexts.delete(dialogId);
      this.logger.log('[FormRenderer] Cleaned up form context for:', dialogId);
    }
  }
}
