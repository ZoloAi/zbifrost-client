/**
 * L3_Abstraction/orchestrator/group_renderer.js
 * 
 * Grouped Rendering for _zGroup Metadata
 * 
 * Handles grouped rendering contexts where multiple items are rendered
 * into a single container with group-specific styling:
 * - input-group: Radio buttons with conditional inputs, checkboxes
 * - list-group: Lists with interactive items
 * 
 * Includes complex logic for:
 * - Radio zSelect splitting (each option gets its own zInputGroup)
 * - Conditional input matching (if conditions paired with radio options)
 * - Position-based and condition-based pairing
 * - Group-specific styling application
 * 
 * Extracted from zdisplay_orchestrator.js (Phase 4.4b)
 */

// Layer 0: Primitives
import { createSemanticElement } from '../../L2_Handling/display/primitives/semantic_element_primitive.js';
import { convertStyleToString } from '../../zSys/dom/style_utils.js';

/**
 * GroupRenderer - Handles _zGroup rendering contexts
 */
export class GroupRenderer {
  constructor(client, logger, orchestrator, metadataProcessor) {
    this.client = client;
    this.logger = logger;
    this.orchestrator = orchestrator;
    this.metadataProcessor = metadataProcessor;
  }

  /**
   * Check if data should be rendered as a group
   * @param {Object} metadata - Metadata object
   * @returns {boolean} True if should render as group
   */
  shouldRenderAsGroup(metadata) {
    return !!(metadata._zGroup || this.metadataProcessor.isInputGroupContext(metadata));
  }

  /**
   * Render items as a grouped container
   * @param {Object} data - Data object with items to group
   * @param {Object} metadata - Metadata with _zGroup
   * @param {HTMLElement} parentElement - Parent to append group to
   * @param {string} currentPath - Current path for recursion
   */
  async renderGroupedItems(data, metadata, parentElement, currentPath = '') {
  // If _zClass contains zInputGroup but no _zGroup, treat as input-group
  if (isInputGroupContext && !metadata._zGroup) {
    metadata._zGroup = 'input-group';
  }
  this.logger.log(`[ZDisplayOrchestrator]  _zGroup detected: "${metadata._zGroup}" - rendering as grouped container`);
  this.logger.log(` _zGroup detected: "${metadata._zGroup}"`);

  // Create group container with zTheme classes based on _zGroup type
  const groupContainer = document.createElement('div');
  groupContainer.setAttribute('data-zgroup', metadata._zGroup);

  // Apply zTheme container class based on group type
  if (metadata._zGroup === 'list-group') {
    groupContainer.classList.add('zList-group');
    this.logger.debug('Applied zTheme class: zList-group');
  } else if (metadata._zGroup === 'input-group') {
    groupContainer.classList.add('zInputGroup');
    this.logger.debug('Applied zTheme class: zInputGroup');
  }

  // Apply additional _zClass styling if provided (from YAML)
  if (metadata._zClass) {
    const classes = metadata._zClass.split(' ').filter(c => c.trim());
    if (classes.length > 0) {
      groupContainer.classList.add(...classes);
      this.logger.log(`  Applied additional _zClass: ${metadata._zClass}`);
    }
  }

  // Add prefix label for input-group if _zGroupLabel is provided
  if (metadata._zGroup === 'input-group' && metadata._zGroupLabel) {
    const labelSpan = document.createElement('span');
    labelSpan.classList.add('zInputGroup-text');
    labelSpan.textContent = metadata._zGroupLabel;
    groupContainer.appendChild(labelSpan);
    this.logger.log(`  Added input group label: ${metadata._zGroupLabel}`);
  }

  // DEBUG: Log what we're about to iterate
  if (metadata._zGroup === 'input-group') {
    this.logger.debug('[INPUT-GROUP] Data keys:', Object.keys(data));
    this.logger.debug('[INPUT-GROUP] Full data:', JSON.stringify(data, null, 2));
  }

  // Track matched conditional inputs (for radio zSelect splitting)
  const matchedInputKeys = new Set();

  // Iterate through all non-metadata children and render into group
  for (const [key, value] of Object.entries(data)) {
    // Skip ONLY metadata keys (not organizational containers like _Visual_Progression)
    // Delegated to MetadataProcessor (Phase 4.4a)
    if (this.metadataProcessor.isMetadataKey(key)) {
      continue;
    }

    // Skip if this input was already matched and rendered by radio zSelect splitting
    if (matchedInputKeys.has(key)) {
      this.logger.log(`   Skipping already-matched conditional input: ${key}`);
      continue;
    }
    
    this.logger.log(`  Rendering grouped item: ${key}`);
    
    // DEBUG for input-group
    if (metadata._zGroup === 'input-group') {
      this.logger.log(`[INPUT-GROUP] Processing child: ${key}`);
      this.logger.log(`[INPUT-GROUP] Value type: ${Array.isArray(value) ? 'Array' : typeof value}`);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.logger.log(`[INPUT-GROUP] Value keys: ${Object.keys(value).join(', ')}`);
        if (value.event) {
          this.logger.log(`[INPUT-GROUP] Event: ${value.event}, type: ${value.type}`);
        }
        if (value.zSelect) {
          this.logger.log(`[INPUT-GROUP] zSelect found, type: ${value.zSelect.type}`);
        }
      }
    }

    // Handle list/array values (zDisplay events)
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && item.zDisplay) {
          // SEPARATION OF CONCERNS: Render element without group context
          const element = await this.renderZDisplayEvent(item.zDisplay, groupContainer);
          if (element) {
            // Apply group-specific styling AFTER rendering
            this._applyGroupStyling(element, metadata._zGroup, item.zDisplay);
            groupContainer.appendChild(element);
          }
        }
      }
    } else if (value && value.zDisplay && value.zDisplay.event === 'selection' && value.zDisplay.type === 'radio' && metadata._zGroup === 'input-group') {
      // Backend sent expanded zSelect as value.zDisplay: run same radio+input split logic
      const sel = value.zDisplay;
      const options = sel.options || [];
      const zCross = sel.zCross !== undefined ? sel.zCross : false;
      const groupName = sel.zId || sel._zId || sel._id || `radio_${Math.random().toString(36).substr(2, 9)}`;
      const conditionalInputs = [];
      for (const [childKey, childValue] of Object.entries(data)) {
        if (childValue && childValue.zInput && childValue.zInput.if) {
          conditionalInputs.push({ key: childKey, value: childValue, condition: (childValue.zInput.if || '').replace(/#.*$/gm, '').trim(), payload: childValue.zInput });
        } else if (childValue && childValue.zDisplay && childValue.zDisplay.event === 'read_string' && childValue.zDisplay.if) {
          conditionalInputs.push({ key: childKey, value: childValue, condition: (childValue.zDisplay.if || '').replace(/#.*$/gm, '').trim(), payload: childValue.zDisplay });
        }
      }
      const parseSuffixN = (s) => {
        if (s == null) return null;
        if (typeof s === 'number' && s > 0) return s;
        const m = String(s).trim().match(/^\+(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      };
      const suffixN = parseSuffixN(sel.suffix);
      
      // Helper function to parse option string
      const parseOptionString = (optionString) => {
        let cleanLabel = optionString;
        let isDisabled = false;
        
        const disabledMatch = optionString.match(/^(.*?)\s*\[disabled\]\s*$/i);
        if (disabledMatch) {
          cleanLabel = disabledMatch[1].trim();
          isDisabled = true;
        }
        
        const defaultMatch = cleanLabel.match(/^(.*?)\s*\[default\]\s*$/i);
        if (defaultMatch) {
          cleanLabel = defaultMatch[1].trim();
        }
        
        return { cleanLabel, isDisabled };
      };
      
      for (let i = 0; i < options.length; i++) {
        let optionValue, optionLabel, optionDisabled;
        
        if (typeof options[i] === 'string') {
          const parsed = parseOptionString(options[i]);
          optionValue = parsed.cleanLabel;
          optionLabel = parsed.cleanLabel;
          optionDisabled = parsed.isDisabled;
        } else {
          optionValue = options[i].value || options[i].label || '';
          optionLabel = options[i].label || options[i].value || '';
          optionDisabled = options[i].disabled || false;
        }
        let matchingInput;
        if (suffixN != null && i < suffixN && i < conditionalInputs.length) {
          matchingInput = conditionalInputs[i];
        } else {
          matchingInput = conditionalInputs.find(input => {
            const condition = (input.condition || '').trim();
            const valueMatch = condition.match(/==\s*['"]?([^'"\s]+)['"]?\s*(?:#|$)/);
            if (valueMatch && valueMatch[1].trim() === optionValue) return true;
            return [`== '${optionValue}'`, `== "${optionValue}"`, `=='${optionValue}'`, `=="${optionValue}"`, `== ${optionValue}`, `==${optionValue}`].some(p => condition.includes(p));
          });
        }
        const inputGroupDiv = document.createElement('div');
        inputGroupDiv.classList.add('zInputGroup');
        if (sel._zClass) {
          const classes = sel._zClass.split(' ').filter(c => c.trim() && c !== 'zCheck-input');
          if (classes.length) inputGroupDiv.classList.add(...classes);
        }
        const textWrapper = document.createElement('div');
        textWrapper.classList.add('zInputGroup-text');
        const { createInput } = await import('../primitives/form_primitives.js');
        const radioInput = createInput('radio', { 
          id: `${groupName}_${i}`, 
          name: groupName, 
          value: optionValue, 
          class: 'zCheck-input', 
          'aria-label': optionLabel,
          disabled: optionDisabled
        });
        if (sel.default === optionValue) radioInput.checked = true;
        radioInput.setAttribute('data-zcross', zCross.toString());
        textWrapper.appendChild(radioInput);
        inputGroupDiv.appendChild(textWrapper);
        if (matchingInput) {
          matchedInputKeys.add(matchingInput.key);
          const payload = matchingInput.payload || matchingInput.value.zInput || matchingInput.value.zDisplay || {};
          const inputEventData = { event: 'read_string', ...payload };
          if (matchingInput.value.zCross !== undefined) inputEventData.zCross = matchingInput.value.zCross;
          delete inputEventData.prompt;
          const inputElement = await this.renderZDisplayEvent(inputEventData, inputGroupDiv);
          if (inputElement) {
            if (inputElement.tagName === 'INPUT' || inputElement.tagName === 'TEXTAREA') {
              inputGroupDiv.appendChild(inputElement);
            } else {
              const actualInput = inputElement.querySelector('input, textarea');
              inputGroupDiv.appendChild(actualInput || inputElement);
            }
          }
        }
        groupContainer.appendChild(inputGroupDiv);
      }
      continue;
    } else if (value && value.zDisplay) {
      // Handle direct zDisplay event
      // SEPARATION OF CONCERNS: Render element without group context
      const element = await this.renderZDisplayEvent(value.zDisplay, groupContainer);
      if (element) {
        // Apply group-specific styling AFTER rendering
        this._applyGroupStyling(element, metadata._zGroup, value.zDisplay);
        groupContainer.appendChild(element);
      }
    } else if (value && typeof value === 'object') {
      // Check if this is already a zDisplay event object
      if (value.event) {
        // This is a zDisplay event that was already expanded by the backend
        this.logger.log(`  Found pre-expanded zDisplay event '${value.event}' in grouped item: ${key}`);
        
        // Special handling for radio selection events in input-group: split into separate zInputGroup containers
        this.logger.log(`  Checking for radio selection: key=${key}, event=${value.event}, type=${value.type}, _zGroup=${metadata._zGroup}`);
        if (value.event === 'selection' && metadata._zGroup === 'input-group' && value.type === 'radio') {
          this.logger.log(`  Radio selection detected! Processing ${value.options?.length || 0} options`);
          // Radio buttons in input-group: create separate zInputGroup for each option
          const options = value.options || [];
          const zCross = value.zCross !== undefined ? value.zCross : false;
          const groupName = value.zId || value._zId || value._id || `radio_${Math.random().toString(36).substr(2, 9)}`;
          
          // Find all conditional zInput elements (shorthand or expanded zDisplay) in declaration order
          const conditionalInputs = [];
          for (const [childKey, childValue] of Object.entries(data)) {
            if (childValue && childValue.zInput && childValue.zInput.if) {
              conditionalInputs.push({ key: childKey, value: childValue, condition: (childValue.zInput.if || '').replace(/#.*$/gm, '').trim(), payload: childValue.zInput });
              this.logger.log(`   Found conditional input: ${childKey} with condition: "${childValue.zInput.if}"`);
            } else if (childValue && childValue.zDisplay && childValue.zDisplay.event === 'read_string' && childValue.zDisplay.if) {
              conditionalInputs.push({ key: childKey, value: childValue, condition: (childValue.zDisplay.if || '').replace(/#.*$/gm, '').trim(), payload: childValue.zDisplay });
              this.logger.log(`   Found conditional input (zDisplay): ${childKey} with condition: "${childValue.zDisplay.if}"`);
            }
          }
          this.logger.log(`   Found ${conditionalInputs.length} conditional input(s) total`);
          // Parse suffix +N (e.g. "+3" => pair with next N inputs by position)
          const parseSuffixN = (s) => {
            if (s == null) return null;
            if (typeof s === 'number' && s > 0) return s;
            const m = String(s).trim().match(/^\+(\d+)$/);
            return m ? parseInt(m[1], 10) : null;
          };
          const suffixN = parseSuffixN(value.suffix);
          if (suffixN != null) this.logger.log(`   suffix: ${value.suffix} → suffixN=${suffixN} (position-based pairing)`);
          
          // Create a separate zInputGroup for each radio option
          for (let i = 0; i < options.length; i++) {
            const optionValue = typeof options[i] === 'string' ? options[i] : (options[i].value || options[i].label || '');
            const optionLabel = typeof options[i] === 'string' ? options[i] : (options[i].label || options[i].value || '');
            
            // Pair by position when suffix +N is set; else match by condition
            let matchingInput;
            if (suffixN != null && i < suffixN && i < conditionalInputs.length) {
              matchingInput = conditionalInputs[i];
              this.logger.log(`   Position-based pair: option[${i}] "${optionValue}" → ${matchingInput.key}`);
            } else {
              matchingInput = conditionalInputs.find(input => {
                const condition = (input.condition || '').trim();
                const valueMatch = condition.match(/==\s*['"]?([^'"\s]+)['"]?\s*(?:#|$)/);
                if (valueMatch && valueMatch[1].trim() === optionValue) return true;
                const patterns = [
                  `== '${optionValue}'`,
                  `== "${optionValue}"`,
                  `=='${optionValue}'`,
                  `=="${optionValue}"`,
                  `== ${optionValue}`,
                  `==${optionValue}`
                ];
                return patterns.some(pattern => condition.includes(pattern));
              });
            }
            if (!suffixN) this.logger.log(`  Looking for input matching option "${optionValue}": ${matchingInput ? `Found: ${matchingInput.key}` : 'Not found'}`);
            
            // Create zInputGroup container for this radio + input pair
            const inputGroupDiv = document.createElement('div');
            inputGroupDiv.classList.add('zInputGroup');
            if (value._zClass) {
              const classes = value._zClass.split(' ').filter(c => c.trim() && c !== 'zCheck-input');
              if (classes.length > 0) {
                inputGroupDiv.classList.add(...classes);
              }
            }
            
            // Create zInputGroup-text wrapper for radio
            const textWrapper = document.createElement('div');
            textWrapper.classList.add('zInputGroup-text');
            
            // Create radio input
            const { createInput } = await import('../primitives/form_primitives.js');
            const radioInput = createInput('radio', {
              id: `${groupName}_${i}`,
              name: groupName,
              value: optionValue,
              class: 'zCheck-input',
              'aria-label': optionLabel
            });
            
            // Set checked state if default matches
            if (value.default === optionValue) {
              radioInput.checked = true;
            }
            
            // Store zCross flag on radio element (for conditional rendering)
            radioInput.setAttribute('data-zcross', zCross.toString());
            
            textWrapper.appendChild(radioInput);
            inputGroupDiv.appendChild(textWrapper);
            
            // Add matching conditional input if found
            if (matchingInput) {
              // Mark this input as matched so we don't process it again
              matchedInputKeys.add(matchingInput.key);
              // Support both shorthand (zInput) and expanded (zDisplay) payloads
              const payload = matchingInput.payload || matchingInput.value.zInput || matchingInput.value.zDisplay || {};
              const inputEventData = { event: 'read_string', ...payload };
              if (matchingInput.value.zCross !== undefined) {
                inputEventData.zCross = matchingInput.value.zCross;
              }
              {
                // Remove prompt to prevent wrapper div creation
                delete inputEventData.prompt;
                // Render input directly into the zInputGroup (no wrapper needed)
                // Pass inputGroupDiv as parent so it detects input-group context
                const inputElement = await this.renderZDisplayEvent(inputEventData, inputGroupDiv);
                if (inputElement) {
                  // If renderZDisplayEvent returns a wrapper, extract the actual input
                  // Otherwise use the element directly
                  if (inputElement.tagName === 'INPUT' || inputElement.tagName === 'TEXTAREA') {
                    inputGroupDiv.appendChild(inputElement);
                  } else {
                    // Wrapper returned - find the input inside and move it
                    const actualInput = inputElement.querySelector('input, textarea');
                    if (actualInput) {
                      inputGroupDiv.appendChild(actualInput);
                    } else {
                      inputGroupDiv.appendChild(inputElement);
                    }
                  }
                }
              }
            }
            
            groupContainer.appendChild(inputGroupDiv);
            this.logger.log(`  Created zInputGroup for radio option: ${optionValue}`);
          }
          
          // Skip normal rendering for this zSelect
          continue;
        }
        
        // Special handling for checkboxes in input-group: wrap in zInputGroup-text
        if (value.event === 'read_bool' && metadata._zGroup === 'input-group') {
          const wrapperDiv = document.createElement('div');
          wrapperDiv.classList.add('zInputGroup-text');
          wrapperDiv.setAttribute('data-zkey', key);
          
          // Render checkbox inside wrapper, passing wrapper as parent so it detects input-group context
          const checkboxElement = await this.renderZDisplayEvent(value, wrapperDiv);
          if (checkboxElement) {
            wrapperDiv.appendChild(checkboxElement);
          }
          groupContainer.appendChild(wrapperDiv);
          this.logger.log(`  Wrapped read_bool checkbox in zInputGroup-text for input-group`);
        } else {
          // Normal rendering for other events
          const element = await this.renderZDisplayEvent(value, groupContainer);
          if (element) {
            groupContainer.appendChild(element);
          }
        }
      } else {
        // Check for shorthand keys (zInput, zButton, etc.) that need expansion
        const shorthandKeys = ['zInput', 'zButton', 'zCheckbox', 'zSelect', 'zText', 'zMD', 'zH1', 'zH2', 'zH3', 'zH4', 'zH5', 'zH6', 'zURL', 'zImage'];
        const foundShorthand = shorthandKeys.find(sk => value[sk]);
        
        if (foundShorthand) {
          // This is a shorthand that needs to be rendered as a zDisplay event
          this.logger.debug(`Found shorthand '%s' in grouped item: %s`, foundShorthand, key);
          
          // Special handling for radio zSelect in input-group: split into separate zInputGroup containers
          this.logger.debug(`Checking radio zSelect shorthand: %s`, foundShorthand);
          if (foundShorthand === 'zSelect' && metadata._zGroup === 'input-group' && value.zSelect && value.zSelect.type === 'radio') {
            this.logger.debug(`Radio zSelect shorthand detected (%s options)`, value.zSelect.options?.length || 0);
            // Radio buttons in input-group: create separate zInputGroup for each option
            const options = value.zSelect.options || [];
            const zCross = value.zCross !== undefined ? value.zCross : false;
            const groupName = value.zSelect.zId || value.zSelect._zId || value.zSelect._id || `radio_${Math.random().toString(36).substr(2, 9)}`;
            
            // Find all conditional zInput elements (shorthand or expanded zDisplay) in declaration order
            const conditionalInputs = [];
            for (const [childKey, childValue] of Object.entries(data)) {
              if (childValue && childValue.zInput && childValue.zInput.if) {
                conditionalInputs.push({ key: childKey, value: childValue, condition: (childValue.zInput.if || '').replace(/#.*$/gm, '').trim(), payload: childValue.zInput });
              } else if (childValue && childValue.zDisplay && childValue.zDisplay.event === 'read_string' && childValue.zDisplay.if) {
                conditionalInputs.push({ key: childKey, value: childValue, condition: (childValue.zDisplay.if || '').replace(/#.*$/gm, '').trim(), payload: childValue.zDisplay });
              }
            }
            // Parse suffix +N (e.g. "+3" => pair with next N inputs by position)
            const parseSuffixN = (s) => {
              if (s == null) return null;
              if (typeof s === 'number' && s > 0) return s;
              const m = String(s).trim().match(/^\+(\d+)$/);
              return m ? parseInt(m[1], 10) : null;
            };
            const suffixN = parseSuffixN(value.zSelect.suffix);
            this.logger.log(`   suffix: ${value.zSelect.suffix} → suffixN=${suffixN}, conditionalInputs=${conditionalInputs.length}`);
            
            // Create a separate zInputGroup for each radio option
            for (let i = 0; i < options.length; i++) {
              const optionValue = typeof options[i] === 'string' ? options[i] : (options[i].value || options[i].label || '');
              const optionLabel = typeof options[i] === 'string' ? options[i] : (options[i].label || options[i].value || '');
              
              // Pair by position when suffix +N is set; else match by condition
              let matchingInput;
              if (suffixN != null && i < suffixN && i < conditionalInputs.length) {
                matchingInput = conditionalInputs[i];
                this.logger.log(`   Position-based pair: option[${i}] "${optionValue}" → ${matchingInput.key}`);
              } else {
                matchingInput = conditionalInputs.find(input => {
                  const condition = (input.condition || '').trim();
                  const valueMatch = condition.match(/==\s*['"]?([^'"\s]+)['"]?\s*(?:#|$)/);
                  if (valueMatch && valueMatch[1].trim() === optionValue) return true;
                  const patterns = [
                    `== '${optionValue}'`,
                    `== "${optionValue}"`,
                    `=='${optionValue}'`,
                    `=="${optionValue}"`,
                    `== ${optionValue}`,
                    `==${optionValue}`
                  ];
                  return patterns.some(pattern => condition.includes(pattern));
                });
              }
              
              // Create zInputGroup container for this radio + input pair
              const inputGroupDiv = document.createElement('div');
              inputGroupDiv.classList.add('zInputGroup');
              if (value.zSelect._zClass) {
                const classes = value.zSelect._zClass.split(' ').filter(c => c.trim() && c !== 'zCheck-input');
                if (classes.length > 0) {
                  inputGroupDiv.classList.add(...classes);
                }
              }
              
              // Create zInputGroup-text wrapper for radio
              const textWrapper = document.createElement('div');
              textWrapper.classList.add('zInputGroup-text');
              
              // Create radio input
              const { createInput } = await import('../primitives/form_primitives.js');
              const radioInput = createInput('radio', {
                id: `${groupName}_${i}`,
                name: groupName,
                value: optionValue,
                class: 'zCheck-input',
                'aria-label': optionLabel
              });
              
              // Set checked state if default matches
              if (value.zSelect.default === optionValue) {
                radioInput.checked = true;
              }
              
              // Store zCross flag on radio element (for conditional rendering)
              radioInput.setAttribute('data-zcross', zCross.toString());
              
              textWrapper.appendChild(radioInput);
              inputGroupDiv.appendChild(textWrapper);
              
              // Add matching conditional input if found
              if (matchingInput) {
                // Mark this input as matched so we don't process it again
                matchedInputKeys.add(matchingInput.key);
                // Support both shorthand (zInput) and expanded (zDisplay) payloads from backend
                const payload = matchingInput.payload || matchingInput.value.zInput || matchingInput.value.zDisplay || {};
                const inputEventData = { event: 'read_string', ...payload };
                if (matchingInput.value.zCross !== undefined) {
                  inputEventData.zCross = matchingInput.value.zCross;
                }
                // Remove prompt to prevent wrapper div creation
                delete inputEventData.prompt;
                const inputElement = await this.renderZDisplayEvent(inputEventData, inputGroupDiv);
                if (inputElement) {
                  // Extract actual input/textarea if renderZDisplayEvent returned a wrapper
                  if (inputElement.tagName === 'INPUT' || inputElement.tagName === 'TEXTAREA') {
                    inputGroupDiv.appendChild(inputElement);
                  } else {
                    const actualInput = inputElement.querySelector('input, textarea');
                    if (actualInput) {
                      inputGroupDiv.appendChild(actualInput);
                    } else {
                      inputGroupDiv.appendChild(inputElement);
                    }
                  }
                }
              }
              
              groupContainer.appendChild(inputGroupDiv);
              this.logger.log(`  Created zInputGroup for radio option: ${optionValue}`);
            }
            
            // Skip normal rendering for zSelect
            continue;
          }
          
          // Special handling for checkboxes in input-group: wrap in zInputGroup-text
          if (foundShorthand === 'zCheckbox' && metadata._zGroup === 'input-group') {
            // Check if already wrapped in a container with zInputGroup-text
            const hasInputGroupTextWrapper = value._zClass && value._zClass.includes('zInputGroup-text');
            
            if (!hasInputGroupTextWrapper) {
              // Wrap checkbox in zInputGroup-text container
              const wrapperDiv = document.createElement('div');
              wrapperDiv.classList.add('zInputGroup-text');
              wrapperDiv.setAttribute('data-zkey', key);
              
              // Expand zCheckbox to read_bool event and render directly into wrapper
              // Pass zCross from parent value if present
              const eventData = { event: 'read_bool', ...value.zCheckbox };
              if (value.zCross !== undefined) {
                eventData.zCross = value.zCross;
              }
              const checkboxElement = await this.renderZDisplayEvent(eventData, wrapperDiv);
              if (checkboxElement) {
                wrapperDiv.appendChild(checkboxElement);
              }
              groupContainer.appendChild(wrapperDiv);
              this.logger.log(`  Wrapped checkbox in zInputGroup-text for input-group`);
            } else {
              // Already wrapped, render normally
              const element = await this.renderChunk({ [key]: value });
              if (element && element.firstChild) {
                const actualElement = element.firstChild;
                groupContainer.appendChild(actualElement);
              }
            }
          } else {
            // Recursively render the entire structure for other shorthands
            const element = await this.renderChunk({ [key]: value });
            if (element && element.firstChild) {
              // Extract the actual rendered element (skip wrapper if present)
              const actualElement = element.firstChild;
              groupContainer.appendChild(actualElement);
            }
          }
        } else {
      // Handle nested objects (recurse)
      // DEBUG: Log organizational containers
      if (key.startsWith('_')) {
        this.logger.log(` [GROUP] Processing organizational container: ${key}`);
      }
      
      // Use centralized semantic element primitive (SSOT for _zHTML)
      const elementType = value._zHTML || 'div';
      const itemDiv = createSemanticElement(elementType, {}, this.logger);
      itemDiv.setAttribute('data-zkey', key);
      
      // Apply metadata to the organizational container
      if (value._zClass) {
        itemDiv.className = value._zClass;
      }
      if (value._zStyle) {
        const cssString = convertStyleToString(value._zStyle, this.logger);
        if (cssString) {
          itemDiv.setAttribute('style', cssString);
        }
      }
      
      await this.renderItems(value, itemDiv, keyPath);
      
      if (itemDiv.children.length > 0) {
        // OPTIMIZATION: Unwrap single-child containers with no styling
        // This handles zText with semantic:div where the div itself has styling
        if (itemDiv.children.length === 1 && !itemDiv.className) {
          const child = itemDiv.children[0];
          // Transfer data-zkey and id to the child
          child.setAttribute('data-zkey', key);
          if (!child.id) {
            child.setAttribute('id', key);
          }
          groupContainer.appendChild(child);
        } else {
          groupContainer.appendChild(itemDiv);
        }
        
        if (key.startsWith('_')) {
          this.logger.log(`[GROUP] Rendered organizational container ${key} with ${itemDiv.children.length} children`);
        }
      }
      }
      }
    }
  }

  // Append group to parent
  if (groupContainer.children.length > 0) {
    parentElement.appendChild(groupContainer);
    this.logger.log(`[ZDisplayOrchestrator] Grouped container rendered with ${groupContainer.children.length} items`);
    this.logger.log(`Grouped container rendered with ${groupContainer.children.length} items`);
  }

  // Exit early - we've handled all children in the group
  return;
}

  /**
   * Apply group-specific styling to an element (Terminal-first pattern)
   * @param {HTMLElement} element - The rendered element
   * @param {string} groupType - The type of group
   * @param {Object} eventData - The original event data
   * @private
   */
  _applyGroupStyling(element, groupType, eventData) {
    if (!element || !groupType) {
      return;
    }

  this.logger.log(`[_applyGroupStyling] Applying group styling: ${groupType}, color: ${eventData.color || 'none'}`);

  // Apply group-specific zTheme classes based on group type and event type
  switch (groupType) {
    case 'list-group':
      // For links, buttons, or any interactive element in a list-group
      if (eventData.event === 'zURL' || eventData.event === 'button') {
        element.classList.add('zList-group-item', 'zList-group-item-action');

        // Terminal-first: Auto-infer color variant from YAML color parameter
        if (eventData.color) {
          const colorClass = `zList-group-item-${eventData.color.toLowerCase()}`;
          element.classList.add(colorClass);
          this.logger.log(`[_applyGroupStyling] Applied list-group color: ${colorClass}`);
        }
      }
      break;

    case 'button-group':
      // For future: Button groups (horizontal button toolbar)
      // element.classList.add('zBtn-group-item');
      break;

    case 'card-group':
      // For future: Card groups (masonry/grid layout)
      // element.classList.add('zCard-group-item');
      break;

    default:
      this.logger.warn(`[_applyGroupStyling] Unknown group type: ${groupType}`);
  }
  }
}
