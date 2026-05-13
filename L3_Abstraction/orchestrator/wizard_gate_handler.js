/**
 * L3_Abstraction/orchestrator/wizard_gate_handler.js
 * 
 * Wizard Gate Handling for Progressive Disclosure
 * 
 * Manages gated wizard steps that require user input before revealing
 * subsequent steps. Handles:
 * - Gate detection (keys with '!' modifier)
 * - Pre-gate/post-gate rendering
 * - Submit button creation and delegation
 * - Gate result handling
 * - Wizard restart functionality
 * 
 * Extracted from zdisplay_orchestrator.js (Phase 4.2)
 */

/**
 * WizardGateHandler - Manages gated wizard step rendering and interaction
 */
export class WizardGateHandler {
  constructor(client, logger, orchestrator) {
    this.client = client;
    this.logger = logger;
    this.orchestrator = orchestrator; // Reference to parent orchestrator for renderItems
  }

  /**
   * Check if data contains a gated wizard step
   * @param {Object} data - YAML data object
   * @returns {string|null} Gate step key (with '!') or null
   */
  detectGateStep(data) {
    if (!data || typeof data !== 'object') {
      return null;
    }
    // 2C-a: Server sends gate_key explicitly — no need to scan for '!' convention
    const serverGateKey = this.orchestrator._pendingGateKey;
    if (serverGateKey) {
      return Object.keys(data).find(k => k.replace('!', '') === serverGateKey && !k.startsWith('_'))
        || (serverGateKey + '!');
    }
    // Fallback: scan for '!' in keys (safety net for non-chunk paths)
    return Object.keys(data).find(k => k.includes('!') && !k.startsWith('_')) || null;
  }

  /**
   * Render a gated wizard step collection with submit button and hidden post-gate steps.
   * @param {Object} data - Dict of wizard steps, at least one key has '!' suffix
   * @param {HTMLElement} parentElement - Element to render into
   * @param {string} gateKey - The step key that has '!' (e.g., "one!")
   * @param {string} wizardPath - Dot-path from file root to this wizard dict
   */
  async renderWizardGated(data, parentElement, gateKey, wizardPath) {
    const cleanGateKey = gateKey.replace('!', '');
    const allStepKeys = Object.keys(data).filter(k => !k.startsWith('_'));
    const gateIdx = allStepKeys.indexOf(gateKey);
    const preGateKeys = allStepKeys.slice(0, gateIdx);
    const postGateKeys = allStepKeys.slice(gateIdx + 1);

    // Render pre-gate steps
    for (const key of preGateKeys) {
      const cleanKey = key.replace('!', '');
      await this.orchestrator.renderItems({ [cleanKey]: data[key] }, parentElement, wizardPath);
    }

    // Extract _zDelegate from the gate step (GUI-only metadata, ignored in zCLI).
    // After backend expand+unwrap, the zInput wrapper is stripped:
    //   {zInput: {prompt, _zDelegate}} → {event:'read_string', prompt, _zDelegate}
    // so _zDelegate lands directly on the step value. Fallback covers raw-YAML edge cases.
    const gateStepValue = data[gateKey];
    this.logger.log('[WizardGate] gateStepValue keys:', gateStepValue ? Object.keys(gateStepValue) : 'null/undefined', '| _zDelegate:', gateStepValue?._zDelegate, '| zInput._zDelegate:', gateStepValue?.zInput?._zDelegate);
    const delegatePath = gateStepValue?._zDelegate
        ?? gateStepValue?.zInput?._zDelegate
        ?? null;

    // CRITICAL: zDialog forms need _dialogId for proper context management
    // When wizard gate renders zDialog, inject _dialogId if missing (backend may not have sent it yet)
    let gateStepValueToRender = gateStepValue;
    if (gateStepValue && typeof gateStepValue === 'object' && gateStepValue.zDialog) {
      // Extract _dialogId from parent context if present, or generate one
      const dialogId = gateStepValue._dialogId || this._generateDialogId();
      this.logger.log('[WizardGate] Injecting _dialogId into zDialog:', dialogId);
      
      // Create a new object with _dialogId injected into the zDialog object
      gateStepValueToRender = {
        ...gateStepValue,
        zDialog: {
          ...gateStepValue.zDialog,
          _dialogId: dialogId
        }
      };
    }

    // Gate step wrapper with submit button
    const gateWrapper = document.createElement('div');
    gateWrapper.setAttribute('data-wizard-gate', cleanGateKey);
    if (delegatePath) {
      gateWrapper.setAttribute('data-zdelegate', delegatePath);
    }

    await this.orchestrator.renderItems({ [cleanGateKey]: gateStepValueToRender }, gateWrapper, wizardPath);

    // Check if the rendered content already has its own submit mechanism
    // (e.g., zDialog forms have their own submit button inside the form)
    const hasOwnSubmit = gateWrapper.querySelector('button[type="submit"]');

    // Only add gate submit button if content doesn't have its own
    if (!hasOwnSubmit) {
      // Shared submit action — used by both default Submit btn and _zDelegate wiring
      const doGateSubmit = async (submitBtn) => {
        const input = gateWrapper.querySelector('input, textarea, select');
        const value = input ? input.value.trim() : '';
        if (!value) return;

        input.disabled = true;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '...'; }

        try {
          this.client.connection.send(JSON.stringify({
            event: 'wizard_gate_submit',
            wizardPath,
            gateKey: cleanGateKey,
            value,
          }));
        } catch (e) {
          this.logger.error('[WizardGate] Submit error:', e);
          if (input) input.disabled = false;
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
        }
      };

      const submitBtn = document.createElement('button');
      submitBtn.textContent = 'Submit';
      submitBtn.className = 'zBtn zBtn-primary mt-2';
      submitBtn.style.marginTop = '0.5rem';
      submitBtn.addEventListener('click', () => doGateSubmit(submitBtn));

      // When _zDelegate is set, hide the default Submit button (delegate takes over)
      // Keep it in the DOM so restartWizardFromGate can find/reset it
      if (delegatePath) {
        submitBtn.style.display = 'none';
        submitBtn.setAttribute('aria-hidden', 'true');
      }

      gateWrapper.appendChild(submitBtn);
    }

    parentElement.appendChild(gateWrapper);

    // Post-gate container (hidden until wizard_gate_result arrives)
    if (postGateKeys.length > 0) {
      const postGateContainer = document.createElement('div');
      postGateContainer.setAttribute('data-wizard-post-gate', cleanGateKey);
      postGateContainer.setAttribute('data-wizard-path', wizardPath);
      postGateContainer.style.display = 'none';
      parentElement.appendChild(postGateContainer);
    }
  }

  /**
   * Handle wizard_gate_result: populate and show the post-gate container.
   * @param {Object} message - {gateKey, wizardPath, data}
   */
  async handleWizardGateResult(message) {
    const { gateKey, data } = message;
    const postGateContainer = document.querySelector(`[data-wizard-post-gate="${gateKey}"]`);
    if (!postGateContainer) {
      this.logger.error('[WizardGate] Post-gate container not found for key:', gateKey);
      return;
    }

    const wizardPath = postGateContainer.getAttribute('data-wizard-path') || '';
    postGateContainer.innerHTML = '';
    await this.orchestrator.renderItems(data, postGateContainer, wizardPath);
    postGateContainer.style.display = '';

    const gateWrapper = document.querySelector(`[data-wizard-gate="${gateKey}"]`);
    if (gateWrapper) {
      const btn = gateWrapper.querySelector('button');
      if (btn) {
        btn.textContent = 'Submitted';
        btn.disabled = true;
      }
      // Also disable delegate button if one was wired for this gate
      const delegatePath = gateWrapper.getAttribute('data-zdelegate');
      if (delegatePath) {
        const scope = gateWrapper.closest('[data-zblock]') || document;
        const delegateContainer = this._resolveZDelegatePath(delegatePath, scope);
        const delegateBtn = delegateContainer?.querySelector('button') || delegateContainer;
        if (delegateBtn) delegateBtn.disabled = true;
      }
    }

    // Wire restart handlers for any buttons with data-wizard-action inside the post-gate content
    const restartBtns = postGateContainer.querySelectorAll('[data-wizard-action]');
    for (const btn of restartBtns) {
      btn.addEventListener('click', () => {
        this.restartWizardFromGate(btn.dataset.wizardAction);
      });
    }
    
    // Wire delegates for any hidden delegated buttons in post-gate content
    this.orchestrator._wireDelegates();
  }

  /**
   * Restart a wizard from its gate step: re-enable the gate input and clear post-gate content.
   * Called when a button with data-wizard-action matching the gate key is clicked.
   * @param {string} targetGateKey - The gate step key to restart from (e.g. "one")
   */
  restartWizardFromGate(targetGateKey) {
    const gateWrapper = document.querySelector(`[data-wizard-gate="${targetGateKey}"]`);
    const postGateContainer = document.querySelector(`[data-wizard-post-gate="${targetGateKey}"]`);

    if (!gateWrapper) {
      this.logger.warn('[WizardGate] Restart: gate wrapper not found for key:', targetGateKey);
      return;
    }

    // Re-enable gate input and reset submit button
    const input = gateWrapper.querySelector('input, textarea, select');
    const submitBtn = gateWrapper.querySelector('button');
    if (input) {
      input.disabled = false;
      input.value = '';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit';
    }

    // Re-enable delegate button if one is wired for this gate
    const delegatePath = gateWrapper.getAttribute('data-zdelegate');
    if (delegatePath) {
      const scope = gateWrapper.closest('[data-zblock]') || document;
      const delegateContainer = this._resolveZDelegatePath(delegatePath, scope);
      const delegateBtn = delegateContainer?.querySelector('button') || delegateContainer;
      if (delegateBtn) delegateBtn.disabled = false;
      // Clear wired flag so _wireDelegates re-attaches a fresh listener
      delete gateWrapper.dataset.zdelegateWired;
    }

    // Clear and hide post-gate content
    if (postGateContainer) {
      postGateContainer.style.display = 'none';
      postGateContainer.innerHTML = '';
    }

    this.logger.log(`[WizardGate] Restarted wizard from gate: ${targetGateKey}`);

    // Re-wire delegate (deferred so DOM settles after restart)
    if (delegatePath) {
      setTimeout(() => this.orchestrator._wireDelegates(), 50);
    } else if (input) {
      setTimeout(() => input.focus(), 50);
    }
  }

  /**
   * Resolve a _zDelegate path (e.g. "_GUI.Btn_Eq") to the target button element.
   * Walks data-zkey attributes in sequence within the given scope (defaults to document).
   * Scoping to the nearest [data-zblock] prevents cross-block collisions.
   * @param {string} path - Dot-separated key path
   * @param {Element|Document} [scope=document] - Root to search within
   * @returns {HTMLElement|null}
   * @private
   */
  _resolveZDelegatePath(path, scope = document) {
    const parts = path.split('.');
    let el = scope;
    for (const part of parts) {
      el = el.querySelector(`[data-zkey="${part}"]`);
      if (!el) return null;
    }
    return el;
  }

  /**
   * Generate a unique dialog ID for client-side form context management.
   * Uses crypto.randomUUID() if available, falls back to timestamp-based UUID.
   * @returns {string} UUID string
   * @private
   */
  _generateDialogId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback: timestamp-based UUID v4-like format
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
