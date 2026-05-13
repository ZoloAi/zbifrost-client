/**
 * Input Request Renderer - Interactive input forms for user input
 * 
 * Renders interactive input request forms from backend:
 * - Text input (string, password)
 * - Selection (radio/checkbox)
 * - Button confirmation
 * 
 * Extracted from zdisplay_renderer.js (Phase 4)
 * 
 * @module rendering/specialized/input_request_renderer
 * @layer 3 (Specialized Rendering)
 */

import { TYPOGRAPHY } from '../../../L1_Foundation/constants/bifrost_constants.js';

export class InputRequestRenderer {
  constructor(logger = null, defaultZone = 'zVaF-content') {
    this.logger = logger || console;
    this.defaultZone = defaultZone;
  }

  /**
   * Render input request as HTML form
   * @param {Object} inputRequest - Input request event from backend
   * @param {string} targetZone - Target DOM element ID
   */
  renderInputRequest(inputRequest, targetZone = null) {
    const zone = targetZone || this.defaultZone;
    const container = document.getElementById(zone);

    if (!container) {
      this.logger.error(`[InputRequestRenderer] Cannot render input - zone not found: ${zone}`);
      return;
    }

    // Extract input details
    const requestId = inputRequest.requestId || inputRequest.data?.requestId;
    const inputType = inputRequest.type || inputRequest.data?.type || 'string';
    const prompt = inputRequest.prompt || inputRequest.data?.prompt || 'Enter input:';
    const masked = inputRequest.masked || inputRequest.data?.masked || (inputType === 'password');

    this.logger.log('[InputRequestRenderer] Rendering input form:', { requestId, inputType, prompt, masked });

    // Create form container
    const form = document.createElement('form');
    form.className = 'zInputForm';
    form.style.cssText = `
      margin: 1rem 0;
      padding: 1rem;
      border: 2px solid var(--color-primary, #00D4FF);
      border-radius: 8px;
      background-color: var(--color-base, #fff);
    `;

    // Create label
    const label = document.createElement('label');
    label.textContent = prompt;
    label.style.cssText = `
      display: block;
      margin-bottom: 0.5rem;
      font-weight: bold;
      color: var(--color-darkgray, #333);
    `;

    // Create input field
    const input = document.createElement('input');
    input.type = masked ? 'password' : 'text';
    input.placeholder = masked ? '••••••••' : 'Type here...';
    input.required = true;
    input.style.cssText = `
      width: 100%;
      padding: 0.5rem;
      margin-bottom: 1rem;
      border: 1px solid var(--color-gray, #ccc);
      border-radius: 4px;
      font-size: 1rem;
    `;

    // Create submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = '[ok] Submit';
    submitBtn.className = 'zoloButton zBtnPrimary';
    submitBtn.style.cssText = `
      padding: 0.5rem 1.5rem;
      cursor: pointer;
    `;

    // Handle form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = input.value.trim();

      this.logger.log('[InputRequestRenderer] Input submitted:', { requestId, value: masked ? '***' : value });

      // Send input_response back to server (one-way, no response expected)
      if (window.bifrostClient && window.bifrostClient.connection) {
        try {
          const payload = {
            event: 'input_response',
            requestId: requestId,
            value: value
          };
          this.logger.log('[InputRequestRenderer] Sending input_response:', payload);
          window.bifrostClient.connection.send(JSON.stringify(payload));
          this.logger.log('[InputRequestRenderer] Input response sent successfully (one-way)');
        } catch (error) {
          this.logger.error('[InputRequestRenderer] [ERROR] Failed to send input response:', error);
        }
      } else {
        this.logger.error('[InputRequestRenderer] Cannot send input response - bifrostClient not found on window');
      }

      // Replace form with confirmation message
      const confirmation = document.createElement('p');
      confirmation.style.cssText = `
        margin: 1rem 0;
        padding: 0.75rem;
        background-color: var(--color-success-light, #d4edda);
        border: 1px solid var(--color-success, #28a745);
        border-radius: 4px;
        color: var(--color-success-dark, #155724);
      `;
      confirmation.textContent = masked
        ? `[ok] Password submitted (${value.length} characters)`
        : `[ok] Submitted: ${value}`;

      form.replaceWith(confirmation);
    });

    // Assemble form
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(submitBtn);

    // Add to container
    container.appendChild(form);

    // Focus input
    input.focus();

    this.logger.log('[InputRequestRenderer] Input form rendered');
  }

  /**
   * Render selection request as HTML form with radio/checkboxes
   * @param {Object} selectionRequest - Selection request event from backend
   * @param {string} targetZone - Target DOM element ID
   */
  renderSelectionRequest(selectionRequest, targetZone = null) {
    const zone = targetZone || this.defaultZone;
    const container = document.getElementById(zone);

    if (!container) {
      this.logger.error(`[InputRequestRenderer] Cannot render selection - zone not found: ${zone}`);
      return;
    }

    // Extract selection details
    const requestId = selectionRequest.requestId || selectionRequest.data?.requestId;
    const prompt = selectionRequest.prompt || selectionRequest.data?.prompt || 'Select:';
    const options = selectionRequest.options || selectionRequest.data?.options || [];
    const multi = selectionRequest.multi || selectionRequest.data?.multi || false;
    const defaultVal = selectionRequest.default || selectionRequest.data?.default;

    this.logger.log('[InputRequestRenderer] Rendering selection form:', { requestId, prompt, options, multi });

    // Create form container
    const form = document.createElement('form');
    form.className = 'zSelectionForm';
    form.style.cssText = `
      margin: 1rem 0;
      padding: 1rem;
      border: 2px solid var(--color-primary, #00D4FF);
      border-radius: 8px;
      background-color: var(--color-base, #fff);
    `;

    // Create label
    const label = document.createElement('label');
    label.textContent = prompt;
    label.style.cssText = `
      display: block;
      margin-bottom: 1rem;
      font-weight: bold;
      color: var(--color-darkgray, #333);
    `;
    form.appendChild(label);

    // Create options container
    const optionsContainer = document.createElement('div');
    optionsContainer.style.cssText = `
      margin-bottom: 1rem;
      max-height: 300px;
      overflow-y: auto;
    `;

    // Create option elements
    const inputType = multi ? 'checkbox' : 'radio';
    const inputName = `selection_${requestId}`;

    options.forEach((option, index) => {
      const optionDiv = document.createElement('div');
      optionDiv.style.cssText = `
        padding: 0.5rem;
        margin: 0.25rem 0;
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
      `;
      optionDiv.onmouseover = () => optionDiv.style.backgroundColor = 'var(--color-lightgray, #f8f9fa)';
      optionDiv.onmouseout = () => optionDiv.style.backgroundColor = 'transparent';

      const input = document.createElement('input');
      input.type = inputType;
      input.name = inputName;
      input.value = option;
      input.id = `${inputName}_${index}`;
      input.style.cssText = `
        margin-right: 0.5rem;
        cursor: pointer;
      `;

      // Set default selection
      if (defaultVal) {
        if (multi && Array.isArray(defaultVal)) {
          input.checked = defaultVal.includes(option);
        } else if (!multi && defaultVal === option) {
          input.checked = true;
        }
      }

      const optionLabel = document.createElement('label');
      optionLabel.htmlFor = input.id;
      optionLabel.textContent = option;
      optionLabel.style.cssText = `
        cursor: pointer;
        flex: 1;
      `;

      optionDiv.appendChild(input);
      optionDiv.appendChild(optionLabel);
      optionDiv.onclick = () => input.checked = !input.checked;

      optionsContainer.appendChild(optionDiv);
    });

    form.appendChild(optionsContainer);

    // Create submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.textContent = '[ok] Submit';
    submitBtn.className = 'zoloButton zBtnPrimary';
    submitBtn.style.cssText = `
      padding: 0.5rem 1.5rem;
      cursor: pointer;
    `;
    form.appendChild(submitBtn);

    // Handle form submission
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      // Get selected values
      const selectedInputs = form.querySelectorAll(`input[name="${inputName}"]:checked`);
      const selectedValues = Array.from(selectedInputs).map(input => input.value);

      // Return appropriate format
      const value = multi ? selectedValues : (selectedValues[0] || null);

      this.logger.log('[InputRequestRenderer] Selection submitted:', { requestId, value });

      // Send selection_response back to server (one-way)
      if (window.bifrostClient && window.bifrostClient.connection) {
        try {
          const payload = {
            event: 'input_response',
            requestId: requestId,
            value: value
          };
          this.logger.log('[InputRequestRenderer] Sending selection response:', payload);
          window.bifrostClient.connection.send(JSON.stringify(payload));
          this.logger.log('[InputRequestRenderer] Selection response sent successfully');
        } catch (error) {
          this.logger.error('[InputRequestRenderer] [ERROR] Failed to send selection response:', error);
        }
      } else {
        this.logger.error('[InputRequestRenderer] Cannot send selection response - bifrostClient not found');
      }

      // Replace form with confirmation message
      const confirmation = document.createElement('p');
      confirmation.style.cssText = `
        margin: 1rem 0;
        padding: 0.75rem;
        background-color: var(--color-success-light, #d4edda);
        border: 1px solid var(--color-success, #28a745);
        border-radius: 4px;
        color: var(--color-success-dark, #155724);
      `;

      if (multi) {
        confirmation.textContent = selectedValues.length > 0
          ? `[ok] Selected: ${selectedValues.join(', ')}`
          : '[ok] No selections made';
      } else {
        confirmation.textContent = value ? `[ok] Selected: ${value}` : '[ok] No selection made';
      }

      form.replaceWith(confirmation);
    });

    // Add to container
    container.appendChild(form);

    this.logger.log('[InputRequestRenderer] Selection form rendered');
  }

  /**
   * Render button request as interactive confirmation button
   * @param {Object} buttonRequest - Button request event from backend
   * @param {string} targetZone - Target DOM element ID
   */
  renderButtonRequest(buttonRequest, targetZone = null) {
    const zone = targetZone || this.defaultZone;
    const container = document.getElementById(zone);

    if (!container) {
      this.logger.error(`[InputRequestRenderer] Cannot render button - zone not found: ${zone}`);
      return;
    }

    // Extract button details
    const requestId = buttonRequest.requestId || buttonRequest.data?.requestId;
    const label = buttonRequest.prompt || buttonRequest.data?.prompt || 'Click Me';
    const action = buttonRequest.action || buttonRequest.data?.action || null;
    const color = buttonRequest.color || buttonRequest.data?.color || 'primary';
    const style = buttonRequest.style || buttonRequest.data?.style || 'default';

    this.logger.log('[InputRequestRenderer] Rendering button:', { requestId, label, action, color, style });

    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'zButtonContainer';
    buttonContainer.style.cssText = `
      margin: 1rem 0;
      padding: 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    `;

    // Create the button with zTheme classes
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;

    // Apply zTheme button classes based on color
    const colorClass = {
      'primary': 'zBtnPrimary',
      'success': 'zBtnSuccess',
      'danger': 'zBtnDanger',
      'warning': 'zBtnWarning',
      'info': 'zBtnInfo',
      'secondary': 'zBtnSecondary'
    }[color] || 'zBtnPrimary';

    button.className = `zoloButton ${colorClass}`;
    button.style.cssText = `
      padding: 0.5rem 1.5rem;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.1s ease;
    `;

    // Add hover effect
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.02)';
    });
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
    });

    // Handle button click
    button.addEventListener('click', () => {
      this.logger.log('[InputRequestRenderer] Button clicked:', label);

      // Send response back to server (True = clicked)
      if (window.bifrostClient && window.bifrostClient.connection) {
        window.bifrostClient.connection.send(JSON.stringify({
          event: 'input_response',
          requestId: requestId,
          value: true  // Button clicked = True
        }));
        this.logger.log('[InputRequestRenderer] Button response sent');
      }

      // Replace button with confirmation
      const confirmation = document.createElement('p');
      confirmation.style.cssText = `
        margin: 0;
        padding: 0.5rem 1rem;
        color: var(--color-success, #10b981);
        font-weight: ${TYPOGRAPHY.FONT_WEIGHTS.MEDIUM};
      `;
      confirmation.textContent = `[ok] ${label} clicked!`;

      buttonContainer.replaceWith(confirmation);
    });

    // Add cancel button (optional - for explicit "No" response)
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'zoloButton zBtnSecondary';
    cancelBtn.style.cssText = `
      padding: 0.5rem 1.5rem;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.1s ease;
    `;

    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.transform = 'scale(1.02)';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.transform = 'scale(1)';
    });

    cancelBtn.addEventListener('click', () => {
      this.logger.log('[InputRequestRenderer] Button cancelled');

      // Send False response
      if (window.bifrostClient && window.bifrostClient.connection) {
        window.bifrostClient.connection.send(JSON.stringify({
          event: 'input_response',
          requestId: requestId,
          value: false  // Cancelled = False
        }));
      }

      // Replace with cancellation message
      const cancellation = document.createElement('p');
      cancellation.style.cssText = `
        margin: 0;
        padding: 0.5rem 1rem;
        color: var(--color-gray, #6b7280);
        font-style: italic;
      `;
      cancellation.textContent = '[x] Cancelled';

      buttonContainer.replaceWith(cancellation);
    });

    // Assemble container
    buttonContainer.appendChild(button);
    buttonContainer.appendChild(cancelBtn);

    // Add to container
    container.appendChild(buttonContainer);

    this.logger.log('[InputRequestRenderer] Button rendered');
  }
}
