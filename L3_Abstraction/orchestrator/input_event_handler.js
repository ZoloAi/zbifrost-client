/**
 * L3_Abstraction/orchestrator/input_event_handler.js
 * 
 * Input Event Handler - Input Request Rendering
 * 
 * Handles complex input request events:
 * - read_string / read_password: Text/password inputs with validation
 * - read_bool: Boolean checkboxes with conditional rendering
 * - selection: Dropdown/radio/checkbox selection controls
 * 
 * Extracted from zdisplay_orchestrator.js (Phase 9, Task 2.7)
 * 
 * @module orchestrator/input_event_handler
 * @layer L3 (Abstraction)
 */

import { TYPOGRAPHY } from '../../L1_Foundation/constants/bifrost_constants.js';
import { convertStyleToString } from '../../zSys/dom/style_utils.js';
import { createChoiceGroup } from '../../L2_Handling/display/inputs/choice_group.js';

/**
 * Append a red required marker (*) to a label/legend when the field is required.
 * SSOT — styled by .zRequired in zbase.css. aria-hidden since `required` already
 * exposes the constraint to assistive tech via the input element.
 */
function appendRequiredMark(labelEl, required) {
  if (!required || !labelEl) return;
  const star = document.createElement('span');
  star.className = 'zRequired';
  star.textContent = ' *';
  star.setAttribute('aria-hidden', 'true');
  labelEl.appendChild(star);
}

export class InputEventHandler {
  constructor(client, logger) {
    this.client = client;
    this.logger = logger;
  }

  /**
   * Handle read_string and read_password events
   * @param {string} event - Event type ('read_string' or 'read_password')
   * @param {Object} eventData - Event data
   * @param {HTMLElement} parentElement - Parent element for context detection
   * @returns {HTMLElement} - Input element or wrapper
   */
  async handleTextInput(event, eventData, parentElement) {
    const { createLabel, createInput, createTextarea } = await import('../../L2_Handling/display/primitives/form_primitives.js');
    
    const inputType = event === 'read_password' ? 'password' : (eventData.type || 'text');
    const prompt = eventData.prompt || '';
    const placeholder = eventData.placeholder || '';
    const required = eventData.required || false;
    const defaultValue = eventData.default || '';
    const disabled = eventData.disabled || false;
    const readonly = eventData.readonly || false;
    const multiple = eventData.multiple || false;
    const title = eventData.title || '';
    const datalist = eventData.datalist || null;
    
    // Conditional rendering support (if parameter from zWizard)
    const condition = eventData.if || null;
    if (condition) {
      this.logger.log(`[InputEventHandler] Found 'if' condition in read_string event: "${condition}"`);
    }
    
    // Support zId (universal), _zId (Bifrost-only), and _id (legacy)
    const inputId = eventData.zId || eventData._zId || eventData._id || `input_${Math.random().toString(36).substr(2, 9)}`;
    
    // Generate datalist ID if datalist exists
    const datalistId = datalist ? `${inputId}_datalist` : null;
    
    // Support aria-describedby for accessibility (link to help text)
    const ariaDescribedBy = eventData.aria_described_by || eventData.ariaDescribedBy || eventData['aria-describedby'];
    
    // Detect if we're inside a zInputGroup context (parent or ancestor has zInputGroup class)
    let isInsideInputGroup = false;
    let checkParent = parentElement;
    while (checkParent && checkParent !== document.body) {
      if (checkParent.classList && checkParent.classList.contains('zInputGroup')) {
        isInsideInputGroup = true;
        break;
      }
      checkParent = checkParent.parentElement;
    }
    
    // Create wrapper div only if prompt exists AND not inside input group
    // Otherwise return input directly to avoid double-nesting in grid layouts or input groups
    let wrapper = null;
    let wrapperClasses = null; // Track _zClass for wrapper (not input element)
    
    // Create label if prompt exists (connected to input via for/id)
    if (prompt && !isInsideInputGroup) {
      wrapper = document.createElement('div');
      
      // Apply _zClass to wrapper (not input element) to avoid double-nesting
      // When wrapper exists, _zClass applies to the wrapper container
      if (eventData._zClass) {
        const classes = eventData._zClass.split(' ').filter(c => c.trim());
        wrapper.classList.add(...classes);
        wrapperClasses = eventData._zClass;
        this.logger.log(`[InputEventHandler] Applied _zClass to wrapper: ${eventData._zClass}`);
      }
      
      // SSOT — every prompt label is a .zLabel (styled by zbase.css), regardless
      // of _zClass. No magic-string branch → consistent label across all fields.
      const label = createLabel(inputId, { class: 'zLabel' });
      label.textContent = prompt;
      appendRequiredMark(label, required);
      wrapper.appendChild(label);
      // Add line break after label (semantic HTML pattern)
      wrapper.appendChild(document.createElement('br'));
    }
    
    // Check if we'll have prefix/suffix (which creates zInputGroup)
    // Helper to format prefix/suffix values (defined early for class determination)
    const formatAffix = (value) => {
      if (!value && value !== 0) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'boolean') return String(value);
      if (typeof value === 'number') {
        if (value >= 0 && value < 1) {
          return value.toFixed(2).replace(/^0/, '') || '0';
        }
        return String(value);
      }
      return String(value);
    };
    
    const prefix = formatAffix(eventData.prefix);
    const suffix = formatAffix(eventData.suffix);
    const hasInputGroup = !!(prefix || suffix);
    
    // Build input classes: 
    // - If inside zInputGroup, use 'zInput' (required by CSS: .zInputGroup > .zInput)
    // - If wrapper exists, use default 'zForm-control' (wrapper has _zClass)
    // - Otherwise use _zClass or default 'zForm-control'
    let inputClasses;
    if (isInsideInputGroup) {
      // If inside zInputGroup, use 'zInput' class (required by CSS: .zInputGroup > .zInput)
      inputClasses = 'zInput';
    } else if (hasInputGroup) {
      // Input groups require 'zInput' class for proper flex styling
      inputClasses = 'zInput';
    } else if (wrapperClasses) {
      // Wrapper has _zClass, input gets default styling
      inputClasses = 'zForm-control';
    } else {
      // No wrapper, use _zClass if provided, otherwise default
      inputClasses = eventData._zClass || 'zForm-control';
    }
    
    // Handle textarea vs input
    let inputElement;
    if (inputType === 'textarea') {
      // Multi-line textarea
      const rows = eventData.rows || 3;
      const textareaAttrs = {
        id: inputId,
        placeholder: placeholder,
        required: required,
        rows: rows,
        class: inputClasses
      };
      
      if (ariaDescribedBy) {
        textareaAttrs['aria-describedby'] = ariaDescribedBy;
      }
      
      if (disabled) {
        textareaAttrs.disabled = true;
      }
      
      if (readonly) {
        textareaAttrs.readonly = true;
      }
      
      if (title) {
        textareaAttrs.title = title;
      }
      
      inputElement = createTextarea(textareaAttrs);
      inputElement.textContent = defaultValue; // Use textContent for textarea, not value
    } else {
      // Single-line input
      const inputAttrs = {
        id: inputId,
        placeholder: placeholder,
        required: required,
        value: defaultValue,
        class: inputClasses
      };
      
      // Add list attribute if datalist exists
      if (datalistId) {
        inputAttrs.list = datalistId;
      }
      
      if (ariaDescribedBy) {
        inputAttrs['aria-describedby'] = ariaDescribedBy;
      }
      
      if (disabled) {
        inputAttrs.disabled = true;
      }
      
      if (readonly) {
        inputAttrs.readonly = true;
      }
      
      if (multiple) {
        inputAttrs.multiple = true;
      }
      
      if (title) {
        inputAttrs.title = title;
      }

      // Field name (needed for multipart field + stable selectors) and file accept filter.
      if (eventData.name) {
        inputAttrs.name = eventData.name;
      }
      if (inputType === 'file' && eventData.accept) {
        inputAttrs.accept = eventData.accept;
      }

      inputElement = createInput(inputType, inputAttrs);
    }
    
    // Handle input groups (prefix/suffix pattern) - Terminal-first design
    // Note: prefix and suffix were already determined above for class selection
    if (hasInputGroup) {
      // Create .zInputGroup wrapper for prefix/suffix pattern
      const inputGroup = document.createElement('div');
      inputGroup.classList.add('zInputGroup');
      
      // Add prefix text before input
      // Position-specific class (zInputGroup-prefix) lets users restyle the prefix
      // alone (color/font) without touching the input or the suffix.
      if (prefix) {
        const prefixSpan = document.createElement('span');
        prefixSpan.classList.add('zInputGroup-text', 'zInputGroup-prefix');
        prefixSpan.textContent = prefix;
        inputGroup.appendChild(prefixSpan);
      }
      
      // Add input element
      inputGroup.appendChild(inputElement);
      
      // Add suffix text after input
      // Position-specific class (zInputGroup-suffix) lets users restyle the suffix
      // alone (color/font) without touching the input or the prefix.
      if (suffix) {
        const suffixSpan = document.createElement('span');
        suffixSpan.classList.add('zInputGroup-text', 'zInputGroup-suffix');
        suffixSpan.textContent = suffix;
        inputGroup.appendChild(suffixSpan);
      }
      
      // Replace inputElement with the input group
      inputElement = inputGroup;
      
      this.logger.log(`[InputEventHandler] Created input group with prefix='${prefix}', suffix='${suffix}'`);
    }
    
    // If wrapper exists (has prompt), append input to wrapper and return wrapper
    // Otherwise return input/textarea directly to avoid double-nesting in grid layouts
    let element;
    if (wrapper) {
      wrapper.appendChild(inputElement);
      
      // Add datalist element if datalist exists
      if (datalist && Array.isArray(datalist)) {
        const datalistElement = document.createElement('datalist');
        datalistElement.id = datalistId;
        
        datalist.forEach(optionValue => {
          const option = document.createElement('option');
          option.value = optionValue;
          datalistElement.appendChild(option);
        });
        
        wrapper.appendChild(datalistElement);
      }
      
      // Apply _zStyle to wrapper if present (when wrapper exists, styles go on wrapper)
      if (eventData._zStyle) {
        const cssString = convertStyleToString(eventData._zStyle, this.logger);
        if (cssString) {
          wrapper.setAttribute('style', cssString);
        }
      }
      
      // Handle conditional rendering (if parameter from zWizard)
      if (condition) {
        wrapper.setAttribute('data-zif', condition);
        wrapper.style.display = 'none'; // Initially hidden
        this.logger.log(`[InputEventHandler] Input with condition: ${condition} (initially hidden)`);
      }
      
      element = wrapper;
    } else {
      // When returning input/textarea directly, apply _zStyle if present
      // This allows inline styles for grid layout adjustments (e.g., padding-top)
      if (eventData._zStyle) {
        const cssString = convertStyleToString(eventData._zStyle, this.logger);
        if (cssString) {
          inputElement.setAttribute('style', cssString);
        }
      }
      
      // If datalist exists but no wrapper, create minimal wrapper for datalist
      if (datalist && Array.isArray(datalist)) {
        const container = document.createElement('div');
        container.appendChild(inputElement);
        
        const datalistElement = document.createElement('datalist');
        datalistElement.id = datalistId;
        
        datalist.forEach(optionValue => {
          const option = document.createElement('option');
          option.value = optionValue;
          datalistElement.appendChild(option);
        });
        
        container.appendChild(datalistElement);
        
        // Handle conditional rendering
        if (condition) {
          container.setAttribute('data-zif', condition);
          container.style.display = 'none'; // Initially hidden
          this.logger.log(`[InputEventHandler] Input with condition: ${condition} (initially hidden)`);
        }
        
        element = container;
      } else {
        // Handle conditional rendering for bare input
        if (condition) {
          inputElement.setAttribute('data-zif', condition);
          inputElement.style.display = 'none'; // Initially hidden
          this.logger.log(`[InputEventHandler] Input with condition: ${condition} (initially hidden)`);
        }
        
        element = inputElement;
      }
    }
    
    // Declarative zAPI upload: a file input whose block carried onChange.zAPI is
    // stamped server-side with zapi_url/zapi_method. Bind change → multipart POST
    // → swap the nearest avatar img. (No zFunc ever reaches the client.)
    if (inputType === 'file' && eventData.zapi_url) {
      const fileInput = (element.tagName === 'INPUT' && element.type === 'file')
        ? element
        : element.querySelector('input[type=file]');
      if (fileInput) {
        this._bindZapiUpload(fileInput, eventData);
      }
    }

    this.logger.log(`[InputEventHandler] Rendered ${event} ${inputType} (id=${inputId}, aria-describedby=${ariaDescribedBy || 'none'}, condition=${condition || 'none'})`);
    return element;
  }

  /**
   * Bind a declarative zAPI file upload to a file input.
   * On change: POST the selected file as multipart to the server-stamped endpoint,
   * then on a {ok, data.url} envelope swap the nearest avatar image.
   * @param {HTMLInputElement} fileInput
   * @param {Object} eventData - carries zapi_url, zapi_method, zapi_field/name
   */
  _bindZapiUpload(fileInput, eventData) {
    const url = eventData.zapi_url;
    const method = (eventData.zapi_method || 'POST').toUpperCase();
    const field = eventData.zapi_field || eventData.name || 'file';

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      const form = new FormData();
      form.append(field, file, file.name);

      try {
        this.logger.log(`[InputEventHandler] zAPI upload → ${method} ${url} (${file.name}, ${file.size}B)`);
        const resp = await fetch(url, { method, body: form, credentials: 'same-origin' });
        let json = null;
        try { json = await resp.json(); } catch (_) { /* non-JSON */ }

        if (resp.ok && json && json.ok && json.data && json.data.url) {
          this._swapAvatar(fileInput, json.data.url);
          this.logger.log(`[InputEventHandler] zAPI upload ok → ${json.data.url}`);
        } else {
          const err = (json && json.error) || `HTTP ${resp.status}`;
          this.logger.error(`[InputEventHandler] zAPI upload failed: ${err}`);
        }
      } catch (e) {
        this.logger.error(`[InputEventHandler] zAPI upload error: ${e}`);
      }
    });
  }

  /**
   * Swap the nearest avatar image to the freshly uploaded URL.
   * Prefers an `img.acct-avatar` in the input's ancestry, then falls back globally.
   * @param {HTMLInputElement} fileInput
   * @param {string} url - already cache-busted server-side (?v=...)
   */
  _swapAvatar(fileInput, url) {
    let img = null;
    let anc = fileInput.parentElement;
    while (anc && anc !== document.body) {
      const candidate = anc.querySelector('img.acct-avatar');
      if (candidate) { img = candidate; break; }
      anc = anc.parentElement;
    }
    if (!img) img = document.querySelector('img.acct-avatar');
    if (img) img.src = url;
  }

  /**
   * Handle read_bool event (checkbox)
   * @param {string} event - Event type ('read_bool')
   * @param {Object} eventData - Event data
   * @param {HTMLElement} parentElement - Parent element for context detection
   * @returns {HTMLElement} - Checkbox element or wrapper
   */
  async handleBoolInput(event, eventData, parentElement) {
    const { createDiv } = await import('../../L2_Handling/display/primitives/generic_containers.js');
    const { createLabel, createInput } = await import('../../L2_Handling/display/primitives/form_primitives.js');
    
    const prompt = eventData.prompt || eventData.label || '';
    const checked = eventData.checked || false;
    const required = eventData.required || false;
    const disabled = eventData.disabled || false;
    
    // Build checkbox classes from _zClass (defaults to zForm-check-input)
    const checkboxClasses = eventData._zClass || 'zForm-check-input';
    
    // Support zId (universal), _zId (Bifrost-only), and _id (legacy)
    const checkboxId = eventData.zId || eventData._zId || eventData._id || `checkbox_${Math.random().toString(36).substr(2, 9)}`;
    
    // Detect if we're inside a zInputGroup context (parent has zInputGroup-text class)
    const isInsideInputGroup = parentElement && parentElement.classList && parentElement.classList.contains('zInputGroup-text');
    
    // Create checkbox input (type='checkbox')
    const checkbox = createInput('checkbox', {
      checked: checked,
      required: required,
      disabled: disabled,
      class: checkboxClasses,
      id: checkboxId
    });
    
    // Store zCross flag on checkbox element (defaults to false if not set)
    // zCross: true = terminal-first behavior (conditional rendering)
    // zCross: false = HTML-like behavior (always visible)
    const zCross = eventData.zCross !== undefined ? eventData.zCross : false;
    checkbox.setAttribute('data-zcross', zCross.toString());
    
    let element;
    // If inside input group, render checkbox directly without wrapper
    if (isInsideInputGroup) {
      element = checkbox;
      this.logger.log(`[InputEventHandler] Rendered ${event} checkbox (input-group mode, no wrapper): (id=${checkboxId}, checked=${checked})`);
    } else {
      // Normal mode: Create form check container (Bootstrap-style checkbox)
      const formCheck = createDiv({ class: disabled ? 'zForm-check zForm-check-disabled zmb-2' : 'zForm-check zmb-2' });
      
      // Create label for checkbox (wraps around or uses 'for' attribute)
      if (prompt) {
        const label = createLabel(checkboxId, { class: 'zForm-check-label' });
        label.textContent = prompt;
        
        // Add checkbox first, then label (Bootstrap convention)
        formCheck.appendChild(checkbox);
        formCheck.appendChild(label);
      } else {
        // No label, just the checkbox
        formCheck.appendChild(checkbox);
      }
      
      element = formCheck;
      this.logger.log(`[InputEventHandler] Rendered ${event} checkbox: ${prompt} (id=${checkboxId}, checked=${checked})`);
    }
    
    return element;
  }

  /**
   * Handle selection event (dropdown, radio, checkbox)
   * @param {string} event - Event type ('selection')
   * @param {Object} eventData - Event data
   * @param {HTMLElement} parentElement - Parent element for context detection
   * @returns {HTMLElement} - Selection element or wrapper
   */
  /**
   * Parse option string for inline modifiers like [disabled] or [default]
   * @private
   */
  _parseOptionString(optionString) {
    let cleanLabel = optionString;
    let isDisabled = false;
    let isDefault = false;
    
    // Check for [disabled] suffix
    const disabledMatch = optionString.match(/^(.*?)\s*\[disabled\]\s*$/i);
    if (disabledMatch) {
      cleanLabel = disabledMatch[1].trim();
      isDisabled = true;
    }
    
    // Check for [default] suffix
    const defaultMatch = cleanLabel.match(/^(.*?)\s*\[default\]\s*$/i);
    if (defaultMatch) {
      cleanLabel = defaultMatch[1].trim();
      isDefault = true;
    }
    
    return { cleanLabel, isDisabled, isDefault };
  }

  async handleSelection(event, eventData, parentElement) {
    const { createLabel, createInput } = await import('../../L2_Handling/display/primitives/form_primitives.js');
    
    const prompt = eventData.prompt || '';
    const options = eventData.options || [];
    const multi = eventData.multi || false;
    let defaultValue = eventData.default || null;
    const disabled = eventData.disabled || false;
    const required = eventData.required || false;
    // `type` (interactive WS path) or `widget_type` (declarative — the zSelect
    // expander renames type→widget_type). Accept both; default to dropdown.
    const type = eventData.type || eventData.widget_type || 'dropdown';
    
    // Auto-detect default from [default] suffix if no explicit default provided
    if (defaultValue === null && options.length > 0) {
      for (const opt of options) {
        if (typeof opt === 'string') {
          const parsed = this._parseOptionString(opt);
          if (parsed.isDefault) {
            defaultValue = parsed.cleanLabel;
            break;
          }
        }
      }
    }
    
    // Build classes from _zClass
    const elementClasses = eventData._zClass || '';
    
    // Support zId (universal), _zId (Bifrost-only), and _id (legacy)
    const baseId = eventData.zId || eventData._zId || eventData._id || `select_${Math.random().toString(36).substr(2, 9)}`;
    
    // Support aria-label for accessibility
    const ariaLabel = eventData['_aria-label'] || eventData.ariaLabel || eventData['aria-label'];
    
    // Detect if we're inside a zInputGroup context (for compact rendering)
    const isInsideInputGroup = parentElement && parentElement.classList && parentElement.classList.contains('zInputGroup-text');
    
    let element;
    // Render based on type. `multi` ALWAYS renders as a checkbox group (never a
    // native <select multiple> listbox) — SSOT with zDialog fields via choice_group.
    if (type === 'radio' || multi) {
      // Radio button group or checkbox group
      const inputType = type === 'radio' ? 'radio' : 'checkbox';
      const groupName = baseId; // Use baseId as group name for radio buttons
      
      // CHUNK MODE: When inside zInputGroup-text, render raw radios without labels/wrappers
      if (isInsideInputGroup) {
        // Just render the first radio input directly (for single-option-per-group pattern)
        // Or all radios stacked if multiple options
        const firstOptionValue = options[0];
        const optionVal = typeof firstOptionValue === 'string' ? firstOptionValue : (firstOptionValue.value || firstOptionValue.label || '');
        
        const input = createInput(inputType, {
          id: `${baseId}_0`,
          name: groupName,
          value: optionVal,
          disabled: disabled,
          required: required,
          class: elementClasses || 'zForm-check-input'
        });
        
        // Set checked state
        if (defaultValue !== null && (optionVal === defaultValue || (Array.isArray(defaultValue) && defaultValue.includes(optionVal)))) {
          input.checked = true;
        }
        
        element = input;
        this.logger.log(`[InputEventHandler] Rendered ${event} ${inputType} (input-group mode, no wrapper): (id=${baseId}, value=${optionVal})`);
      } else {
        // NORMAL MODE — canonical option group (SSOT: choice_group.createChoiceGroup),
        // shared verbatim with zDialog form fields. Option strings still carry
        // [default]/[disabled] flags; defaults may be a scalar or a list (multi).
        const container = createChoiceGroup({
          name: groupName,
          options,
          inputType,
          defaultValue,
          required,
          disabled,
          prompt: prompt || null,
          groupClass: elementClasses
        });
        if (eventData._zStyle) {
          const cssString = convertStyleToString(eventData._zStyle, this.logger);
          if (cssString) {
            container.setAttribute('style', cssString);
          }
        }
        element = container;
        this.logger.log(`[InputEventHandler] Rendered ${event} ${inputType} group (id=${baseId}, options=${options.length}) [choice_group SSOT]`);
      }
    } else {
      // Dropdown select (default behavior)
      let wrapper = null;
      
      // Create label if prompt exists
      if (prompt) {
        wrapper = document.createElement('div');
        // Use zLabel class for styled selects
        const labelClass = elementClasses.includes('zSelect') ? 'zLabel' : '';
        const labelAttrs = labelClass ? { class: labelClass } : {};
        const label = createLabel(baseId, labelAttrs);
        label.textContent = prompt;
        appendRequiredMark(label, required);
        wrapper.appendChild(label);
        // Add line break after label (semantic HTML pattern)
        wrapper.appendChild(document.createElement('br'));
      }
      
      // Create select element
      const selectElement = document.createElement('select');
      selectElement.id = baseId;
      
      // Always carry the canonical .zSelect base so every dropdown / multi-select
      // gets themed — even when _zClass overrides it (merge + de-dupe).
      const selectClassList = elementClasses ? elementClasses.split(/\s+/).filter(Boolean) : [];
      if (!selectClassList.includes('zSelect')) selectClassList.unshift('zSelect');
      selectElement.className = selectClassList.join(' ');
      
      if (disabled) {
        selectElement.disabled = true;
      }
      
      if (required) {
        selectElement.required = true;
      }

      // NOTE: `multi` never reaches this dropdown branch — it is routed to the
      // canonical checkbox group above (choice_group SSOT), so no <select multiple>
      // listbox is ever produced.

      // Support size attribute (number of visible options)
      const size = eventData.size || null;
      if (size !== null) {
        selectElement.size = size;
      }
      
      if (ariaLabel) {
        selectElement.setAttribute('aria-label', ariaLabel);
      }
      
      // Add autocomplete="off" to prevent browser from remembering selections
      selectElement.setAttribute('autocomplete', 'off');
      
      // Apply inline styles if no wrapper (to avoid nesting issues)
      if (!wrapper && eventData._zStyle) {
        const cssString = convertStyleToString(eventData._zStyle, this.logger);
        if (cssString) {
          selectElement.setAttribute('style', cssString);
        }
      }
      
      // Create option elements
      options.forEach((optionValue, index) => {
        const optionElement = document.createElement('option');
        
        // Parse option string for modifiers or extract from object
        let optionLabel, optionVal, optionDisabled;
        if (typeof optionValue === 'string') {
          const parsed = this._parseOptionString(optionValue);
          optionLabel = parsed.cleanLabel;
          optionVal = parsed.cleanLabel;
          optionDisabled = parsed.isDisabled;
        } else {
          optionLabel = optionValue.label || optionValue.value || '';
          optionVal = optionValue.value || optionValue.label || '';
          optionDisabled = optionValue.disabled || false;
        }
        
        optionElement.textContent = optionLabel;
        optionElement.value = optionVal;
        
        // Set disabled state (per-option)
        if (optionDisabled) {
          optionElement.disabled = true;
        }
        
        // Set selected state based on default value
        if (defaultValue !== null) {
          if (multi && Array.isArray(defaultValue)) {
            // Multi-select: check if option is in default array
            if (defaultValue.includes(optionVal)) {
              optionElement.selected = true;
            }
          } else {
            // Single-select: check if option matches default
            if (optionVal === defaultValue || optionLabel === defaultValue) {
              optionElement.selected = true;
            }
          }
        }
        
        selectElement.appendChild(optionElement);
      });
      
      // Assemble final element
      if (wrapper) {
        wrapper.appendChild(selectElement);
        // Apply wrapper styles if specified
        if (eventData._zStyle) {
          const cssString = convertStyleToString(eventData._zStyle, this.logger);
          if (cssString) {
            wrapper.setAttribute('style', cssString);
          }
        }
        element = wrapper;
      } else {
        element = selectElement;
      }
      
      this.logger.log(`[InputEventHandler] Rendered ${event} select (id=${baseId}, options=${options.length}, multi=${multi})`);
    }
    
    return element;
  }
}
