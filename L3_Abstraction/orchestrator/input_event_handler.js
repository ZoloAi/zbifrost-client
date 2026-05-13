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
      
      // Use zLabel class for styled inputs, no class for basic semantic HTML
      // Check if wrapper has zInput class (from _zClass) to determine label styling
      const hasZInputClass = wrapperClasses && wrapperClasses.includes('zInput');
      const labelClass = hasZInputClass ? 'zLabel' : '';
      const labelAttrs = labelClass ? { class: labelClass } : {};
      const label = createLabel(inputId, labelAttrs);
      label.textContent = prompt;
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
      
      inputElement = createInput(inputType, inputAttrs);
    }
    
    // Handle input groups (prefix/suffix pattern) - Terminal-first design
    // Note: prefix and suffix were already determined above for class selection
    if (hasInputGroup) {
      // Create .zInputGroup wrapper for prefix/suffix pattern
      const inputGroup = document.createElement('div');
      inputGroup.classList.add('zInputGroup');
      
      // Add prefix text before input
      if (prefix) {
        const prefixSpan = document.createElement('span');
        prefixSpan.classList.add('zInputGroup-text');
        prefixSpan.textContent = prefix;
        inputGroup.appendChild(prefixSpan);
      }
      
      // Add input element
      inputGroup.appendChild(inputElement);
      
      // Add suffix text after input
      if (suffix) {
        const suffixSpan = document.createElement('span');
        suffixSpan.classList.add('zInputGroup-text');
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
    
    this.logger.log(`[InputEventHandler] Rendered ${event} ${inputType} (id=${inputId}, aria-describedby=${ariaDescribedBy || 'none'}, condition=${condition || 'none'})`);
    return element;
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
      const formCheck = createDiv({ class: 'zForm-check zmb-2' });
      
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
    const type = eventData.type || 'dropdown'; // Default to dropdown
    
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
    // Render based on type
    if (type === 'radio' || (type === 'checkbox' && multi)) {
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
          class: elementClasses || 'zCheck-input'
        });
        
        // Set checked state
        if (defaultValue !== null && (optionVal === defaultValue || (Array.isArray(defaultValue) && defaultValue.includes(optionVal)))) {
          input.checked = true;
        }
        
        element = input;
        this.logger.log(`[InputEventHandler] Rendered ${event} ${inputType} (input-group mode, no wrapper): (id=${baseId}, value=${optionVal})`);
      } else {
        // NORMAL MODE: Standard radio/checkbox group with labels
        // Create container
        const container = document.createElement('div');
        if (elementClasses) {
          container.className = elementClasses;
        }
        if (eventData._zStyle) {
          const cssString = convertStyleToString(eventData._zStyle, this.logger);
          if (cssString) {
            container.setAttribute('style', cssString);
          }
        }
        
        // Create prompt label if exists (fieldset legend style)
        if (prompt) {
          const promptLabel = document.createElement('div');
          promptLabel.textContent = prompt;
          promptLabel.style.marginBottom = '0.5rem';
          promptLabel.style.fontWeight = TYPOGRAPHY.FONT_WEIGHTS.MEDIUM;
          container.appendChild(promptLabel);
        }
        
        // Create radio/checkbox inputs for each option
        options.forEach((optionValue, index) => {
          const optionId = `${baseId}_${index}`;
          
          // Parse option string for modifiers or extract from object
          let optionLabel, optionVal, optionDisabled, optionIsDefault;
          if (typeof optionValue === 'string') {
            const parsed = this._parseOptionString(optionValue);
            optionLabel = parsed.cleanLabel;
            optionVal = parsed.cleanLabel;
            optionDisabled = parsed.isDisabled;
            optionIsDefault = parsed.isDefault;
          } else {
            optionLabel = optionValue.label || optionValue.value || '';
            optionVal = optionValue.value || optionValue.label || '';
            optionDisabled = optionValue.disabled || false;
            optionIsDefault = false;
          }
          
          // Create wrapper div for input + label
          const optionWrapper = document.createElement('div');
          optionWrapper.style.marginBottom = '0.5rem';
          
          // Create input with per-option disabled state
          const input = createInput(inputType, {
            id: optionId,
            name: groupName,
            value: optionVal,
            disabled: disabled || optionDisabled, // Component-level OR per-option disabled
            required: required && index === 0 // Only first input has required
          });
          
          // Set checked state based on default value
          if (defaultValue !== null) {
            if (multi && Array.isArray(defaultValue)) {
              // Multi-select (checkbox): check if option is in default array
              if (defaultValue.includes(optionVal) || defaultValue.includes(optionLabel)) {
                input.checked = true;
              }
            } else {
              // Single-select (radio): check if option matches default
              if (optionVal === defaultValue || optionLabel === defaultValue) {
                input.checked = true;
              }
            }
          }
          
          // Create label
          const label = createLabel(optionId, {});
          label.textContent = optionLabel;
          label.style.marginLeft = '0.5rem';
          
          // Assemble option
          optionWrapper.appendChild(input);
          optionWrapper.appendChild(label);
          container.appendChild(optionWrapper);
        });
        
        element = container;
        this.logger.log(`[InputEventHandler] Rendered ${event} ${inputType} group (id=${baseId}, options=${options.length})`);
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
        wrapper.appendChild(label);
        // Add line break after label (semantic HTML pattern)
        wrapper.appendChild(document.createElement('br'));
      }
      
      // Create select element
      const selectElement = document.createElement('select');
      selectElement.id = baseId;
      
      if (elementClasses) {
        selectElement.className = elementClasses;
      }
      
      if (disabled) {
        selectElement.disabled = true;
      }
      
      if (required) {
        selectElement.required = true;
      }
      
      if (multi) {
        selectElement.multiple = true;
      }
      
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
