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

// Layer 0: Primitives
import {
  createForm,
  createInput,
  createTextarea,
  createSelect,
  createOption,
  createLabel
} from '../primitives/form_primitives.js';

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
      fields
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

    // Error display area (hidden by default)
    const errorContainer = createElement('div', ['zDialog-errors', 'zAlert', 'zAlert-danger', 'zmt-3']);
    errorContainer.style.display = 'none';
    form.appendChild(errorContainer);

    // Submit button using primitive
    const submitButton = createElement('button', ['zBtn', 'zBtn-primary', 'zmt-3'], {
      type: 'submit'
    });
    submitButton.textContent = 'Submit';
    form.appendChild(submitButton);

    // Handle form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleSubmit(form, _dialogId);
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

    // Error display area (hidden by default)
    const errorContainer = createElement('div', ['zDialog-errors', 'zAlert', 'zAlert-danger', 'zmt-3']);
    errorContainer.style.display = 'none';
    container.appendChild(errorContainer);

    const btn = createElement('button', ['zBtn', btnClass]);
    btn.textContent = btnLabel;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Processing...';
      errorContainer.style.display = 'none';
      clearElement(errorContainer);

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
          onSubmit: formContext.onSubmit,
          model: formContext.model,
          table: formContext.table
        });

        if (response.success) {
          clearElement(container);
          const successMsg = createElement('div', ['zAlert', 'zAlert-success']);
          successMsg.innerHTML = `<strong>Done!</strong> ${response.message || 'Action completed.'}`;
          container.appendChild(successMsg);
          this.formContexts.delete(dialogId);
        } else {
          errorContainer.style.display = 'block';
          errorContainer.textContent = response.message || 'Action failed.';
          btn.disabled = false;
          btn.textContent = btnLabel;
        }
      } catch (error) {
        this.logger.error('[FormRenderer] Confirm button error:', error);
        errorContainer.style.display = 'block';
        errorContainer.textContent = 'Failed to execute action. Please try again.';
        btn.disabled = false;
        btn.textContent = btnLabel;
      }
    });

    container.appendChild(btn);
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

    // Field group container
    const fieldGroup = createElement('div', ['zmb-3']);

    // Label using primitive
    const label = createLabel(fieldName, { class: 'zLabel' });
    label.textContent = this._formatLabel(fieldLabel);

    if (required) {
      const requiredMark = createElement('span', ['zText-danger']);
      requiredMark.textContent = ' *';
      label.appendChild(requiredMark);
    }
    fieldGroup.appendChild(label);

    // Input field using primitive
    const input = this._createInput(fieldName, fieldType, required, fieldDef);
    fieldGroup.appendChild(input);

    return fieldGroup;
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
      // Render <select> for enum fields
      const options = (fieldDef && typeof fieldDef === 'object' && fieldDef.options) ? fieldDef.options : [];
      const defaultVal = (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null;

      input = createSelect({
        name: fieldName,
        class: 'zInput',
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

    } else if (fieldType === 'radio') {
      // Render radio button group for bool fields (True / False [/ null if not required])
      const options = (fieldDef && typeof fieldDef === 'object' && fieldDef.options) ? fieldDef.options : ['true', 'false'];
      const defaultVal = (fieldDef && typeof fieldDef === 'object' && fieldDef.default != null) ? String(fieldDef.default) : null;

      const wrapper = createElement('div', ['zRadio-group', 'zd-flex', 'zgap-3']);
      options.forEach(opt => {
        const optLabel = createElement('label', ['zRadio-label', 'zd-flex', 'zalign-items-center', 'zgap-1']);
        const radio = createInput('radio', { name: fieldName, value: opt });
        if (String(opt) === defaultVal) radio.checked = true;
        const caption = createElement('span');
        caption.textContent = opt.charAt(0).toUpperCase() + opt.slice(1);
        optLabel.appendChild(radio);
        optLabel.appendChild(caption);
        wrapper.appendChild(optLabel);
      });
      input = wrapper;

    } else if (fieldType === 'textarea') {
      const defaultVal = (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null;
      input = createTextarea({
        name: fieldName,
        class: 'zInput',
        rows: 4,
        required: required,
        placeholder: `Enter ${this._formatLabel(fieldName).toLowerCase()}`,
        ...(defaultVal != null && { value: String(defaultVal) })
      });
    } else {
      // Use input primitive with appropriate type
      let inputType = 'text';

      // Map field types to HTML5 input types
      if (fieldType === 'password') {
        inputType = 'password';
      } else if (fieldType === 'email') {
        inputType = 'email';
      } else if (fieldType === 'number') {
        inputType = 'number';
      } else if (fieldType === 'tel' || fieldType === 'phone') {
        inputType = 'tel';
      } else if (fieldType === 'date') {
        inputType = 'date';
      } else if (fieldType === 'time') {
        inputType = 'time';
      } else if (fieldType === 'datetime') {
        inputType = 'datetime-local';
      }

      const defaultVal = (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null;
      input = createInput(inputType, {
        name: fieldName,
        class: 'zInput',
        required: required,
        placeholder: `Enter ${this._formatLabel(fieldName).toLowerCase()}`,
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

    // Clear previous errors
    const errorContainer = formElement.querySelector('.zDialog-errors');
    if (errorContainer) {
      errorContainer.style.display = 'none';
      clearElement(errorContainer);
    }

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
        onSubmit: formContext.onSubmit,
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

    // Display success message
    const successContainer = createElement('div', ['zAlert', 'zAlert-success', 'zmt-3']);
    successContainer.innerHTML = `
      <strong>Success!</strong> ${response.message || 'Form submitted successfully.'}
    `;

    // Replace form with success message
    const formContainer = formElement.closest('.zDialog-container');
    if (formContainer) {
      clearElement(formContainer);
      formContainer.appendChild(successContainer);
      
      // Clean up form context from Map using dialogId from form container
      const dialogId = formContainer.getAttribute('data-dialog-id');
      if (dialogId) {
        this.formContexts.delete(dialogId);
        this.logger.log('[FormRenderer] Cleaned up form context for:', dialogId);
      }
    }

    // Refresh navbar after successful submission (e.g., after login)
    // This ensures RBAC-filtered navbar items are updated
    if (this.client && typeof this.client._fetchAndPopulateNavBar === 'function') {
      this.logger.log('[FormRenderer] Refreshing navbar for RBAC update');
      this.client._fetchAndPopulateNavBar().catch(err => {
        this.logger.error('[FormRenderer] Failed to refresh navbar:', err);
      });
    }
  }

  /**
   * Handle form submission error
   * @private
   * @param {HTMLFormElement} formElement - Form element
   * @param {Object} response - Server error response
   */
  _handleError(formElement, response) {
    this.logger.error('[FormRenderer] Form submission failed:', response);

    const errorContainer = formElement.querySelector('.zDialog-errors');
    if (errorContainer) {
      errorContainer.style.display = 'block';

      const errorList = createElement('ul', ['zmb-0']);

      // Display validation errors
      if (response.errors && Array.isArray(response.errors)) {
        response.errors.forEach(error => {
          const errorItem = createElement('li');
          errorItem.textContent = error;
          errorList.appendChild(errorItem);
        });
      } else {
        const errorItem = createElement('li');
        errorItem.textContent = response.message || 'Validation failed. Please check your input.';
        errorList.appendChild(errorItem);
      }

      clearElement(errorContainer);
      const errorHeader = createElement('strong');
      errorHeader.textContent = 'Error:';
      errorContainer.appendChild(errorHeader);
      errorContainer.appendChild(errorList);
    }

    // Scroll to errors
    if (errorContainer) {
      errorContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}
