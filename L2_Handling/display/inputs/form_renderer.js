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
import { createChoiceGroup } from './choice_group.js';
import { withErrorBoundary } from '../../../zSys/validation/error_boundary.js';
import { convertZPathToURL } from '../primitives/link_primitives.js';
import { resultSignalFrom } from '../feedback/zfunc_signal.js';

// Layer 0: Primitives
import {
  createForm,
  createInput,
  createTextarea,
  createSelect,
  createOption,
  createLabel
} from '../primitives/form_primitives.js';

// ─────────────────────────────────────────────────────────────────
// Field-rules SSOT (JS mirror of field_rules.py → TYPE_PRESETS)
// These are the SAME canonical regexes + messages the Python input hub uses.
//
// WHY THE MIRROR LIVES HERE (the dual-path architectural truth):
//   zDialog reaches the client by TWO routes —
//     1. INLINE page forms stream as raw zUI metadata through the display-tree
//        path (zdisplay_orchestrator → renderForm). The Python display layer
//        never enriches these; the fields arrive exactly as authored in .zolo.
//     2. RUNTIME/interactive dialogs go through display.zDialog →
//        send_gui_event, where the server DOES enrich (display_primitives
//        ._resolve_dialog_field_rules / field_rules.html_attrs).
//   Because route (1) bypasses the server entirely, the rule (pattern) and the
//   message MUST be resolved client-side to cover BOTH routes. Server-sent
//   enrichment alone would silently miss every inline page form. Hence this
//   mirror — fetching from the server would add a round-trip AND still leave
//   route (1) unenriched until it arrived. Keep these strings in lock-step
//   with field_rules.py (TYPE_PRESETS) — that file is the canonical source.
// ─────────────────────────────────────────────────────────────────
const _TYPE_PRESETS = {
  email:  { pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$',
            message: 'Invalid email address — expected format: user@domain.com' },
  url:    { pattern: '^[a-zA-Z][a-zA-Z0-9+\\-.]*:(?:\\/\\/[^\\s]+|(?!\\/\\/)[^\\s]+)$',
            message: 'Invalid URL — include the scheme (e.g. https://example.com)' },
  tel:    { pattern: '^[+\\d\\(*#][0-9\\s\\-\\(\\)+*#xX.]*$',
            message: 'Invalid phone number — use digits and separators only (e.g. +1 555 000 0000)' },
  color:  { pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$',
            message: 'Invalid color — use a hex value (e.g. #5CA9FF or #FFF)' },
  number: { message: 'Invalid number — enter a numeric value (e.g. 42, 3.14, -7)' },
};

/**
 * Read a File as base64 (no `data:...;base64,` prefix) for the __zFile
 * WS envelope — see the FormData collection note in _handleSubmit.
 */
function _fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',').pop());
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Name-based type auto-detection — mirrors Python field_rules.detect_type(). */
function _detectType(fieldName) {
  const lower = (fieldName || '').toLowerCase();
  if (lower.includes('password'))          return 'password';
  if (lower.includes('email'))             return 'email';
  if (lower === 'tel' || lower === 'phone' || lower.includes('phone')) return 'tel';
  return null;
}

/**
 * Resolve a field definition to a dict carrying any applicable preset HTML
 * attrs. Mirrors Python field_rules.html_attrs() — author-declared keys always
 * win; we only fill what's absent (e.g. an email field's pattern).
 * Returns the (possibly enriched) fieldDef; bare strings become dicts.
 */
function _resolveFieldRules(fieldDef) {
  let f, identity;
  if (typeof fieldDef === 'string') {
    f = { zConv: fieldDef };
    identity = fieldDef;
  } else if (fieldDef && typeof fieldDef === 'object') {
    f = Object.assign({}, fieldDef);
    identity = f.zConv || f.name || f.field || '';
  } else {
    return fieldDef;
  }

  const type = f.type || _detectType(identity);
  const preset = type && _TYPE_PRESETS[type];
  if (!preset) return f;

  // Fill attrs the preset provides but the author omitted.
  Object.entries(preset).forEach(([k, v]) => {
    if (f[k] == null) f[k] = v;
  });
  return f;
}

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
      zReset,
      _dialogId
    } = eventData;

    // Store form context in Map, keyed by unique _dialogId.
    // Store as-is (fields array pre-resolution); _resolveFieldRules runs below
    // at render time so every code path that calls renderForm benefits.
    this.formContexts.set(_dialogId, {
      model,
      table,
      onSubmit,
      fields: fields.map(_resolveFieldRules),
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

    // Resolve field rules (preset patterns, etc.) before rendering.
    // Covers BOTH paths: tree-streaming (fields arrive as raw .zolo data) AND
    // the runtime zDialog event (server already enriched, setdefault is a no-op).
    const resolvedFields = fields.map(_resolveFieldRules);

    resolvedFields.forEach(fieldDef => {
      const fieldGroup = this._createFieldGroup(fieldDef);
      form.appendChild(fieldGroup);
    });

    // Actions row — Submit always; Reset ONLY when the author opted in with
    // `zReset: true` (parity with the zCLI Submit/Reset chooser). Reset is a
    // native type=reset (restores each field to its default for free); we only
    // clear the feedback slot on top.
    const actions = createElement('div', ['zDialog-actions']);

    const submitButton = createElement('button', ['zBtn', 'zBtn-primary'], {
      type: 'submit'
    });
    submitButton.textContent = 'Submit';
    actions.appendChild(submitButton);

    if (zReset) {
      const resetButton = createElement('button', ['zBtn', 'zBtn-outline-secondary'], {
        type: 'reset'
      });
      resetButton.textContent = 'Reset';
      actions.appendChild(resetButton);
    }

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

        // Same result-envelope SSOT as the main submit + zFunc paths; button
        // state still keyed off response.success.
        const sig = resultSignalFrom(response, { ackOnVoid: true, ackText: 'Action completed.' });
        await this._emitSignal(container, sig.level, sig.text);
        if (response.success) {
          btn.textContent = 'Done';
          this.formContexts.delete(dialogId);
        } else {
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
    // Handle both string and object field definitions. The identity key (the
    // zConv binding) is canonical `zConv:`; `name`/`field` are back-compat
    // aliases. This value becomes the input's HTML name → the submitted data key
    // → zConv.<key>, matching the zCLI parser (SSOT).
    const fieldName = typeof fieldDef === 'string'
      ? fieldDef
      : (fieldDef.zConv || fieldDef.name || fieldDef.field);

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

    // select + multi → a checkbox group (browser multi-select parity with zSelect;
    // the zCLI side multi-picks the same options). Submitted as a list.
    if (fieldType === 'select' && fieldDef && typeof fieldDef === 'object'
        && (fieldDef.multi === true || fieldDef.multi === 'true')) {
      return this._createCheckGroup(fieldName, 'checkbox', fieldLabel, required, fieldDef);
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
    const authorOptions = (fieldDef && typeof fieldDef === 'object' && Array.isArray(fieldDef.options));
    const defaultVal = (fieldDef && typeof fieldDef === 'object' && fieldDef.default != null)
      ? String(fieldDef.default) : null;

    // Single boolean checkbox (no author options) → one box whose inline label IS
    // the field label, like a consent toggle. Checked submits 'true'; unchecked
    // submits nothing, so _handleSubmit injects 'false' for zCLI parity (the zCLI
    // picker always returns 'true'/'false'). This shape is unique to a dialog
    // field, so it stays local; everything else delegates to the choice_group SSOT.
    if (!isRadio && !authorOptions) {
      const row = createElement('div', ['zForm-check', 'zmb-3']);
      const optId = `${fieldName}_0`;
      const control = createInput('checkbox', {
        id: optId, name: fieldName, value: 'true', class: 'zForm-check-input'
      });
      if (defaultVal === 'true') control.checked = true;
      const lbl = createLabel(optId, { class: 'zForm-check-label' });
      lbl.textContent = this._formatLabel(fieldLabel);
      appendRequiredMark(lbl, required);
      row.appendChild(control);
      row.appendChild(lbl);
      return row;
    }

    // Radio set OR multi/checkbox group → canonical SSOT (shared with the
    // standalone zSelect control via choice_group.createChoiceGroup). A bare
    // yes/no radio (no author options) keeps capitalised True/False labels.
    const options = authorOptions
      ? fieldDef.options
      : [{ label: 'True', value: 'true' }, { label: 'False', value: 'false' }];

    return createChoiceGroup({
      name: fieldName,
      options,
      inputType: isRadio ? 'radio' : 'checkbox',
      defaultValue: (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null,
      required,
      disabled: !!(fieldDef && typeof fieldDef === 'object' && fieldDef.disabled === true),
      prompt: this._formatLabel(fieldLabel),
      groupClass: ''
    });
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

    // Author styling hook — SAME convention as a standalone zInput (_zClass
    // lands on the rendered <input>/<select>/<textarea>), just appended
    // alongside the canonical class so zForm-control/zSelect theming survives.
    const authorClass = (fieldDef && typeof fieldDef === 'object' && fieldDef._zClass)
      ? ` ${fieldDef._zClass}` : '';

    if (fieldType === 'select') {
      // Render <select> for enum fields — canonical .zSelect (dropdown styling)
      const options = (fieldDef && typeof fieldDef === 'object' && fieldDef.options) ? fieldDef.options : [];
      const defaultVal = (fieldDef && typeof fieldDef === 'object') ? fieldDef.default : null;

      input = createSelect({
        name: fieldName,
        class: `zSelect${authorClass}`,
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
      const fieldObj = (fieldDef && typeof fieldDef === 'object') ? fieldDef : {};
      const defaultVal = fieldObj.default;
      const taAttrs = {
        name: fieldName,
        class: `zForm-control${authorClass}`,
        rows: 4,
        required: required,
        placeholder: fieldObj.placeholder || `Enter ${this._formatLabel(fieldName).toLowerCase()}`,
        ...(defaultVal != null && { value: String(defaultVal) })
      };
      // readonly / disabled — parity with the zCLI input hub (which handles them
      // before the textarea branch). Length constraints only: <textarea> honours
      // minlength/maxlength but not pattern, matching field_rules' length subset.
      if (fieldObj.readonly) taAttrs.readonly = true;
      if (fieldObj.disabled) taAttrs.disabled = true;
      ['minlength', 'maxlength'].forEach((k) => {
        if (fieldObj[k] != null) taAttrs[k] = fieldObj[k];
      });
      input = createTextarea(taAttrs);
      // D2 — message SSOT: tooShort/tooLong bubbles read like the zCLI prompt.
      this._wireValidationMessages(input, fieldObj, fieldType);
    } else {
      // Map field types to HTML5 input types — SSOT parity with the zCLI input hub
      // (Text Fields · Files · Dates · Color). Unknown types fall back to text.
      const TYPE_MAP = {
        password: 'password', email: 'email', number: 'number',
        tel: 'tel', phone: 'tel', url: 'url', search: 'search',
        date: 'date', time: 'time',
        datetime: 'datetime-local', 'datetime-local': 'datetime-local',
        week: 'week', month: 'month', color: 'color', file: 'file'
      };
      const inputType = TYPE_MAP[fieldType] || 'text';

      const fieldObj = (fieldDef && typeof fieldDef === 'object') ? fieldDef : {};
      // Pickers carry their own native value/affordance — no text placeholder unless
      // the author explicitly sets one.
      const isPicker = ['date', 'time', 'datetime-local', 'week', 'month', 'color', 'file'].includes(inputType);
      const defaultVal = fieldObj.default;
      const datalistOpts = Array.isArray(fieldObj.datalist) ? fieldObj.datalist : null;

      const attrs = {
        name: fieldName,
        class: `zForm-control${authorClass}`,
        required: required
      };
      // readonly / disabled — native attrs, parity with the zCLI input hub
      // (shows the value, blocks editing). Disabled values are re-joined on
      // submit (the browser omits disabled fields; zCLI returns them).
      if (fieldObj.readonly) attrs.readonly = true;
      if (fieldObj.disabled) attrs.disabled = true;
      // Field constraints — native HTML attrs the browser enforces. These apply
      // with or without a type (the developer escape hatch); the matching rules
      // run in the zCLI input hub via field_rules (SSOT). The backend resolves
      // type presets (email→pattern, etc.) into these same attrs before send, so
      // the exact regex is identical on both surfaces. Attrs that don't apply to
      // a given input type are simply ignored by the browser.
      ['pattern', 'min', 'max', 'step', 'minlength', 'maxlength'].forEach((k) => {
        if (fieldObj[k] != null) attrs[k] = fieldObj[k];
      });
      if (!isPicker) {
        attrs.placeholder = fieldObj.placeholder || `Enter ${this._formatLabel(fieldName).toLowerCase()}`;
      } else if (fieldObj.placeholder) {
        attrs.placeholder = fieldObj.placeholder;
      }
      if (defaultVal != null) attrs.value = String(defaultVal);

      // File picker: forward the cross-surface accept/multiple contract.
      if (inputType === 'file') {
        if (fieldObj.accept) attrs.accept = fieldObj.accept;
        if (fieldObj.multiple) attrs.multiple = true;
      }

      // Datalist: native <datalist> + list= so the field offers suggestions while
      // still accepting free text (mirrors the zCLI numbered-suggestion behavior).
      let datalistEl = null;
      if (datalistOpts && inputType !== 'file') {
        const listId = `${fieldName}-datalist`;
        attrs.list = listId;
        datalistEl = createElement('datalist', [], { id: listId });
        datalistOpts.forEach(opt => datalistEl.appendChild(createOption(String(opt), String(opt))));
      }

      input = createInput(inputType, attrs);

      // D2 — message SSOT: make the native validation bubble read identically to
      // the zCLI prompt. The browser already knows WHICH rule failed (its
      // ValidityState); we only translate that to our message string.
      this._wireValidationMessages(input, fieldObj, fieldType);

      // Prefix / suffix affixes — wrap in a canonical .zInputGroup so the field
      // reads like the zCLI prompt's [$…] / […@co] group. Pickers / file own
      // their native affordance, so affixes are skipped there. The submitted
      // value is re-joined with the affixes in _handleSubmit so zConv is
      // prefix + value + suffix on BOTH surfaces (SSOT with zCLI).
      const prefix = isPicker || inputType === 'file' ? '' : this._affixText(fieldObj.prefix);
      const suffix = isPicker || inputType === 'file' ? '' : this._affixText(fieldObj.suffix);
      let rendered = input;
      if (prefix || suffix) {
        const group = createElement('div', ['zInputGroup']);
        if (prefix) {
          // Position-specific class (zInputGroup-prefix) lets users restyle the
          // prefix alone — SSOT with the standalone path (input_event_handler.js).
          const pre = createElement('span', ['zInputGroup-text', 'zInputGroup-prefix']);
          pre.textContent = prefix;
          group.appendChild(pre);
        }
        group.appendChild(input);
        if (suffix) {
          // Position-specific class (zInputGroup-suffix) — SSOT with the standalone path.
          const suf = createElement('span', ['zInputGroup-text', 'zInputGroup-suffix']);
          suf.textContent = suffix;
          group.appendChild(suf);
        }
        rendered = group;
      }

      // input (or its affix group) + its datalist must both reach the field
      // group — return a fragment.
      if (datalistEl) {
        const frag = document.createDocumentFragment();
        frag.appendChild(rendered);
        frag.appendChild(datalistEl);
        return frag;
      }
      return rendered;
    }

    return input;
  }

  /**
   * Wire SSOT validation messages onto an input (D2 — message parity).
   *
   * The browser's native bubble normally shows its own wording ("Please match
   * the requested format."). We override it so the message matches the zCLI
   * prompt exactly — the SAME strings field_rules.py returns. Rather than
   * re-running validate_value in JS, we read the native ValidityState (which
   * already says WHICH rule failed) and map each flag to our message. The
   * length / range / step wording mirrors field_rules.validate_value; the
   * format wording mirrors TYPE_PRESETS (preset) or the raw-pattern message.
   * @private
   */
  _wireValidationMessages(input, fieldObj, fieldType) {
    const preset = _TYPE_PRESETS[fieldType];
    const rawPattern = fieldObj.pattern;

    const messageFor = (v) => {
      if (v.tooShort)       return `Must be at least ${input.getAttribute('minlength')} characters`;
      if (v.tooLong)        return `Must be at most ${input.getAttribute('maxlength')} characters`;
      if (v.rangeUnderflow) return `Must be ≥ ${input.getAttribute('min')}`;
      if (v.rangeOverflow)  return `Must be ≤ ${input.getAttribute('max')}`;
      if (v.stepMismatch)   return `Must be in steps of ${input.getAttribute('step')}`;
      if (v.patternMismatch || v.typeMismatch) {
        if (preset && preset.message) return preset.message;
        if (rawPattern != null) return `Must match the required format: ${rawPattern}`;
        return '';  // no SSOT message → fall back to native
      }
      if (v.badInput && fieldType === 'number' && preset) return preset.message;
      return '';  // valueMissing / valid → native default (required gate is separate)
    };

    // Recompute on every check: clear first so native flags re-evaluate, then
    // apply our message if still invalid. Bound to both `input` (proactive, so
    // the bubble is ready before submit) and `invalid` (safety net).
    const sync = () => {
      input.setCustomValidity('');
      if (!input.validity.valid) {
        const msg = messageFor(input.validity);
        if (msg) input.setCustomValidity(msg);
      }
    };
    input.addEventListener('input', sync);
    input.addEventListener('invalid', sync);
  }

  /**
   * Normalize a prefix/suffix value to display text. Mirrors the zCLI
   * _format_affix contract: strings as-is, numbers stringified, nullish → ''.
   * @private
   */
  _affixText(value) {
    if (value == null || value === '') return '';
    return String(value);
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

    // A `type: file` field's FormData value is a raw File object — it has no
    // enumerable own properties, so JSON.stringify(File) is always "{}" and
    // the byte content never reaches the server. Read each selected file as
    // base64 and swap it for a plain, JSON-safe envelope the server-side
    // zos-plugin SDK decodes back into the same raw shape a multipart upload
    // produces (see core/zos_plugin/__init__.py:_decode_zfile_kwargs).
    for (const [key, value] of Object.entries(data)) {
      if (typeof File !== 'undefined' && value instanceof File) {
        if (value.size === 0) { data[key] = null; continue; }
        data[key] = {
          __zFile: true,
          filename: value.name,
          content_type: value.type || 'application/octet-stream',
          data_b64: await _fileToBase64(value),
        };
      }
    }

    // Multi-select (select + multi → checkbox group) submits repeated keys, which
    // the entries loop above collapses to the last one. Re-collect them as a LIST
    // (possibly empty when nothing is checked) so the plugin gets the same list
    // the zCLI multi-picker returns.
    (formContext.fields || []).forEach(f => {
      if (!f || typeof f !== 'object') return;
      if (f.type !== 'select' || !(f.multi === true || f.multi === 'true')) return;
      const key = f.zConv || f.name || f.field;
      data[key] = formData.getAll(key);
    });

    // Affix parity (SSOT): zCLI bakes prefix/suffix into the value (prefix +
    // input + suffix). The browser shows them as cosmetic .zInputGroup chips, so
    // re-join them here so the plugin receives the same zConv string on both
    // surfaces. Matches _terminal_single_line in input_string.py.
    (formContext.fields || []).forEach(f => {
      if (!f || typeof f !== 'object') return;
      if (f.prefix == null && f.suffix == null) return;
      const key = f.zConv || f.name || f.field;
      if (!(key in data)) return;
      const pre = f.prefix != null && f.prefix !== '' ? String(f.prefix) : '';
      const suf = f.suffix != null && f.suffix !== '' ? String(f.suffix) : '';
      data[key] = `${pre}${data[key]}${suf}`;
    });

    // Disabled fields aren't submitted by the browser, but the zCLI input hub
    // returns their declared value into zConv — re-inject the default so both
    // surfaces hand the plugin the same data.
    (formContext.fields || []).forEach(f => {
      if (!f || typeof f !== 'object' || !f.disabled) return;
      const key = f.zConv || f.name || f.field;
      if (key in data) return;
      data[key] = f.default != null ? String(f.default) : '';
    });

    // Unchecked checkboxes submit nothing, but the zCLI picker always returns
    // 'true'/'false'. Re-inject 'false' for a single boolean checkbox whose key
    // is absent so both surfaces hand the plugin the same value. (Multi-select
    // checkbox — author `options:` — is out of scope; zCLI doesn't multi-pick.)
    (formContext.fields || []).forEach(f => {
      if (!f || typeof f !== 'object' || f.type !== 'checkbox') return;
      if (Array.isArray(f.options)) return;
      const key = f.zConv || f.name || f.field;
      if (key in data) return;
      data[key] = 'false';
    });

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
        // Business failure (ZResult.failure / success:false) — an EXPECTED outcome,
        // not a system error. Surface it inline; log at info, never error.
        this._handleFailure(formElement, response);
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
      const navSig = resultSignalFrom(response, { ackOnVoid: true, ackText: 'Done.' });
      this._emitSignal(formElement, navSig.level, navSig.text);
      this._dropFormContext(formElement);
      const routePath = convertZPathToURL(response.navigate);
      this.logger.log('[FormRenderer] Server requested navigation to:', routePath);
      setTimeout(() => {
        if (this.client && typeof this.client._navigateToRoute === 'function') {
          // Login changed the session. The server built the authed, RBAC-filtered
          // navbar on the SAME (authed) ws that handled this submit and shipped it
          // as response.nav_html. Apply it directly (3A path) after navigating.
          // We do NOT re-request connection_info from the client: that can land on
          // a different (guest) ws and rebuild the guest chrome (no ^logout).
          this.client._navigateToRoute(routePath).then(() => {
            if (response.nav_html && typeof this.client._fetchAndPopulateNavBar === 'function') {
              this.client._fetchAndPopulateNavBar(response.nav_html).catch(err => {
                this.logger.error('[FormRenderer] Failed to apply navbar:', err);
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
      const reloadSig = resultSignalFrom(response, { ackOnVoid: true, ackText: 'Done.' });
      this._emitSignal(formElement, reloadSig.level, reloadSig.text);
      this._dropFormContext(formElement);
      this.logger.log('[FormRenderer] Server requested page reload for RBAC sidebar refresh');
      setTimeout(() => { window.location.reload(); }, 800);
      return;
    }

    // Plain success — the form STAYS (like a real website): emit a success
    // signal below the actions and reset fields to their defaults so the user
    // can submit again. The form context is kept for the next submit.
    // Text comes from the result-envelope SSOT (the same decision a zFunc uses);
    // a void return still acknowledges, since a submit is an explicit transaction.
    const sig = resultSignalFrom(response, { ackOnVoid: true, ackText: 'Form submitted successfully.' });
    this._emitSignal(formElement, sig.level, sig.text);
    formElement.reset();

    // Refresh navbar (e.g. RBAC change) without leaving the form.
    if (this.client && typeof this.client._fetchAndPopulateNavBar === 'function') {
      this.client._fetchAndPopulateNavBar().catch(err => {
        this.logger.error('[FormRenderer] Failed to refresh navbar:', err);
      });
    }
  }

  /**
   * Handle a BUSINESS failure — the action returned ZResult.failure / success:false.
   * This is an expected, designed outcome (a rule said no, a name is taken), NOT a
   * system error: log at info and surface it inline, keeping the form + input in place.
   * @private
   * @param {HTMLFormElement} formElement - Form element
   * @param {Object} response - Server failure response (success:false)
   */
  _handleFailure(formElement, response) {
    this.logger.log('[FormRenderer] Form returned a failure result:', response);
    // Decision via the result-envelope SSOT (success:false → error level; error/
    // errors[]/message resolved in one place, shared with zFunc). Inline, no flush.
    const sig = resultSignalFrom(response, { ackOnVoid: true, ackText: 'Validation failed. Please check your input.' });
    this._emitSignal(formElement, sig.level, sig.text);
  }

  /**
   * Handle a TRANSPORT/exception error — the submit itself threw (WS dropped, the
   * plugin crashed). This is a genuine system error: log at error level, then surface
   * it inline, keeping the form (and the user's input) in place.
   * @private
   * @param {HTMLFormElement} formElement - Form element
   * @param {Object} response - Synthesized error response
   */
  _handleError(formElement, response) {
    this.logger.error('[FormRenderer] Form submission failed:', response);
    const sig = resultSignalFrom(response, { ackOnVoid: true, ackText: 'Validation failed. Please check your input.' });
    this._emitSignal(formElement, sig.level, sig.text);
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
