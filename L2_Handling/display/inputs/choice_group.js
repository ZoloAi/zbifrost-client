/**
 * choice_group.js — canonical option-group renderer (SSOT).
 *
 * ONE source of truth for radio / multi-select groups across BOTH choice paths:
 *   - standalone control  → input_event_handler.handleSelection (zSelect)
 *   - zDialog form field   → form_renderer (_createCheckGroup)
 *
 * Canonical rule: `multi` ALWAYS renders as a CHECKBOX GROUP (never a native
 * <select multiple> listbox), so a multi choice looks identical whether it's a
 * standalone zSelect or a field inside a zDialog. Emits only zbase-owned markup
 * (.zForm-check-group / .zForm-check / .zForm-check-input / .zForm-check-label) —
 * NO zc- classes; styling is owned by Bifrost's zbase.css.
 *
 * Option strings may carry inline flags: "Label [default]" / "Label [disabled]".
 * Labels render verbatim (no forced capitalisation) so values like `zOS` stay `zOS`.
 */

import { createElement } from '../../../zSys/dom/dom_utils.js';
import { createInput, createLabel } from '../primitives/form_primitives.js';

/**
 * Append a red required marker (*) to a label/legend when required.
 * SSOT — styled by .zRequired in zbase.css. aria-hidden since the input's own
 * `required` attribute already exposes the constraint to assistive tech.
 */
export function appendRequiredMark(labelEl, required) {
  if (!required || !labelEl) return;
  const star = document.createElement('span');
  star.className = 'zRequired';
  star.textContent = ' *';
  star.setAttribute('aria-hidden', 'true');
  labelEl.appendChild(star);
}

/**
 * Parse an option string for inline flags: "Label [default]" / "Label [disabled]".
 * @param {string} optionString
 * @returns {{cleanLabel:string, isDisabled:boolean, isDefault:boolean}}
 */
export function parseOptionFlags(optionString) {
  let cleanLabel = String(optionString).trim();
  let isDisabled = false;
  let isDefault = false;

  const disabledMatch = cleanLabel.match(/^(.*?)\s*\[disabled\]\s*$/i);
  if (disabledMatch) {
    cleanLabel = disabledMatch[1].trim();
    isDisabled = true;
  }
  const defaultMatch = cleanLabel.match(/^(.*?)\s*\[default\]\s*$/i);
  if (defaultMatch) {
    cleanLabel = defaultMatch[1].trim();
    isDefault = true;
  }
  return { cleanLabel, isDisabled, isDefault };
}

/** Normalise a raw option (string with flags, or {label,value,disabled,default}). */
function normaliseOption(raw) {
  if (typeof raw === 'string') {
    const p = parseOptionFlags(raw);
    return { label: p.cleanLabel, value: p.cleanLabel, disabled: p.isDisabled, isDefault: p.isDefault };
  }
  return {
    label: raw.label || raw.value || '',
    value: raw.value || raw.label || '',
    disabled: !!raw.disabled,
    isDefault: !!raw.default
  };
}

/**
 * Build a canonical .zForm-check-group of radio buttons or checkboxes.
 *
 * @param {Object}   spec
 * @param {string}   spec.name          - input name (group identity / zConv key)
 * @param {Array}    spec.options       - strings (with optional [default]/[disabled]) or {label,value,disabled,default}
 * @param {string}   [spec.inputType]   - 'radio' | 'checkbox' (default 'checkbox')
 * @param {*}        [spec.defaultValue]- scalar or array; matching options start checked
 * @param {boolean}  [spec.required]    - marks the group required (first input carries the attr)
 * @param {boolean}  [spec.disabled]    - group-level disable (per-option [disabled] also honoured)
 * @param {string}   [spec.prompt]      - heading text (already formatted by caller); null = no heading
 * @param {string}   [spec.groupClass]  - extra classes appended to the group container
 * @returns {HTMLElement} the .zForm-check-group element
 */
export function createChoiceGroup({
  name,
  options = [],
  inputType = 'checkbox',
  defaultValue = null,
  required = false,
  disabled = false,
  prompt = null,
  groupClass = ''
} = {}) {
  const group = createElement('div', ['zForm-check-group', 'zmb-3']);
  if (groupClass) {
    String(groupClass).split(/\s+/).filter(Boolean).forEach(c => group.classList.add(c));
  }

  if (prompt) {
    const heading = createElement('div', ['zLabel']);
    heading.textContent = prompt;
    appendRequiredMark(heading, required);
    group.appendChild(heading);
  }

  const defaults = Array.isArray(defaultValue)
    ? defaultValue.map(String)
    : (defaultValue != null ? [String(defaultValue)] : []);

  options.forEach((raw, index) => {
    const opt = normaliseOption(raw);
    const rowDisabled = disabled || opt.disabled;

    const row = createElement(
      'div',
      rowDisabled ? ['zForm-check', 'zForm-check-disabled', 'zmb-2'] : ['zForm-check', 'zmb-2']
    );

    const optId = `${name}_${index}`;
    const control = createInput(inputType, {
      id: optId,
      name,
      value: opt.value,
      disabled: rowDisabled,
      required: required && index === 0,
      class: 'zForm-check-input'
    });
    if (opt.isDefault
        || defaults.includes(String(opt.value))
        || defaults.includes(String(opt.label))) {
      control.checked = true;
    }

    const label = createLabel(optId, { class: 'zForm-check-label' });
    label.textContent = opt.label;

    row.appendChild(control);
    row.appendChild(label);
    group.appendChild(row);
  });

  return group;
}

export default { createChoiceGroup, parseOptionFlags, appendRequiredMark };
