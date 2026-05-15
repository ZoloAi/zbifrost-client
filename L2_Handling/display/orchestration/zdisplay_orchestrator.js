/**
 * ZDisplayOrchestrator - Central orchestrator for all declarative rendering
 *
 * Handles:
 * - YAML → DOM rendering
 * - Progressive chunk rendering
 * - Block-level metadata
 * - Recursive item rendering
 * - zDisplay event routing (delegates to specialized renderers)
 * - Navbar rendering
 *
 * Refactoring History:
 * - Phase 2.1: Extracted from bifrost_client.js
 * - Phase 4.4: Extracted metadata processor and group renderer to L3
 * - Task 2.7 (Pre-NPM): Extracted input event handlers to L3 (1441 LOC → 887 LOC)
 * - Phase 5 (Server-Side Intel): Removed ShorthandExpander — Python pre-expands all shorthands
 */

import { TYPOGRAPHY } from '../../../L1_Foundation/constants/bifrost_constants.js';
import { WizardGateHandler } from '../../../L3_Abstraction/orchestrator/wizard_gate_handler.js';
import { NavBarBuilder } from '../../../L3_Abstraction/orchestrator/navbar_builder.js';
import { MetadataProcessor } from '../../../L3_Abstraction/orchestrator/metadata_processor.js';
import { GroupRenderer } from '../../../L3_Abstraction/orchestrator/group_renderer.js';
import { ContainerUnwrapper } from '../../../L3_Abstraction/orchestrator/container_unwrapper.js';
import { InputEventHandler } from '../../../L3_Abstraction/orchestrator/input_event_handler.js';
import { createSemanticElement } from '../primitives/semantic_element_primitive.js';
import { convertStyleToString } from '../../../zSys/dom/style_utils.js';
import { getAlertColorClass } from '../../../zSys/theme/ztheme_utils.js';

export class ZDisplayOrchestrator {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
    this.options = client.options;
    this.wizardGateHandler = new WizardGateHandler(client, this.logger, this);
    this.navBarBuilder = new NavBarBuilder(client, this.logger);
    this.metadataProcessor = new MetadataProcessor(this.logger);
    this.groupRenderer = new GroupRenderer(client, this.logger, this, this.metadataProcessor);
    this.containerUnwrapper = new ContainerUnwrapper(this.logger);
    this.inputEventHandler = new InputEventHandler(client, this.logger);
  }

  /**
   * Render an entire zVaF block from YAML data
   * @param {Object} blockData - Block configuration from YAML
   */
  async renderBlock(blockData) {
    // Use stored reference (set by _initZVaFElements)
    const contentElement = this.client._zVaFElement;
    if (!contentElement) {
      throw new Error('zVaF element not initialized');
    }

    // Clear existing content
    contentElement.innerHTML = '';

    // Check if blockData has block-level metadata (_zClass) for cascading
    let blockWrapper = contentElement;
    if (blockData && typeof blockData === 'object' && blockData._zClass) {
      // Create wrapper div for the entire block with block-level classes (using primitive)
      const { createDiv } = await import('../primitives/generic_containers.js');
      const blockLevelDiv = createDiv();
      const blockName = this.options.zBlock || 'zBlock';

      // Apply block-level classes
      const classes = Array.isArray(blockData._zClass)
        ? blockData._zClass
        : blockData._zClass.split(',').map(c => c.trim());
      blockLevelDiv.className = classes.join(' ');
      blockLevelDiv.setAttribute('data-zblock', blockName);

      contentElement.appendChild(blockLevelDiv);
      blockWrapper = blockLevelDiv;  // Children render inside the block wrapper

      this.logger.debug(`[ZDisplayOrchestrator] Created block-level wrapper`);
    }

    // Recursively render all items (await for navigation renderer loading)
    await this.renderItems(blockData, blockWrapper);
    
    // NOTE: zCard-body auto-enhancement REMOVED (2026-01-28)
    // Users should explicitly declare _zClass: zCard-body when needed.
    // The renderer should not be "smarter" than the declarative .zolo file.
  }

  /**
   * Progressive chunk rendering (Terminal First philosophy)
   * Appends chunks from backend as they arrive, stops at failed gates
   * @param {Object} message - Chunk message from backend
   */
  async renderChunkProgressive(message) {
    try {
      this.logger.debug('[ZDisplayOrchestrator] renderChunkProgressive called:', message.chunk_num);
      const {chunk_num, keys, data, is_gate, gate_key} = message;
      this._pendingGateKey = (is_gate && gate_key) ? gate_key : null;

      this.logger.debug(`[ZDisplayOrchestrator] Rendering chunk #${chunk_num}`);
      if (is_gate) {
        this.logger.debug('[ZDisplayOrchestrator] Chunk contains gate');
      }

      // Check if we're rendering into a dashboard panel (zDash context)
      const dashboardPanelContent = document.getElementById('dashboard-panel-content');
      const contentDiv = dashboardPanelContent || this.client._zVaFElement;

      if (!contentDiv) {
        throw new Error('zVaF element not initialized. Ensure _initZVaFElements() was called.');
      }

      // Check if data has block-level metadata (_zClass, _zStyle, etc.)
      const hasBlockMetadata = data && Object.keys(data).some(k => k.startsWith('_'));

      // Determine the target container for rendering
      let targetContainer = contentDiv;

      // ALWAYS clear loading state on first chunk (regardless of metadata)
      if (chunk_num === 1) {
        contentDiv.innerHTML = '';
        this.logger.debug('[ZDisplayOrchestrator] Cleared loading state');
      }

      if (hasBlockMetadata && chunk_num === 1) {
        // First chunk with block metadata: create a wrapper for the entire block
        const blockName = message.zBlock || 'progressive';  // Use block name from backend
        
        // Use centralized semantic element primitive (SSOT for _zHTML)
        const elementType = data._zHTML || 'div';
        const blockWrapper = createSemanticElement(elementType, {}, this.logger);
        blockWrapper.setAttribute('data-zblock', 'progressive');
        blockWrapper.setAttribute('id', blockName);

        // Apply block-level metadata to wrapper
        for (const [key, value] of Object.entries(data)) {
          if (key === '_zClass' && value) {
            blockWrapper.className = value;
          } else if (key === '_zStyle' && value) {
            const cssString = convertStyleToString(value, this.logger);
            if (cssString) {
              blockWrapper.setAttribute('style', cssString);
            }
          }
          // _zHTML is already handled above (element creation)
        }

        contentDiv.appendChild(blockWrapper);
        targetContainer = blockWrapper;
        this.logger.debug(`[ZDisplayOrchestrator] Created block wrapper: ${blockName}`);
      } else if (hasBlockMetadata && chunk_num > 1) {
        // Subsequent chunks: find existing block wrapper
        const existingWrapper = contentDiv.querySelector('[data-zblock="progressive"]');
        if (existingWrapper) {
          targetContainer = existingWrapper;
          this.logger.debug(`[ZDisplayOrchestrator] Using existing block wrapper`);
        }
      }

      // Render YAML data using existing rendering pipeline
      // This preserves all styling, forms, zDisplay events, etc.
      if (data && typeof data === 'object') {
        // DEBUG: Log chunk data structure
        this.logger.debug('[ZDisplayOrchestrator] Chunk data keys:', Object.keys(data));
        for (const [key, value] of Object.entries(data)) {
          if (!key.startsWith('_')) {
            this.logger.debug(`[ZDisplayOrchestrator] ${key}:`, typeof value);
          }
        }
        await this.renderItems(data, targetContainer);
        this._pendingGateKey = null;
        this.logger.log(`[ZDisplayOrchestrator] Chunk #${chunk_num} rendered from YAML (${keys.length} keys)`);
        
        // Initialize conditional rendering for any wizards with if conditions
        this.logger.debug(`[ZDisplayOrchestrator] Checking wizard containers`);
        try {
          await this.client._ensureWizardConditionalRenderer();
          this.logger.debug(`[ZDisplayOrchestrator] WizardConditionalRenderer ensured`);
        } catch (err) {
          this.logger.error(`[ZDisplayOrchestrator] Failed to ensure WizardConditionalRenderer:`, err);
        }
        
        const wizardContainers = targetContainer.querySelectorAll('[data-zkey*="Wizard"], [data-zgroup="input-group"]');
        this.logger.debug(`[ZDisplayOrchestrator] Found ${wizardContainers.length} wizard containers`);
        
        if (wizardContainers.length > 0) {
          this.logger.debug(`[ZDisplayOrchestrator] Initializing ${wizardContainers.length} wizard containers`);
          wizardContainers.forEach((container, idx) => {
            const containerId = container.id || container.getAttribute('data-zkey') || container.getAttribute('data-zgroup') || `container-${idx}`;
            this.logger.debug(`[ZDisplayOrchestrator] Initializing wizard: ${containerId}`);
            try {
              this.client.wizardConditionalRenderer.initializeWizard(container);
            } catch (err) {
              this.logger.error(`[ZDisplayOrchestrator] [ERROR] Failed to initialize wizard container ${containerId}:`, err);
            }
          });
        } else {
          const conditionalElements = targetContainer.querySelectorAll('[data-zif]');
          this.logger.debug(`[ZDisplayOrchestrator] No wizards, ${conditionalElements.length} conditional elements`);
          
          if (conditionalElements.length > 0) {
            this.logger.debug(`[ZDisplayOrchestrator] Found ${conditionalElements.length} conditional elements`);
            const parentContainers = new Set();
            conditionalElements.forEach((el, idx) => {
              this.logger.debug(`[ZDisplayOrchestrator] Conditional element ${idx + 1}`);
              // Find the closest container with data-zgroup or data-zkey containing "Wizard"
              const parent = el.closest('[data-zgroup], [data-zkey*="Wizard"]');
              if (parent && !parentContainers.has(parent)) {
                parentContainers.add(parent);
                const parentId = parent.id || parent.getAttribute('data-zkey') || parent.getAttribute('data-zgroup') || `parent-${idx}`;
                this.logger.debug(`[ZDisplayOrchestrator] Initializing parent wizard: ${parentId}`);
                try {
                  this.client.wizardConditionalRenderer.initializeWizard(parent);
                } catch (err) {
                  this.logger.error(`[ZDisplayOrchestrator] [ERROR] Failed to initialize parent wizard container ${parentId}:`, err);
                }
              } else {
                this.logger.debug(`[ZDisplayOrchestrator] No parent found for conditional element ${idx + 1}`);
              }
            });
          } else {
            this.logger.debug('[ZDisplayOrchestrator] No wizard containers or conditional elements found');
          }
        }
        
        // Re-initialize zTheme components after rendering new content
        if (window.zTheme && typeof window.zTheme.initRangeSliders === 'function') {
          window.zTheme.initRangeSliders();
          this.logger.debug('[ZDisplayOrchestrator] Re-initialized range sliders');
        }
        if (window.zTheme && typeof window.zTheme.initAccordion === 'function') {
          window.zTheme.initAccordion();
          this.logger.debug('[ZDisplayOrchestrator] Re-initialized accordions');
        }

        // Wire any _zDelegate buttons declared in this chunk
        this._wireDelegates();
      } else {
        this.logger.warn(`[ZDisplayOrchestrator] [WARN] Chunk #${chunk_num} has no YAML data to render`);
      }

      // If this is a gate chunk, log that we're waiting for backend
      if (is_gate) {
        this.logger.debug('[ZDisplayOrchestrator] Waiting for gate completion');
      }

    } catch (error) {
      this.logger.error('Failed to render chunk:', error);
      throw error;
    }
  }


  /**
   * Recursively render YAML items (handles nested structures like implicit wizards)
   * @param {Object} data - YAML data to render
   * @param {HTMLElement} parentElement - Parent element to render into
   */
  async renderItems(data, parentElement, currentPath = '') {
    if (!data || typeof data !== 'object') {
      this.logger.debug('[ZDisplayOrchestrator] renderItems: No data');
      return;
    }

    this.logger.debug('[ZDisplayOrchestrator] renderItems called with keys:', Object.keys(data));

    // Check if parent already has block-level metadata applied (data-zblock attribute)
    const _parentIsBlockWrapper = parentElement.hasAttribute && parentElement.hasAttribute('data-zblock');

    // Extract metadata first (underscore-prefixed keys like _zClass)
    // Delegated to MetadataProcessor (Phase 4.4a)
    const metadata = this.metadataProcessor.extractMetadata(data);

    // Detect gated wizard steps (keys with '!' gate modifier)
    // Delegated to WizardGateHandler (Phase 4.2)
    const gateStepKey = this.wizardGateHandler.detectGateStep(data);
    if (gateStepKey) {
      await this.wizardGateHandler.renderWizardGated(data, parentElement, gateStepKey, currentPath);
      return;
    }

    // Expand shorthand syntax (zH1-zH6, zText, zUL, zOL, zTable, zMD, zImage, zURL)
    // Check for _zGroup metadata - delegate to GroupRenderer (Phase 4.4b)
    if (this.groupRenderer.shouldRenderAsGroup(metadata)) {
      await this.groupRenderer.renderGroupedItems(data, metadata, parentElement, currentPath);
      return;
    }

    // 
    // Regular (non-grouped) rendering continues below
    // 

    // Iterate through all keys in this level
    for (const [key, value] of Object.entries(data)) {
      const keyPath = currentPath ? `${currentPath}.${key}` : key;

      // Handle metadata keys BEFORE skipping
      if (key.startsWith('~')) {
        // Navigation metadata: ~zNavBar*
        if (key.startsWith('~zNavBar')) {
          await this.renderNavBar(value, parentElement);
          continue;
        }
        // Other metadata keys - skip for now
        continue;
      }

      // Skip ONLY metadata attributes (not terminal-suppressed elements)
      // _zClass, _zStyle, _zHTML, _zId, _zScripts are metadata attributes applied to parent
      // But _Demo_Stack, _Live_Demo_Section are terminal-suppressed elements that SHOULD render in Bifrost
      const METADATA_KEYS = ['_zClass', '_zStyle', '_zHTML', '_zId', '_zScripts', 'zId'];
      if (METADATA_KEYS.includes(key)) {
        continue;
      }

      this.logger.debug(`Rendering item: ${key}`);

      // Check if this value has its own metadata (for nested _zClass support)
      let itemMetadata = {};

      // Each zKey container should ONLY use its OWN _zClass/_zStyle/_zHTML/zId, never inherit from parent
      // This ensures ProfilePicture doesn't get ProfileHeader's classes
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value._zClass !== undefined || value._zStyle !== undefined || value._zHTML !== undefined || value.zId !== undefined || value._zId !== undefined) {
          itemMetadata = {
            _zClass: value._zClass,
            _zStyle: value._zStyle,
            _zHTML: value._zHTML,
            zId: value.zId || value._zId,  // _zId as fallback so both conventions work
          };
          this.logger.debug(`Found nested metadata for %s`, key, itemMetadata);
          // DEBUG: Log organizational container metadata
          if (key.startsWith('_Box_') || key.startsWith('_Visual_')) {
            this.logger.log(`[METADATA] ${key}:`, {
              _zClass: value._zClass,
              _zStyle: value._zStyle,
              hasZDisplay: !!value.zDisplay,
              allKeys: Object.keys(value)
            });
          }
        }
      }

      // Create container wrapper for this zKey (zTheme responsive layout)
      const containerDiv = await this.createContainer(key, itemMetadata);

      // Give container a data attribute for debugging
      containerDiv.setAttribute('data-zkey', key);
      // Set id for DevTools navigation and CSS targeting (unless custom zId provided)
      if (!itemMetadata.zId) {
        containerDiv.setAttribute('id', key);
      }

      // zMenu primitive — nav/ul/li buttons + sibling placeholders.
      // Wizard-flow semantics: clicking option[i] renders options[i..n] sequentially.
      // value = { title, options: [...], zAnchor, Option_A: {...}, Option_B: {...} }
      if (key === 'zMenu') {
        this.logger.debug('[ZDisplayOrchestrator] Rendering zMenu inline (nav + placeholders)');
        const options = Array.isArray(value.options) ? value.options : [];
        const title = value.title || null;

        // Optional title
        if (title) {
          const titleEl = document.createElement('p');
          titleEl.className = 'zText-muted zSmall zmb-1';
          titleEl.textContent = title;
          containerDiv.appendChild(titleEl);
        }

        // <nav> with <ul class="zNavbar-nav zflex-column"> — SSOT with zNavbar classes
        const nav = document.createElement('nav');
        nav.className = 'zMenu-nav zmb-2';
        nav.setAttribute('role', 'menu');
        if (title) nav.setAttribute('aria-label', title);

        const ul = document.createElement('ul');
        ul.className = 'zNavbar-nav zd-flex zflex-column zgap-1 list-unstyled zm-0 zp-0';
        nav.appendChild(ul);
        containerDiv.appendChild(nav);

        // Sibling placeholder divs — one per option, appended to containerDiv after nav
        const placeholders = {};
        options.forEach(optKey => {
          const ph = document.createElement('div');
          ph.className = 'zMenu-option-content';
          ph.style.display = 'none';
          ph.dataset.menuContent = optKey;
          placeholders[optKey] = ph;
          containerDiv.appendChild(ph);
        });

        // Build nav items — click triggers sequential wizard-flow render
        options.forEach((optKey, idx) => {
          const li = document.createElement('li');
          li.className = 'zNav-item';

          const btn = document.createElement('button');
          btn.className = 'zNav-link zBtn w-100 text-start zp-2';
          btn.setAttribute('role', 'menuitem');
          btn.dataset.key = optKey;
          btn.innerHTML = `<span class="zBadge zBadge-secondary me-2">${idx + 1}</span>${optKey.replace(/_/g, ' ')}`;

          btn.addEventListener('click', async () => {
            // Reset: hide all placeholders, clear rendered state, remove active
            ul.querySelectorAll('button[data-key]').forEach(b => b.classList.remove('active'));
            options.forEach(k => {
              const ph = placeholders[k];
              if (ph) { ph.style.display = 'none'; ph.innerHTML = ''; delete ph.dataset.rendered; }
            });

            btn.classList.add('active');

            // Wizard flow: render from selected index forward, sequentially
            const tail = options.slice(idx);
            for (const optKey of tail) {
              const ph = placeholders[optKey];
              if (!ph) continue;
              ph.style.display = 'block';
              if (value[optKey]) {
                ph.dataset.rendered = '1';
                try {
                  // Wrap in {optKey: content} so renderItems sees the key and
                  // correctly routes value.event (expanded shorthand) or nested dict
                  await this.renderItems({ [optKey]: value[optKey] }, ph, [...keyPath, key]);
                } catch (e) {
                  this.logger.error(`[ZDisplayOrchestrator] zMenu option render error (${optKey}):`, e);
                }
              }
            }
          });

          li.appendChild(btn);
          ul.appendChild(li);
        });

        parentElement.appendChild(containerDiv);
        continue;
      }

      // Handle list/array values (sequential zDisplay events, zDialog forms, OR menus)
      if (Array.isArray(value)) {
        this.logger.log(`[ZDisplayOrchestrator] Detected list/array for key: ${key}, items: ${value.length}`);
        this.logger.log(`Detected list/array for key: ${key}, items: ${value.length}`);

        // Check if this is a menu (has * modifier and array of strings)
        const isMenu = key.includes('*') && value.every(item => typeof item === 'string');

        if (isMenu) {
          this.logger.log(`[ZDisplayOrchestrator]  Detected MENU: ${key}`);
          this.logger.log(` Detected menu with ${value.length} options`);

          // Load menu renderer and render the menu
          const menuRenderer = await this.client._ensureMenuRenderer();
          if (menuRenderer) {
            // Prepare menu data (matching backend zMenu event format)
            const menuData = {
              menu_key: key,
              options: value,
              title: key.replace(/[*~^$]/g, '').trim() || 'Menu',
              allow_back: true
            };

            // Render menu into container
            menuRenderer.renderMenuInline(menuData, containerDiv);
            this.logger.log(`Menu rendered for ${key}`);
          } else {
            this.logger.error('[ZDisplayOrchestrator] [ERROR] MenuRenderer not available');
          }
        } else {
          // Regular list/array - iterate through items
          for (const item of value) {
            if (item && item.zDisplay) {
              this.logger.log('[ZDisplayOrchestrator]   Rendering zDisplay event:', item.zDisplay.event);
              this.logger.log('  Rendering zDisplay from list item:', item.zDisplay);
              const element = await this.renderZDisplayEvent(item.zDisplay, containerDiv);
              if (element) {
                this.logger.log('  Appended element to container');
                containerDiv.appendChild(element);
              }
            } else if (item && item.zDialog) {
              this.logger.log('  Rendering zDialog from list item:', item.zDialog);
              const formRenderer = await this.client._ensureFormRenderer();
              const formElement = formRenderer.renderForm(item.zDialog);
              if (formElement) {
                this.logger.log('  Appended zDialog form to container');
                containerDiv.appendChild(formElement);
              }
            } else if (item && typeof item === 'object') {
              // Nested object in list - recurse
              await this.renderItems(item, containerDiv, keyPath);
            }
          }
        }
      } else if (value && value.zDisplay) {
        // Check if this has a direct zDisplay event
        this.logger.debug(`[renderItems] Direct zDisplay for ${key}`);
        const element = await this.renderZDisplayEvent(value.zDisplay, containerDiv);
        if (element) {
          // Handle unwrapping - delegated to ContainerUnwrapper (Phase 4.4c)
          if (element.nodeType === Node.COMMENT_NODE) {
            parentElement.appendChild(element);
            continue;
          }
          
          const unwrapResult = this.containerUnwrapper.processUnwrapping(containerDiv, element, key);
          if (!unwrapResult.shouldAppendContainer) {
            parentElement.appendChild(unwrapResult.elementToAppend);
            continue;
          }
          // Container was kept, element already appended to container
        }
      } else if (value && value.event && typeof value.event === 'string') {
        //  Backend now sends unwrapped zDisplay events (direct event key, no zDisplay wrapper)
        // Example: {event: 'zCrumbs', show: 'static', ...}
        // Also handles zData: read resolved inline as {event: 'zTable', ...}
        if (key === 'zData' && value.event === 'zTable') {
          this.logger.log(`[renderItems] zData:read resolved inline → zTable (${value.rows?.length ?? 0} rows)`);
        }
        this.logger.debug(`[renderItems] Direct event: %s for %s`, value.event, key);
        const element = await this.renderZDisplayEvent(value, containerDiv);
        if (element) {
          // Handle unwrapping - delegated to ContainerUnwrapper (Phase 4.4c)
          if (element.nodeType === Node.COMMENT_NODE) {
            parentElement.appendChild(element);
            continue;
          }
          
          const unwrapResult = this.containerUnwrapper.processUnwrapping(containerDiv, element, key);
          if (!unwrapResult.shouldAppendContainer) {
            parentElement.appendChild(unwrapResult.elementToAppend);
            continue;
          }
          // Container was kept, element already appended to container
        }
      } else if (value && value.zDialog) {
        // Check if this has a direct zDialog form
        this.logger.log('  Rendering zDialog from direct value:', value.zDialog);
        const formRenderer = await this.client._ensureFormRenderer();
        const formElement = formRenderer.renderForm(value.zDialog);
        if (formElement) {
          containerDiv.appendChild(formElement);
        }
      } else if (value && typeof value === 'object' && Object.keys(value).length > 0) {
        {
          // If it's an object with nested keys (implicit wizard or server-expanded shorthand), recurse.
          // Python pre-expands all shorthands (singular and plural) before sending.
          // Singular: {zH1: {event:'header',...}} → recurse → inner key hits value.event path above.
          // Plural: zBtns/zInputs expanded to individual items by expand_chunk_shorthands (Phase 5).
          // DEBUG: Log organizational containers
          if (key.startsWith('_')) {
            this.logger.log(` [NON-GROUP] Processing organizational container: ${key}, nested keys:`, Object.keys(value));
          } else {
            this.logger.debug(`[ZDisplayOrchestrator] Recursing into nested object: %s`, key, Object.keys(value));
          }
          // Nested structure - render children recursively
          await this.renderItems(value, containerDiv, keyPath);
          if (key.startsWith('_') && containerDiv.children.length > 0) {
            this.logger.log(`[NON-GROUP] Rendered organizational container ${key} with ${containerDiv.children.length} children`);
          }
        }
      }

      // Append container to parent if it has children OR if it carries its own
      // styling/semantic intent (class, inline style, or non-div tag).
      // This allows metadata-only blocks like:
      //   Primary_Cube:
      //     _zHTML: div
      //     _zClass: zBg-primary zRounded
      //     _zStyle: width:120px; height:120px
      // NOTE: zCard-body auto-enhancement REMOVED (2026-01-28)
      const hasChildren = containerDiv.children.length > 0;
      const hasStyling = containerDiv.className || containerDiv.getAttribute('style');
      const isSemanticTag = containerDiv.tagName.toLowerCase() !== 'div';
      if (hasChildren || hasStyling || isSemanticTag) {
        parentElement.appendChild(containerDiv);
      }
    }
  }


  /**
   * Handle wizard_gate_result: populate and show the post-gate container.
   * Delegated to WizardGateHandler (Phase 4.2)
   * @param {Object} message - {gateKey, wizardPath, data}
   */
  async handleWizardGateResult(message) {
    await this.wizardGateHandler.handleWizardGateResult(message);
  }


  /**
   * Resolve a _zDelegate path (e.g. "_GUI.Btn_Eq") to the target button element.
   * Walks data-zkey attributes in sequence within the given scope (defaults to document).
   * Scoping to the nearest [data-zblock] prevents cross-block collisions.
   * @param {string} path - Dot-separated key path
   * @param {Element|Document} [scope=document] - Root to search within
   * @returns {HTMLElement|null}
   */
  _resolveZDelegatePath(path, scope = document) {
    const parts = path.split('.');
    let el = scope;
    for (const part of parts) {
      el = el.querySelector(`[data-zkey="${part}"]`);
      if (!el) {
        this.logger.warn('[WizardGate] _zDelegate: key not found in DOM:', part, '(path:', path, ')');
        return null;
      }
    }
    return el;
  }

  /**
   * Wire _zDelegate buttons for all gate wrappers that declare one.
   * Also handles button[data-zdelegate] → input replacement delegation.
   * Safe to call multiple times — skips already-wired gates via dataset.zdelegateWired.
   * Call after each chunk render and after wizard restart.
   */
  _wireDelegates() {
    // ── Pass 0: hidden button → delegate button (wizard action) ─────────────
    // Handles buttons with both data-wizard-action and data-zdelegate
    // Example: Restart button delegates to AC button
    const hiddenActionButtons = document.querySelectorAll('button[data-wizard-action][data-zdelegate]:not([data-zdelegate-wired])');
    this.logger.log('[Delegate] Pass 0: Found', hiddenActionButtons.length, 'hidden action buttons');
    for (const hiddenBtn of hiddenActionButtons) {
      const targetPath = hiddenBtn.dataset.zdelegate;
      const wizardAction = hiddenBtn.dataset.wizardAction;
      
      this.logger.log('[Delegate] Processing hidden button:', hiddenBtn, 'action:', wizardAction, 'target:', targetPath);
      
      const targetContainer = this._resolveZDelegatePath(targetPath, document);
      if (!targetContainer) {
        this.logger.warn('[Delegate] Target container not found for:', targetPath);
        continue;
      }
      
      const targetBtn = targetContainer.querySelector('button') || targetContainer;
      if (!targetBtn) {
        this.logger.warn('[Delegate] Target button not found in container:', targetContainer);
        continue;
      }
      
      // Wire target button to trigger wizard restart
      targetBtn.addEventListener('click', () => {
        this.logger.log('[Delegate] Target button clicked, restarting wizard from:', wizardAction);
        this._restartWizardFromGate(wizardAction);
      });
      hiddenBtn.dataset.zdelegateWired = 'true';
      this.logger.log('[Delegate] Button action → button wired:', wizardAction, '→', targetPath);
    }
    
    // ── Pass 1: button → input (replace value) ──────────────────────────────
    const delegateButtons = document.querySelectorAll('button[data-zdelegate]:not([data-zdelegate-wired])');
    for (const btn of delegateButtons) {
      const targetPath = btn.dataset.zdelegate;
      const targetContainer = this._resolveZDelegatePath(targetPath, document);
      if (!targetContainer) continue;

      const targetInput = targetContainer.querySelector('input, textarea, select');
      if (!targetInput) continue;

      btn.addEventListener('click', () => {
        targetInput.value = btn.textContent.trim();
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      });
      btn.dataset.zdelegateWired = 'true';
      this.logger.log('[Delegate] Button → input wired:', btn.textContent.trim(), '→', targetPath);
    }

    // ── Pass 2: zInput gate → delegate button (submit) ──────────────────────
    const gateWrappers = document.querySelectorAll('[data-wizard-gate][data-zdelegate]');
    for (const gateWrapper of gateWrappers) {
      if (gateWrapper.dataset.zdelegateWired) continue;

      const delegatePath = gateWrapper.getAttribute('data-zdelegate');
      // Scope to the nearest [data-zblock] ancestor to avoid cross-block collisions
      const scope = gateWrapper.closest('[data-zblock]') || document;
      const delegateContainer = this._resolveZDelegatePath(delegatePath, scope);
      if (!delegateContainer) continue;
      const delegateBtn = delegateContainer.querySelector('button') || delegateContainer;

      const cleanGateKey = gateWrapper.getAttribute('data-wizard-gate');
      // wizardPath lives on the companion post-gate container (set during _renderWizardGated)
      const postGateContainer = document.querySelector(`[data-wizard-post-gate="${cleanGateKey}"]`);
      const wizardPath = postGateContainer?.getAttribute('data-wizard-path') || '';

      delegateBtn.addEventListener('click', async () => {
        const input = gateWrapper.querySelector('input, textarea, select');
        const value = input ? input.value.trim() : '';
        if (!value) return;

        input.disabled = true;
        delegateBtn.disabled = true;

        try {
          this.client.connection.send(JSON.stringify({
            event: 'wizard_gate_submit',
            wizardPath,
            gateKey: cleanGateKey,
            value,
          }));
        } catch (e) {
          this.logger.error('[WizardGate] Delegate submit error:', e);
          if (input) input.disabled = false;
          delegateBtn.disabled = false;
        }
      });

      gateWrapper.dataset.zdelegateWired = 'true';
      this.logger.log('[WizardGate] Wired _zDelegate for gate:', cleanGateKey, '→', delegatePath);
    }
  }

  /**
   * Create container wrapper for a zKey with zTheme responsive classes
   * Supports _zClass, _zStyle, and zId metadata for customization
   * @param {string} zKey - Key name for debugging
   * @param {Object} metadata - Metadata object with _zClass, _zStyle, zId
   * @returns {HTMLElement}
   */
  async createContainer(zKey, metadata) {
    // Delegated to MetadataProcessor (Phase 4.4a)
    return this.metadataProcessor.createContainer(zKey, metadata, this.logger);
  }

  /**
   * Render navbar DOM element (v1.6.1: Returns DOM element to preserve event listeners)
   * Delegated to NavBarBuilder (Phase 4.3)
   * @param {Array} items - Navbar items (e.g., ['zVaF', 'zAbout', '^zLogin'])
   * @returns {Promise<HTMLElement|null>} Navbar DOM element
   */
  async renderMetaNavBarHTML(items) {
    return await this.navBarBuilder.renderMetaNavBarHTML(items, this.options);
  }

  /**
   * Render navigation bar from metadata (~zNavBar* in content)
   * Delegated to NavBarBuilder (Phase 4.3)
   * @param {Array} items - Navbar items
   * @param {HTMLElement} parentElement - Parent element to append to
   */
  async renderNavBar(items, parentElement) {
    await this.navBarBuilder.renderNavBar(items, parentElement);
  }

  /**
   * Render a single zDisplay event as DOM element
   * @param {Object} eventData - Event data with event type and content
   * @param {HTMLElement} [parentElement=null] - Optional parent element for context detection
   * @returns {Promise<HTMLElement>}
   */
  async renderZDisplayEvent(eventData, parentElement = null) {
    const event = eventData.event;
    this.logger.debug(`[renderZDisplayEvent] Rendering event: ${event}`);
    let element;

    switch (event) {
      case 'text': {
        // Use modular TypographyRenderer for text
        const textRenderer = await this.client._ensureTypographyRenderer();
        element = textRenderer.renderText(eventData);
        this.logger.log('[renderZDisplayEvent] Rendered text element');
        break;
      }

      case 'rich_text': {
        // Use TextRenderer for rich text with markdown parsing
        const textRenderer = await this.client._ensureTextRenderer();
        element = textRenderer.renderRichText(eventData);
        this.logger.debug('[renderZDisplayEvent] Rendered rich_text element');
        break;
      }

      case 'code': {
        const codeRenderer = await this.client._ensureCodeRenderer();
        element = codeRenderer.renderCode(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered code block (language: ${eventData.language || 'text'})`);
        break;
      }

      case 'json': {
        // Render JSON data as a syntax-highlighted code block (language: json).
        const jsonCodeRenderer = await this.client._ensureCodeRenderer();
        const jsonStr = typeof eventData.data === 'string'
          ? eventData.data
          : JSON.stringify(eventData.data, null, eventData.indent_size ?? 2);
        element = jsonCodeRenderer.renderCode({ event: 'code', language: 'json', content: jsonStr });
        this.logger.debug('[renderZDisplayEvent] Rendered json block');
        break;
      }

      case 'header': {
        // Use modular TypographyRenderer for headers
        const headerRenderer = await this.client._ensureTypographyRenderer();
        element = headerRenderer.renderHeader(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered header (level: %s)`, eventData.level || 1);
        break;
      }

      case 'divider': {
        // Use modular TypographyRenderer for dividers
        const dividerRenderer = await this.client._ensureTypographyRenderer();
        element = dividerRenderer.renderDivider(eventData);
        break;
      }

      case 'button': {
        // Use modular ButtonRenderer for buttons
        const buttonRenderer = await this.client._ensureButtonRenderer();
        element = buttonRenderer.render(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered button: ${eventData.label}`);
        break;
      }

      case 'zURL': {
        // Use modular LinkRenderer for semantic links
        // Renamed from 'link' to distinguish from zLink (inter-file navigation)
        const { renderLink } = await import('../primitives/link_primitives.js');
        // SEPARATION OF CONCERNS: Primitive renders element, orchestrator handles grouping
        element = renderLink(eventData, null, this.client, this.logger);
        this.logger.debug(`[renderZDisplayEvent] Rendered zURL: ${eventData.label}`);
        break;
      }

      case 'zTable': {
        // Use modular TableRenderer for tables
        const tableRenderer = await this.client._ensureTableRenderer();
        // Give the renderer a client reference so _handleTableNavigation can send
        tableRenderer.client = this.client;
        element = tableRenderer.render(eventData);

        // For interactive tables: replace existing DOM node with same instance ID (in-place navigation).
        // data-table-id is a unique per-render instance ID so multiple same-model tables
        // on one page each target their own DOM node correctly.
        if (element && element.getAttribute('data-interactive') === 'true') {
          const instanceId = element.getAttribute('data-table-id');
          if (instanceId) {
            const existing = document.querySelector(`[data-table-id="${instanceId}"][data-interactive="true"]`);
            if (existing) {
              existing.replaceWith(element);
              element = null; // Prevent double-append below
            }
          }
        }

        this.logger.debug(`[renderZDisplayEvent] Rendered table: ${eventData.title || 'untitled'}`);
        break;
      }

      case 'list': {
        // Use modular ListRenderer for lists
        const listRenderer = await this.client._ensureListRenderer();
        element = listRenderer.render(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered list: ${eventData.items?.length || 0} items`);
        break;
      }

      case 'dl': {
        // Use DLRenderer for description lists
        const dlRenderer = await this.client._ensureDLRenderer();
        element = dlRenderer.render(eventData);
        this.logger.log(`[renderZDisplayEvent] Rendered description list with ${eventData.items?.length || 0} items`);
        break;
      }

      case 'image': {
        // Use modular ImageRenderer for images
        const imageRenderer = await this.client._ensureImageRenderer();
        element = imageRenderer.render(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered image: ${eventData.src}`);
        break;
      }

      case 'icon': {
        // Use modular IconRenderer for Bootstrap Icons
        const iconRenderer = await this.client._ensureIconRenderer();
        const iconContainer = document.createElement('span');
        iconRenderer.render(eventData, iconContainer);
        element = iconContainer;
        this.logger.debug(`[renderZDisplayEvent] Rendered icon: ${eventData.name}`);
        break;
      }

      case 'card': {
        // Use modular CardRenderer for cards
        const cardRenderer = await this.client._ensureCardRenderer();
        element = cardRenderer.renderCard(eventData);
        this.logger.log('[renderZDisplayEvent] Rendered card element');
        break;
      }

      case 'zCrumbs': {
        // Breadcrumb navigation (multi-trail support)
        this.logger.log('[renderZDisplayEvent]  zCrumbs case hit! eventData:', eventData);
        const navRenderer = await this.client._ensureNavigationRenderer();
        this.logger.log('[renderZDisplayEvent]  NavRenderer ready, calling renderBreadcrumbs...');
        element = navRenderer.renderBreadcrumbs(eventData);
        this.logger.debug('[renderZDisplayEvent] Rendered breadcrumbs');
        break;
      }

      case 'zDash': {
        // Dashboard with sidebar navigation
        const DashboardRenderer = (await import('./dashboard_renderer.js')).default;
        const dashRenderer = new DashboardRenderer(this.logger, this.client);
        element = await dashRenderer.render(eventData, this.targetElement || null);
        this.logger.log('[renderZDisplayEvent] Rendered dashboard element');
        break;
      }

      case 'read_string':
      case 'read_password': {
        // Delegate to InputEventHandler
        element = await this.inputEventHandler.handleTextInput(event, eventData, parentElement);
        break;
      }

      case 'read_bool': {
        // Delegate to InputEventHandler
        element = await this.inputEventHandler.handleBoolInput(event, eventData, parentElement);
        break;
      }

      case 'selection': {
        // Delegate to InputEventHandler
        element = await this.inputEventHandler.handleSelection(event, eventData, parentElement);
        break;
      }

      case 'zTerminal': {
        // Code execution sandbox with syntax highlighting and Run button
        const terminalRenderer = await this.client._ensureTerminalRenderer();
        element = terminalRenderer.render(eventData);
        this.logger.log(`[renderZDisplayEvent] Rendered zTerminal: ${eventData.title || 'untitled'}`);
        break;
      }

      case 'error':
      case 'warning':
      case 'success':
      case 'info': {
        // zSignals — semantic status feedback (zTheme: zSignal + zSignal-*)
        const colorClass = getAlertColorClass(event);
        element = document.createElement('div');
        element.className = `zSignal ${colorClass}`;
        element.setAttribute('role', 'alert');
        element.textContent = eventData.content || '';
        if (eventData.indent > 0) {
          element.style.marginLeft = `${eventData.indent}rem`;
        }
        this.logger.log(`[renderZDisplayEvent] Rendered ${event} signal`);
        break;
      }

      default: {
        this.logger.warn(`Unknown zDisplay event: ${event}`);
        const { createDiv } = await import('../primitives/generic_containers.js');
        element = createDiv({
          class: 'zDisplay-unknown'
        });
        element.textContent = `[${event}] ${eventData.content || ''}`;
      }
    }

    return element;
  }

}

export default ZDisplayOrchestrator;

