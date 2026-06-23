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
import { getAlertColorClass } from '../../../zSys/theme/ztheme_utils.js';
import { zfuncSignalFrom } from '../feedback/zfunc_signal.js';

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

    // Map of zfunc requestId → { inputEl, sendResponse } for in-flight input prompts
    this._pendingZFuncInputs = new Map();

    // Register WebSocket hooks for zFunc execution
    client.hooks.register('onZFuncInput', (msg) => this._handleZFuncInput(msg));
    client.hooks.register('onZFuncResponse', (msg) => this._handleZFuncResponse(msg));

    // Map of zfunc requestId → resolve callback (for _executeZFunc promise)
    this._zfuncResolvers = new Map();
  }

  /**
   * Render an entire zVaF block from YAML data
   * @param {Object} blockData - Block configuration from YAML
   */
  async renderBlock(blockData) {
    // Full block render = full navigation; reset any scoped render-target so the
    // next chunk stream targets the freshly rendered DOM, not a stale pane/host.
    this.client._renderTarget = null;
    // Use stored reference (set by _initZVaFElements)
    const contentElement = this.client._zVaFElement;
    if (!contentElement) {
      throw new Error('zVaF element not initialized');
    }

    // Clear existing content
    contentElement.innerHTML = '';

    // Block-level metadata wrapper. SSOT: the _zHTML/_zClass/_zStyle/zId rules
    // live in MetadataProcessor.applyMetadata — the same path zKey containers use —
    // so blocks, keys, and events all read styling identically (no per-tier idiom).
    let blockWrapper = contentElement;
    if (blockData && typeof blockData === 'object' && this.metadataProcessor.hasBlockMetadata(blockData)) {
      const blockMeta = this.metadataProcessor.extractMetadata(blockData);
      const blockName = this.options.zBlock || 'zBlock';
      const blockLevelDiv = createSemanticElement(blockMeta._zHTML || 'div', {}, this.logger);
      this.metadataProcessor.applyMetadata(blockLevelDiv, blockMeta);
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
   * SSOT render-target resolver — decides WHERE the next walker output paints.
   * Returns a descriptor: { el, mode: 'replace'|'append', restoreNodes?, once }.
   *
   * Priority:
   *   1. Explicit client._renderTarget (still attached to the DOM) — set by a
   *      producer: zDelegate inline (host + restoreNodes, once) or zDash panel
   *      (the exact pane element, persistent).
   *   2. Auto-detect the active zDash pane (legacy #dashboard-panel-content).
   *   3. zVaF root.
   *
   * Keeping the auto-detect as a fallback means a producer that forgets to set
   * the target never regresses to a broken render.
   * @returns {{el: HTMLElement, mode: string, restoreNodes?: Node[], once: boolean}}
   */
  _resolveRenderTarget() {
    const rt = this.client._renderTarget;
    if (rt && rt.el && document.contains(rt.el)) {
      return { mode: 'replace', once: false, ...rt };
    }
    const pane = document.querySelector('.zDash-panel .zTab-pane.zActive')
      || document.getElementById('dashboard-panel-content');
    if (pane) return { el: pane, mode: 'replace', once: false };
    return { el: this.client._zVaFElement, mode: 'replace', once: false };
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

      // SSOT render-target: a single descriptor decides WHERE the chunk paints.
      // Producers set client._renderTarget — zDelegate inline (host + restore,
      // once) or zDash panel (the exact pane, persistent). The resolver prefers
      // it, then auto-detects the active dash pane, then the zVaF root. zDelegate
      // is just the render-target + restore variant of the same primitive.
      const renderTarget = this._resolveRenderTarget();
      const contentDiv = renderTarget.el;

      if (!contentDiv) {
        throw new Error('zVaF element not initialized. Ensure _initZVaFElements() was called.');
      }

      // Check if data has block-level metadata (_zClass, _zStyle, etc.)
      const hasBlockMetadata = data && Object.keys(data).some(k => k.startsWith('_'));

      // Determine the target container for rendering
      let targetContainer = contentDiv;

      // Clear loading state on first chunk (skip when the target is append-mode,
      // e.g. a future accretion surface). Default mode is 'replace'.
      if (chunk_num === 1 && renderTarget.mode !== 'append') {
        contentDiv.innerHTML = '';
        this.logger.debug('[ZDisplayOrchestrator] Cleared loading state');
      }

      if (hasBlockMetadata && chunk_num === 1) {
        // First chunk with block metadata: create a wrapper for the entire block
        const blockName = message.zBlock || 'progressive';  // Use block name from backend
        
        // Block-level metadata wrapper — same SSOT path as renderBlock / zKeys
        // (MetadataProcessor.applyMetadata handles _zHTML/_zClass/_zStyle/zId).
        const blockMeta = this.metadataProcessor.extractMetadata(data);
        const blockWrapper = createSemanticElement(blockMeta._zHTML || 'div', {}, this.logger);
        this.metadataProcessor.applyMetadata(blockWrapper, blockMeta);
        blockWrapper.setAttribute('data-zblock', 'progressive');
        blockWrapper.setAttribute('id', blockName);

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
        // Progressive section render: a zOS page is a list of top-level sections,
        // and we know the count from the declarative structure. Paint them one at
        // a time, yielding to the browser between each, and report progress on the
        // badge ("Rendering k/N"). The page visibly paints in — and the user feels
        // it loading, which is the point.
        //
        // Guarded: only the plain "section list" shape is safe to split. Gated
        // wizards (whole-dict gate detection), root-level ~menus (option content
        // lives in sibling keys), and grouped blocks must render holistically — so
        // they keep the exact current path. Single-section chunks aren't worth it.
        const _topKeys = Object.keys(data).filter(k => !k.startsWith('_'));
        const _meta = this.metadataProcessor.extractMetadata(data);
        const _canSplit = _topKeys.length > 1
          && !this.wizardGateHandler.detectGateStep(data)
          && !this.groupRenderer.shouldRenderAsGroup(_meta)
          && !_topKeys.some(k => k.startsWith('~'));

        if (_canSplit) {
          const _total = _topKeys.length;
          let _done = 0;
          for (const _k of _topKeys) {
            await this.renderItems({ [_k]: data[_k] }, targetContainer);
            _done += 1;
            try { await this.client._updateRenderState({ current: _done, total: _total }); }
            catch (_e) { /* badge is best-effort chrome — never block render */ }
            // Yield so the section paints and the badge updates before the next.
            await new Promise(r => requestAnimationFrame(() => r()));
          }
          // Page painted in full → snap the badge back to the connected state.
          try { await this.client._updateRenderState({ done: true }); } catch (_e) { /* best-effort */ }
        } else {
          await this.renderItems(data, targetContainer);
        }
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

        // once-target (zDelegate inline): if it carried restoreNodes, append a Back
        // affordance that restores the carrier's original nodes (avatar img + Edit
        // Picture button) in place, then clear the target so the next render
        // targets the panel/root normally.
        if (renderTarget.once) {
          if (Array.isArray(renderTarget.restoreNodes)) {
            this._appendInlineDelegateBack(targetContainer, {
              host: renderTarget.el,
              restoreNodes: renderTarget.restoreNodes,
            });
          }
          this.client._renderTarget = null;
        }
      } else {
        this.logger.warn(`[ZDisplayOrchestrator] [WARN] Chunk #${chunk_num} has no YAML data to render`);
        if (renderTarget.once) this.client._renderTarget = null;
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

    // Track option keys that belong to a ~* menu — skip their sibling content rendering
    // Include modifier-prefixed variants (^opt, $opt) used for bounce/anchor semantics
    const menuOptionKeys = new Set();
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('~') && k.includes('*') && Array.isArray(v)) {
        v.forEach(opt => {
          if (typeof opt !== 'string') return;
          menuOptionKeys.add(opt);
          menuOptionKeys.add('^' + opt);
          menuOptionKeys.add('$' + opt);
        });
      }
    }

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
        // Menu shorthand: ~Key* with array of option strings
        // Expand to zMenu structure using sibling content — SSOT: identical to longhand zMenu
        if (key.includes('*') && Array.isArray(value) && value.every(item => typeof item === 'string')) {
          const cleanKey = key.replace(/[~*^$]/g, '').trim();
          // Track which options came from ^-prefixed keys (bounce semantics in Bifrost)
          const bounceOptions = new Set(
            value.filter(opt => typeof opt === 'string' && data['^' + opt] !== undefined)
          );
          const menuValue = {
            title: cleanKey.replace(/_/g, ' '),
            options: value,
            bounceOptions,
            // Option content may be stored under ^opt ($opt, opt) — try all modifier variants
            ...Object.fromEntries(value.map(opt => {
              const val = data[opt] ?? data['^' + opt] ?? data['$' + opt] ?? data['~' + opt];
              return [opt, val];
            }).filter(([, v]) => v !== undefined)),
          };
          await this._renderZMenuBlock(cleanKey, menuValue, parentElement, keyPath);
          continue;
        }
        // Other ~ metadata keys - skip
        continue;
      }

      // Skip option keys that are sibling content of a ~* menu
      if (menuOptionKeys.has(key)) {
        continue;
      }

      // Skip ONLY metadata attributes (not terminal-suppressed elements)
      // _zClass, _zStyle, _zHTML, _zId, _zScripts are metadata attributes applied to parent
      // But _Demo_Stack, _Live_Demo_Section are terminal-suppressed elements that SHOULD render in Bifrost
      const METADATA_KEYS = ['_zClass', '_zStyle', '_zHTML', '_zId', 'zScripts', '_zScripts', 'zId'];
      if (METADATA_KEYS.includes(key)) {
        continue;
      }

      // onChange is a declarative event binding (consumed at input render / stamped
      // server-side into the input as zapi_url), never renderable content. Skip it so
      // its zAPI/zFunc payload never paints or executes at render time.
      if (key === 'onChange') {
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

      // zLink: fire navigation immediately — mirrors CLI redirect semantics
      if (key === 'zLink') {
        const path = typeof value === 'string' ? value : (value.zLink || '');
        if (path) {
          this.logger.debug(`[ZDisplayOrchestrator] zLink redirect: ${path}`);
          this.client.zLink(path);
        }
        continue;
      }

      // zDelta: intra-file block hop — send execute_walker for the named block
      if (key === 'zDelta') {
        const blockName = typeof value === 'string' ? value : (value.zDelta || '');
        if (blockName) {
          this.logger.debug(`[ZDisplayOrchestrator] zDelta hop: ${blockName}`);
          this.client.zDelta(blockName);
        }
        continue;
      }

      // zLogger: app-level log — output to browser console (mirrors backend zos.app.log)
      if (key === 'zLogger') {
        let msg = '', level = 'INFO';
        if (typeof value === 'string') {
          msg = value;
        } else if (value && typeof value === 'object') {
          msg   = String(value.message || '');
          level = String(value.level  || 'INFO').toUpperCase();
        }
        if (msg) {
          if      (level === 'ERROR' || level === 'CRITICAL') console.error('[zLog]', msg);
          else if (level === 'WARNING')                        console.warn('[zLog]',  msg);
          else if (level === 'DEBUG')                         console.debug('[zLog]', msg);
          else                                                console.log('[zLog]',   msg);
        }
        continue;
      }

      // zMenu: route through unified renderer (same path as ~* shorthand)
      if (key === 'zMenu') {
        await this._renderZMenuBlock(key, value, parentElement, keyPath);
        continue;
      }

      // zDialog: flat top-level form spec (e.g. the ^Edit_Profile block streams
      // `zDialog: {title, model, fields, onSubmit, _dialogId}` as a direct key —
      // not wrapped as value.zDialog). Render it as an inline form. Without this,
      // the spec falls through to the generic object recursion and paints nothing.
      if (key === 'zDialog' && value && typeof value === 'object') {
        const formRenderer = await this.client._ensureFormRenderer();
        const formElement = formRenderer.renderForm(value);
        if (formElement) parentElement.appendChild(formElement);
        continue;
      }

      // zProgress as a sibling of an action (zFunc) is an action-property — the
      // bar is owned/drawn by _executeZFunc, never as standalone content. Skip it
      // here so it doesn't fall through to generic rendering and paint junk.
      // (Wizard zProgress arrives pre-expanded as {event: progress_bar}, not this key.)
      if (key === 'zProgress' && (data.zFunc || data.zfunc)) {
        continue;
      }

      // zFunc: execute a @zfunc plugin call and render result inline.
      // Two grammars, parsed identically:
      //   sibling — zFunc: &plugin()  +  zProgress: true   (zProgress on `data`)
      //   nested  — zFunc: { src: &plugin(), zProgress: true|{label,color} }
      // A zProgress (true | {label,color}) turns the ⏳ spinner into a live
      // indeterminate bar for the duration of the backend call.
      if (key === 'zFunc' || key === 'zfunc') {
        const isObj    = value && typeof value === 'object' && !Array.isArray(value);
        const funcStr  = isObj ? String(value.src ?? '') : String(value);
        const progress = (isObj ? value.zProgress : undefined) ?? data.zProgress ?? null;
        await this._executeZFunc(funcStr, parentElement, progress);
        continue;
      }

      // zH0–zH6 shorthand: stored as raw YAML in menu option content (not pre-expanded)
      const headerShorthand = key.match(/^zH([0-6])$/);
      if (headerShorthand) {
        const indent = parseInt(headerShorthand[1]);
        const label = typeof value === 'string'
          ? value
          : (value?.label || value?.content || key.replace(/_/g, ' '));
        const hEvt = { event: 'header', label, indent };
        if (value?.color) hEvt.color = value.color;
        const el = await this.renderZDisplayEvent(hEvt, parentElement);
        if (el) parentElement.appendChild(el);
        continue;
      }

      // zText shorthand: inline text paragraph — render directly, no event dispatch
      if (key === 'zText' && value) {
        const content    = typeof value === 'string' ? value : (value?.content || '');
        const color      = value?.color;
        const extraClass = (!Array.isArray(value) && value?._zClass) ? String(value._zClass) : '';
        const p = document.createElement('p');
        p.className = ['zText', 'zmy-1', extraClass].filter(Boolean).join(' ');
        p.textContent = content;
        if (color) p.classList.add(`zText-${color.toLowerCase()}`);
        parentElement.appendChild(p);
        continue;
      }

      // Create container wrapper for this zKey (zTheme responsive layout)
      const containerDiv = await this.createContainer(key, itemMetadata);

      // Give container a data attribute for debugging
      containerDiv.setAttribute('data-zkey', key);
      // Set id for DevTools navigation and CSS targeting (unless custom zId provided)
      if (!itemMetadata.zId) {
        containerDiv.setAttribute('id', key);
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
        // Collapsed single-child container: the backend merges a styled wrapper
        // (e.g. Demo {_zClass: zc-render, zIcon}) into one flat event, so _zClass
        // lands on BOTH the container div (itemMetadata) and the event. For an
        // inline icon that double-boxes the glyph — the container already owns the
        // frame, so render the icon bare inside it.
        let evtData = value;
        if (value.event === 'icon' && (itemMetadata._zClass || itemMetadata._zStyle)) {
          evtData = { ...value };
          delete evtData._zClass;
          delete evtData._zStyle;
        }
        const element = await this.renderZDisplayEvent(evtData, containerDiv);
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
          // Nested structure — pre-append to parent BEFORE recursing so that any
          // async children (e.g. _executeZFunc) can find DOM elements via querySelector
          // or direct reference while the tree is being built.
          if (key.startsWith('_')) {
            this.logger.log(` [NON-GROUP] Processing organizational container: ${key}, nested keys:`, Object.keys(value));
          } else {
            this.logger.debug(`[ZDisplayOrchestrator] Recursing into nested object: %s`, key, Object.keys(value));
          }
          parentElement.appendChild(containerDiv);
          await this.renderItems(value, containerDiv, keyPath);
          if (key.startsWith('_') && containerDiv.children.length > 0) {
            this.logger.log(`[NON-GROUP] Rendered organizational container ${key} with ${containerDiv.children.length} children`);
          }
          continue; // already appended — skip deferred append below
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
   * Unified zMenu block renderer — single code path for both longhand zMenu key
   * and ~Key* shorthand. menuValue = { title, options: [...], [optKey]: content, ... }
   */
  async _renderZMenuBlock(menuKey, menuValue, parentElement, keyPath) {
    this.logger.debug('[ZDisplayOrchestrator] Rendering zMenu block:', menuKey);
    const options = Array.isArray(menuValue.options) ? menuValue.options : [];
    const bounceOptions = menuValue.bounceOptions instanceof Set ? menuValue.bounceOptions : new Set();
    const title = menuValue.title || null;

    const containerDiv = document.createElement('div');
    containerDiv.setAttribute('data-zkey', menuKey);
    containerDiv.setAttribute('id', menuKey);

    if (title) {
      const titleEl = document.createElement('p');
      titleEl.className = 'zText-muted zSmall zmb-1';
      titleEl.textContent = title;
      containerDiv.appendChild(titleEl);
    }

    const nav = document.createElement('nav');
    nav.className = 'zMenu-nav zmb-2';
    nav.setAttribute('role', 'menu');
    if (title) nav.setAttribute('aria-label', title);

    const ul = document.createElement('ul');
    ul.className = 'zNavbar-nav zd-flex zflex-column zgap-1 list-unstyled zm-0 zp-0';
    nav.appendChild(ul);
    containerDiv.appendChild(nav);

    const placeholders = {};
    options.forEach(optKey => {
      const ph = document.createElement('div');
      ph.className = 'zMenu-option-content';
      ph.style.display = 'none';
      ph.dataset.menuContent = optKey;
      placeholders[optKey] = ph;
      containerDiv.appendChild(ph);
    });

    // Reset menu to neutral — deselect all buttons, hide all content
    const resetMenu = () => {
      ul.querySelectorAll('button[data-key]').forEach(b => b.classList.remove('active'));
      options.forEach(k => {
        const ph = placeholders[k];
        if (ph) { ph.style.display = 'none'; ph.innerHTML = ''; delete ph.dataset.rendered; }
      });
    };

    options.forEach((optKey, idx) => {
      const li = document.createElement('li');
      li.className = 'zNav-item';

      const btn = document.createElement('button');
      btn.className = 'zNav-link zBtn w-100 text-start zp-2';
      btn.setAttribute('role', 'menuitem');
      btn.dataset.key = optKey;
      // Strip the leading delta/bounce/anchor modifier ($ ^ ~) so the visible
      // label reads cleanly ("$Edit_Profile" → "Edit Profile"). The raw optKey is
      // preserved on data-key for selection/resolution.
      const label = menuValue.labels?.[optKey] ?? optKey.replace(/^[$^~]+/, '').replace(/_/g, ' ');
      btn.innerHTML = `<span class="zBadge zBadge-secondary zme-2">${idx + 1}</span>${label}`;

      btn.addEventListener('click', async () => {
        // Guard: prevent re-entry while a zfunc is already in-flight for this option
        if (btn.dataset.zfuncInFlight === '1') return;

        // ── Server-driven menu (SSOT) ─────────────────────────────────────
        // The menu carries a _menuId: its option content was deliberately NOT
        // shipped (server owns the flow). Send the pick back; the server resumes
        // the executor at the chosen key and falls through the siblings, streaming
        // the result into this option's placeholder. The JS never decides flow.
        if (menuValue._menuId) {
          resetMenu();
          btn.classList.add('active');
          const ph = placeholders[optKey];
          if (!ph) return;
          ph.style.display = 'block';
          ph.innerHTML = '';
          ph.dataset.rendered = '1';
          // Pin the resumed chunk(s) into this placeholder (replace, single-shot).
          this.client._renderTarget = { el: ph, mode: 'replace', once: true };
          const payload = {
            event: 'menu_selection',
            menu_id: menuValue._menuId,
            menu_key: menuKey,
            selected: optKey,
          };
          if (typeof this.client._sendWalker === 'function') {
            this.client._sendWalker(payload);
          } else {
            this.client.connection.send(JSON.stringify(payload));
          }
          return;
        }

        // No inline sibling content → the option is a $-reference to a SEPARATE
        // block (e.g. ~Profile_Actions* → ^Edit_Profile). Mirror CLI menu→block
        // selection: navigate in place via zDelta (same route, content swap). The
        // target block carries its own Back affordance (zDelegate $Profile).
        if (menuValue[optKey] === undefined) {
          const targetBlock = optKey.replace(/^[$^~]+/, '').trim();
          if (targetBlock && this.client?.zDelta) {
            this.logger.log('[ZMenu] option → zDelta block hop:', targetBlock);
            this.client.zDelta(targetBlock);
          }
          return;
        }

        resetMenu();
        btn.classList.add('active');

        const ph = placeholders[optKey];
        if (!ph) return;
        ph.style.display = 'block';

        ph.dataset.rendered = '1';
        const isBounce = bounceOptions.has(optKey);

        btn.dataset.zfuncInFlight = '1';
        try {
          // Temporarily override _executeZFunc to capture the zFunc result
          // so we can decide whether to show the Back button.
          let zfuncResult = null;
          const origExecuteZFunc = this._executeZFunc.bind(this);
          this._executeZFunc = async (funcStr, parentEl) => {
            const result = await origExecuteZFunc(funcStr, parentEl);
            zfuncResult = result;
            return result;
          };

          await this.renderItems({ [optKey]: menuValue[optKey] }, ph, [...keyPath, menuKey]);

          this._executeZFunc = origExecuteZFunc;

          if (isBounce) {
            // For ^ bounce options: show zBack button unless zFunc returned 'exit'
            const shouldBack = zfuncResult === null       // no zFunc (ungated) — always show Back
              || (zfuncResult !== 'exit' && zfuncResult !== false && zfuncResult !== null);

            if (shouldBack) {
              this._appendZBackButton(ph, resetMenu, btn);
            } else {
              // exit result: hide the content entirely
              ph.style.display = 'none';
              ph.innerHTML = '';
              delete ph.dataset.rendered;
              btn.classList.remove('active');
            }
          }
        } catch (e) {
          this._executeZFunc = origExecuteZFunc;
          this.logger.error(`[ZDisplayOrchestrator] zMenu option render error (${optKey}):`, e);
        } finally {
          delete btn.dataset.zfuncInFlight;
        }
      });

      li.appendChild(btn);
      ul.appendChild(li);
    });

    // Auto Back item for non-anchor (~ absent) menus — server signals via
    // _allowBack, mirroring the zCLI allow_back rule. Clicking it collapses the
    // drill-in this menu lives in, re-showing the parent menu (CLI: zBack from a
    // sub-menu returns to the parent menu).
    if (menuValue._allowBack) {
      const backLi = document.createElement('li');
      backLi.className = 'zNav-item';
      const backNav = document.createElement('button');
      backNav.className = 'zNav-link zBtn zW-100 zText-start zp-2';
      backNav.setAttribute('role', 'menuitem');
      backNav.dataset.key = 'zBack';
      backNav.innerHTML = `<span class="zBadge zBadge-secondary zme-2">${options.length + 1}</span>Back`;
      backNav.addEventListener('click', () => {
        const parentPh = containerDiv.closest('.zMenu-option-content');
        if (parentPh) {
          const ownerKey = parentPh.dataset.menuContent;
          const ownerContainer = parentPh.parentElement;
          parentPh.style.display = 'none';
          parentPh.innerHTML = '';
          delete parentPh.dataset.rendered;
          if (ownerContainer && ownerKey) {
            const ownerBtn = ownerContainer.querySelector(`button[data-key="${ownerKey}"]`);
            if (ownerBtn) ownerBtn.classList.remove('active');
          }
        } else {
          // Top-level non-anchor menu — nothing to collapse into; reset self.
          resetMenu();
        }
      });
      backLi.appendChild(backNav);
      ul.appendChild(backLi);
    }

    parentElement.appendChild(containerDiv);
  }

  /**
   * Append a "← Back" button to a menu option's content placeholder.
   * Clicking it resets the menu to neutral (no active option, content hidden).
   *
   * @param {HTMLElement} ph         - The option content placeholder div
   * @param {Function}    resetMenu  - Callback that deselects all options and hides content
   * @param {HTMLElement} activeBtn  - The currently active menu button (used for aria state)
   */
  _appendZBackButton(ph, resetMenu, activeBtn) {
    const backBtn = document.createElement('button');
    backBtn.className = 'zBtn zBtn-sm zBtn-outline-secondary zmt-3';
    backBtn.innerHTML = '← Back to menu';
    backBtn.addEventListener('click', () => {
      resetMenu();
    }, { once: true });
    ph.appendChild(backBtn);
  }

  /**
   * Append a Back affordance for an inline zDelegate. Clicking it restores the
   * carrier's original child nodes (saved live, so their listeners survive) into
   * the host container — collapsing the delegated section back to the carrier.
   * Uses the shared .acct-back-action styling + a stable hook class.
   * @param {HTMLElement} container - where the delegated fragment was rendered (the host)
   * @param {{host: HTMLElement, restoreNodes: Node[]}} inlineDelegate
   */
  _appendInlineDelegateBack(container, inlineDelegate) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'zBtn acct-back-action acct-inline-back zmt-3';
    backBtn.innerHTML = '← Back';
    backBtn.addEventListener('click', () => {
      const { host, restoreNodes } = inlineDelegate;
      if (host && Array.isArray(restoreNodes)) {
        host.replaceChildren(...restoreNodes);
      }
    }, { once: true });
    container.appendChild(backBtn);
  }

  /**
   * Loop a wizard in the inline-gate path back to an earlier step.
   *
   * The inline gate (stamped requestId + render_chunk reveal) has no
   * data-wizard-gate DOM, so restartWizardFromGate's selectors don't apply.
   * Instead we operate on the wizard container (nearest ancestor [data-zkey]
   * holding an input field): drop every appended reveal group, reset the
   * targeted step's input, and re-arm the gate button. The server re-parks the
   * gate (same requestId), so re-clicking the gate re-runs the post-gate steps.
   *
   * @param {string} actionStep - The step key the loop-back targets (e.g. Ask_Name)
   * @param {HTMLElement} btn - The clicked loop-back button
   * @private
   */
  _restartInlineWizard(actionStep, btn) {
    const fieldSel = 'input, textarea, select';

    // Climb to the wizard container: the nearest ancestor [data-zkey] that holds
    // an input field (mirrors button_renderer._collectInlineContext).
    let container = null;
    let node = btn.parentElement;
    while (node) {
      if (node.getAttribute && node.getAttribute('data-zkey') && node.querySelector(fieldSel)) {
        container = node;
        break;
      }
      node = node.parentElement;
    }
    if (!container) container = btn.closest('[data-zkey]');
    if (!container) {
      this.logger.warn('[WizardLoop] container not found for loop-back:', actionStep);
      return;
    }

    // Remove every revealed group (each gate resolve appended one). This also
    // removes the loop-back button itself — a fresh one renders on the next loop.
    container.querySelectorAll('.wizard-postgate').forEach((el) => el.remove());

    // Re-arm the gate: re-enable any disabled buttons left in the container
    // (the gate button keeps its click listener + requestId).
    container.querySelectorAll('button[disabled]').forEach((b) => { b.disabled = false; });

    // Reset the targeted step's input and focus it (CLI parity: loop to that step).
    const stepScope = container.querySelector(`[data-zkey="${actionStep}"]`);
    const stepInput = stepScope ? stepScope.querySelector(fieldSel) : null;
    if (stepInput) {
      stepInput.disabled = false;
      stepInput.value = '';
      setTimeout(() => stepInput.focus(), 50);
    }

    this.logger.log('[WizardLoop] Restarted inline wizard from step:', actionStep);
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
        this.wizardGateHandler.restartWizardFromGate(wizardAction);
      });
      hiddenBtn.dataset.zdelegateWired = 'true';
      this.logger.log('[Delegate] Button action → button wired:', wizardAction, '→', targetPath);
    }

    // ── Pass 0b: plain wizard-action button (loop-back, no delegate) ─────────
    // A post-gate `zBtn` with `action: <stepKey>` and no _zDelegate — the
    // "Run again?" / "Play again" loop-back. In the inline-gate path there is no
    // data-wizard-gate wrapper, so wire it to re-enter the wizard in place:
    // clear this reveal, reset the targeted step's input, re-arm the gate.
    const actionButtons = document.querySelectorAll(
      'button[data-wizard-action]:not([data-zdelegate]):not([data-wizard-action-wired])'
    );
    for (const btn of actionButtons) {
      const targetStep = btn.dataset.wizardAction;
      btn.dataset.wizardActionWired = 'true';
      btn.addEventListener('click', () => this._restartInlineWizard(targetStep, btn));
      this.logger.log('[Delegate] Wizard-action (loop-back) button wired:', targetStep);
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
    let isToast = false;

    switch (event) {
      case 'text': {
        // Use modular TypographyRenderer for text
        const textRenderer = await this.client._ensureTypographyRenderer();
        element = textRenderer.renderText(eventData);
        this.logger.log('[renderZDisplayEvent] Rendered text element');
        break;
      }

      case 'rich_text': {
        // Markdown fenced code blocks (```lang) inside zMD render here, not via
        // the 'code' event — so kick off Prism the same way when a fence is present.
        if (!this.client._prismLoaded && typeof eventData.content === 'string' && eventData.content.includes('```')) {
          this.client._prismLoaded = true;
          this.client._loadPrismJS();
        }
        // Use TextRenderer for rich text with markdown parsing
        const textRenderer = await this.client._ensureTextRenderer();
        element = textRenderer.renderRichText(eventData);
        this.logger.debug('[renderZDisplayEvent] Rendered rich_text element');
        break;
      }

      case 'code': {
        if (!this.client._prismLoaded) {
          this.client._prismLoaded = true;
          this.client._loadPrismJS();
        }
        const codeRenderer = await this.client._ensureCodeRenderer();
        element = codeRenderer.renderCode(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered code block (language: ${eventData.language || 'text'})`);
        break;
      }

      case 'json': {
        if (!this.client._prismLoaded) {
          this.client._prismLoaded = true;
          this.client._loadPrismJS();
        }
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

      case 'navbar_inline': {
        // Block-level (in-page) navbar rendered inline. The server (message_walker
        // ._inline_block_navbars) builds the bar HTML via build_nav_html — the SAME
        // SSOT as the chrome navbar — and ships it as `html`. We inject it and wire
        // the generic data-nav-action delegation (hamburger/dropdown/navigate).
        // zPsi items are emitted as native `#anchor` links (no data-nav-action), so
        // the browser scrolls to the matching section _zId for free.
        const wrapper = document.createElement('div');
        wrapper.className = eventData._zClass || 'zNavbar-inline-wrap';
        wrapper.innerHTML = eventData.html || '';
        const navEl = wrapper.querySelector('nav');
        if (navEl) {
          try {
            const { NavBarBuilder } = await import('../../../L3_Abstraction/orchestrator/navbar_builder.js');
            // scoped=true → an INLINE bar pick keeps the host page (SCOPED reset),
            // unlike the chrome bar which FULL-resets. SSOT with zCLI inline navbar.
            NavBarBuilder.wireNavBarEvents(navEl, this.client, this.logger, true);
          } catch (err) {
            this.logger.warn('[renderZDisplayEvent] navbar_inline wiring skipped:', err);
          }
        }
        element = wrapper;
        this.logger.debug('[renderZDisplayEvent] Rendered navbar_inline');
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

      case 'progress_bar':
      case 'progress_complete': {
        // Declarative zProgress (expands to {event: progress_bar}). Build inline
        // and return the node — the same place/return contract as image/table —
        // so it renders in the page flow instead of self-appending to <body>.
        const progressRenderer = await this.client._ensureProgressBarRenderer();
        element = progressRenderer.renderInline(eventData);
        this.logger.debug('[renderZDisplayEvent] Rendered progress bar (inline)');
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

      case 'video': {
        // Use modular VideoRenderer for inline <video controls>
        const videoRenderer = await this.client._ensureVideoRenderer();
        element = videoRenderer.render(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered video: ${eventData.src}`);
        break;
      }

      case 'audio': {
        // Use modular AudioRenderer for inline <audio controls>
        const audioRenderer = await this.client._ensureAudioRenderer();
        element = audioRenderer.render(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered audio: ${eventData.src}`);
        break;
      }

      case 'embed': {
        // Modular EmbedRenderer builds a sandboxed <iframe> from the server's
        // vetted payload (src/sandbox/allow already trust-gated server-side).
        const embedRenderer = await this.client._ensureEmbedRenderer();
        element = embedRenderer.render(eventData);
        this.logger.debug(`[renderZDisplayEvent] Rendered embed: ${eventData.src}`);
        break;
      }

      case 'icon': {
        // Use modular IconRenderer for Bootstrap Icons
        const iconRenderer = await this.client._ensureIconRenderer();
        // Return the renderer's own node (bare <i>, or a styled <span>) directly —
        // no extra empty wrapper. This lets the container-unwrapper collapse a
        // redundant parent frame (e.g. a single-child zc-render Demo) by class match.
        element = iconRenderer.render(eventData);
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
        // Dashboard with sidebar navigation.
        // We pass parentElement so DashboardRenderer appends #dashboard-panel-content to the
        // DOM immediately — the default panel WS request fires INSIDE render(), and by the
        // time the WS response arrives the element must already be queryable.
        const DashboardRenderer = (await import('../composite/dashboard_renderer.js')).default;
        const dashRenderer = new DashboardRenderer(this.logger, this.client);
        await dashRenderer.render(eventData, parentElement);
        element = null; // already appended by DashboardRenderer
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
        if (!this.client._prismLoaded) {
          this.client._prismLoaded = true;
          this.client._loadPrismJS();
        }
        // Code execution sandbox with syntax highlighting and Run button
        const terminalRenderer = await this.client._ensureTerminalRenderer();
        element = terminalRenderer.render(eventData);
        this.logger.log(`[renderZDisplayEvent] Rendered zTerminal: ${eventData.title || 'untitled'}`);
        break;
      }

      case 'error':
      case 'warning':
      case 'success':
      case 'info':
      case 'primary':
      case 'secondary': {
        // zSignals — semantic status feedback (zTheme: zSignal + zSignal-*).
        // Bifrost renders every signal as a dismissible card (.zAlert box + ×),
        // in flow by default. flush:true promotes it to an out-of-flow timed
        // TOAST (.zToast) in the top-right stack. Colour single-sourced from
        // .zSignal-*; the terminal still prints a plain colored line.
        const colorClass = getAlertColorClass(event);
        // zFunc result flushes get the roomy, code-like card (header + code/prose
        // body); every other signal stays the compact inline .zAlert row.
        if (eventData.result) {
          element = this._buildZFuncResultCard(event, colorClass, eventData);
        } else {
          element = document.createElement('div');
          element.className = `zSignal ${colorClass} zAlert`;
          element.setAttribute('role', 'alert');

          const msgEl = document.createElement('span');
          msgEl.className = 'zSignal-text';
          msgEl.textContent = eventData.content || '';
          element.appendChild(msgEl);

          const closeEl = document.createElement('button');
          closeEl.type = 'button';
          closeEl.className = 'zSignal-close';
          closeEl.setAttribute('aria-label', 'Dismiss');
          closeEl.textContent = '×';
          closeEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this._dismissSignal(element);
          });
          element.appendChild(closeEl);
        }

        if (eventData.indent > 0) {
          element.style.marginLeft = `${eventData.indent}rem`;
        }
        if (eventData.flush) {
          element.classList.add('zToast');
          isToast = true;
        }
        this.logger.log(`[renderZDisplayEvent] Rendered ${event} signal${isToast ? ' (toast)' : ''}`);
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

    // ── SSOT: universal _zClass / _zStyle for EVERY event ────────────────────
    // The same applyMetadata path zBlocks and zKeys use, in APPEND mode so the
    // renderer's intrinsic classes (zText, bi-*, zTable …) survive. This is the
    // single place a LEAF event's styling is applied; per-renderer _zClass/_zStyle
    // handling is retired in favour of this. `color` stays contextual
    // (zText-* vs zBtn-* vs zSignal-*) and remains owned by each renderer.
    //
    // Composite renderers (media-with-caption → <figure>, zTable → wrapper) return
    // a wrapper but intentionally place _zClass on an INNER element; they mark the
    // wrapper `__zMetaScoped` so we skip it here and don't mis-target the frame.
    if (element && element.nodeType === Node.ELEMENT_NODE && !element.__zMetaScoped && eventData && typeof eventData === 'object') {
      this.metadataProcessor.applyMetadata(
        element,
        { _zClass: eventData._zClass, _zStyle: eventData._zStyle },
        null,
        this.logger,
        { append: true }
      );
    }

    // flush:true signals are out of flow — portal into the toast stack and
    // return null so the caller never appends them inline. _zClass (applied
    // above) still lands on the toast element before it floats.
    if (isToast && element) {
      this._showSignalToast(element);
      return null;
    }

    return element;
  }

  /**
   * Build the roomy, code-like zFunc result card (header strip + body). Used for
   * zFunc return signals only (eventData.result); structured data renders as a
   * syntax-tinted code block, a scalar/message as prose. Styling is SSOT in
   * zbase.css (.zAlert-result / .zResult-*). Colour from .zSignal-*.
   * @private
   */
  _buildZFuncResultCard(event, colorClass, eventData) {
    const GLYPHS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ', primary: '•', secondary: '•' };
    const card = document.createElement('div');
    card.className = `zSignal ${colorClass} zAlert-result`;
    card.setAttribute('role', 'alert');

    const head = document.createElement('div');
    head.className = 'zResult-head';
    const glyph = document.createElement('span');
    glyph.className = 'zResult-glyph';
    glyph.textContent = GLYPHS[event] || '•';
    const label = document.createElement('span');
    label.textContent = event;
    head.appendChild(glyph);
    head.appendChild(label);

    const closeEl = document.createElement('button');
    closeEl.type = 'button';
    closeEl.className = 'zSignal-close';
    closeEl.setAttribute('aria-label', 'Dismiss');
    closeEl.textContent = '×';
    closeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this._dismissSignal(card);
    });
    head.appendChild(closeEl);
    card.appendChild(head);

    const content = eventData.content || '';
    if (eventData.format === 'code') {
      const pre = document.createElement('pre');
      pre.className = 'zResult-code';
      pre.innerHTML = this._highlightJSON(content); // content is escaped inside
      card.appendChild(pre);
    } else {
      const msg = document.createElement('div');
      msg.className = 'zResult-msg';
      msg.textContent = content;
      card.appendChild(msg);
    }
    return card;
  }

  /**
   * Minimal, XSS-safe JSON syntax highlighter: escape first, then wrap tokens in
   * tinted spans (.tok-key / .tok-str / .tok-num / .tok-pun). Input is already a
   * pretty-printed JSON string (from zfuncSignalFrom). Returns innerHTML-ready.
   * @private
   */
  _highlightJSON(str) {
    const esc = String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc.replace(
      /("(\\.|[^"\\])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (m) => {
        let cls = 'tok-num';
        if (/^"/.test(m)) cls = /:\s*$/.test(m) ? 'tok-key' : 'tok-str';
        else if (/true|false|null/.test(m)) cls = 'tok-pun';
        return `<span class="${cls}">${m}</span>`;
      }
    );
  }

  /**
   * Lazily create the fixed-corner toast stack (SSOT styling in zbase.css).
   * Lives under <zVaF> so it shares the bifrost chrome root.
   * @private
   */
  _ensureToastContainer() {
    let container = document.getElementById('zToast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'zToast-container';
      container.className = 'zToast-container';
      const root = document.querySelector('zVaF') || document.body;
      root.appendChild(container);
    }
    return container;
  }

  /**
   * Float a flush signal as a timed toast: append to the stack, auto-dismiss
   * after `timeout`ms (the × dismisses early). Animation is canonical CSS.
   * @private
   */
  _showSignalToast(element, timeout = 5000) {
    const container = this._ensureToastContainer();
    container.appendChild(element);
    setTimeout(() => this._dismissSignal(element), timeout);
  }

  /**
   * Dismiss a signal card with the matching exit animation, then remove it.
   * Toasts slide out; in-flow cards fade. Idempotent.
   * @private
   */
  _dismissSignal(element) {
    if (!element || !element.parentNode) return;
    const out = element.classList.contains('zToast') ? 'zToast-out' : 'zSignal-out';
    element.classList.add(out);
    setTimeout(() => { if (element.parentNode) element.remove(); }, 250);
  }

  // ─── zFunc execution ────────────────────────────────────────────────────────

  /**
   * Execute a @zfunc plugin call via WebSocket and render the result inline.
   *
   * Flow:
   *   1. Render a spinner placeholder in parentElement
   *   2. Send execute_zfunc { zfunc, requestId } over WebSocket
   *   3. If the plugin calls input(), the backend emits request_input with
   *      zfuncRequestId — handled by _handleZFuncInput (renders inline widget)
   *   4. When the plugin finishes, backend sends execute_zfunc_response —
   *      handled by _handleZFuncResponse (resolves the promise here)
   *   5. Replace spinner with result text (or error)
   *
   * @param {string} funcStr  - Plugin invocation string, e.g. "&confirm.ask()"
   * @param {HTMLElement} parentElement - DOM node to append output into
   */
  /**
   * Build a live CSS border-spinner row (zProgress type: spinner) with a ticking
   * elapsed readout. Mirrors SpinnerRenderer's markup (zSpinner-border + label)
   * so the look matches the streamed-spinner SSOT; color is pinned to the same
   * --color-* tokens the progress bar uses (so secondary/info/etc. tint reliably).
   * @returns {{bar: HTMLElement, ticker: number|null}}
   */
  _buildSpinnerProgress(label, color) {
    const COLOR_VARS = {
      primary: '--color-primary', secondary: '--color-secondary',
      success: '--color-success', info: '--color-info',
      warning: '--color-warning', danger: '--color-error', error: '--color-error',
    };
    const row = document.createElement('div');
    row.className = 'zSpinner-container zD-flex zFlex-items-center zGap-2 zMy-2';

    const spin = document.createElement('div');
    spin.className = `zSpinner-border zText-${color}`;
    spin.setAttribute('role', 'status');
    const varName = COLOR_VARS[String(color).toLowerCase()];
    if (varName) spin.style.color = `var(${varName})`;

    const lbl = document.createElement('span');
    lbl.className = 'zSpinner-label zText-muted';
    lbl.textContent = label;  // STEPS/percent only — never seconds

    row.appendChild(spin);
    row.appendChild(lbl);
    return { bar: row };
  }

  async _executeZFunc(funcStr, parentElement, progressSpec = null, opts = {}) {
    // opts.button: the originating zBtn to free up (disable→run→re-enable). It is
    // the SSOT for the busy lifecycle of a server &. action button, so the button
    // can't stay stuck after success OR fail. opts.quiet: plain action buttons
    // surface the result as a toast (smart policy) instead of an inline wrapper.
    const { button = null, quiet = false } = opts;
    const reenable = () => {
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    };

    if (!funcStr.startsWith('&')) {
      this.logger.warn('[ZFunc] Skipping non-plugin zFunc value:', funcStr);
      reenable();
      return;
    }

    const requestId = `zfunc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Spinner placeholder — replaced when response arrives (kept empty when quiet;
    // it still anchors any inline input() prompt during execution).
    const wrapper = document.createElement('div');
    wrapper.className = 'zfunc-wrapper zmy-2';
    wrapper.dataset.zfuncRequestId = requestId;

    // zProgress sibling → render the SAME probe count, two looks (no marquee, no
    // seconds — steps/percent only). The probe walks zDispatch → zFunc, so a
    // direct action is 2 stops: dispatch lands the moment we send, then the
    // plugin runs server-side as a black box until the response. So the bar sits
    // at 1/2 (50%) while it runs — exactly like zCLI — and clears to the result.
    //   - type: bar (default) → a real, determinate progress bar.
    //   - type: spinner       → an animated glyph.
    const progressTicker = null;
    if (progressSpec) {
      const spec = (typeof progressSpec === 'object') ? progressSpec : {};
      const label = spec.label || 'Working…';
      const color = spec.color || 'primary';
      const ptype = String(spec.type || 'bar').toLowerCase();
      try {
        if (ptype === 'spinner') {
          const { bar } = this._buildSpinnerProgress(label, color);
          wrapper.appendChild(bar);
        } else {
          const progressRenderer = await this.client._ensureProgressBarRenderer();
          const bar = progressRenderer.renderInline({
            progressId: `zfunc-progress-${requestId}`,
            label, color,
            current: 1,      // dispatch cleared
            total: 2,        // zDispatch → zFunc (probe stops)
            striped: false,
            animated: false,
            showPercentage: true,  // percent, never seconds
          });
          if (bar) wrapper.appendChild(bar);
        }
      } catch (err) {
        this.logger.warn('[ZFunc] Progress indicator unavailable:', err);
      }
    }

    if (!quiet && !wrapper.firstChild) {
      const spinner = document.createElement('span');
      spinner.className = 'zText-muted zSmall';
      spinner.textContent = '⏳ Running…';
      wrapper.appendChild(spinner);
    }
    parentElement.appendChild(wrapper);

    // Register wrapper reference for _handleZFuncInput (direct ref, not DOM query)
    this._pendingZFuncInputs.set(requestId, wrapper);

    // Register resolve callback — _handleZFuncResponse will call it
    const responsePromise = new Promise((resolve) => {
      this._zfuncResolvers.set(requestId, resolve);
    });

    // Send execute_zfunc to backend
    try {
      this.client.connection.send(JSON.stringify({
        event: 'execute_zfunc',
        zfunc: funcStr,
        requestId,
      }));
    } catch (err) {
      this.logger.error('[ZFunc] Failed to send execute_zfunc:', err);
      if (progressTicker) clearInterval(progressTicker);
      if (quiet) { wrapper.remove(); } else {
        wrapper.innerHTML = `<span class="zText-danger zSmall">⚠ Failed to start: ${err.message}</span>`;
      }
      this._zfuncResolvers.delete(requestId);
      reenable();
      return;
    }

    // Wait for backend response (resolved by _handleZFuncResponse)
    const response = await responsePromise;

    // Clean up pending reference
    this._pendingZFuncInputs.delete(requestId);

    // Stop the elapsed-time ticker before the bar is removed with the wrapper
    if (progressTicker) clearInterval(progressTicker);

    // Quiet (plain action button): no inline output — surface the result as a
    // toast via the shared smart policy, free the button, and we're done.
    if (quiet) {
      wrapper.remove();
      const sig = zfuncSignalFrom(response);
      if (sig) {
        Promise.resolve(this.renderZDisplayEvent({ event: sig.level, content: sig.text, flush: true, result: true, format: sig.format }))
          .catch((e) => this.logger.debug('[ZFunc] result toast skipped:', e));
      }
      reenable();
      return response.success ? (response.result ?? null) : null;
    }

    // Clear spinner / progress bar / input widget
    wrapper.innerHTML = '';

    if (response.success) {
      if (response.result) {
        const out = document.createElement('p');
        out.className = 'zfunc-result zmy-1';
        out.textContent = response.result;
        wrapper.appendChild(out);
      }
    } else {
      const err = document.createElement('span');
      err.className = 'zText-danger zSmall';
      err.textContent = `⚠ ${response.error || 'Unknown error'}`;
      wrapper.appendChild(err);
    }

    // Free the originating button (zProgress action buttons) on success OR fail.
    reenable();

    // Return the plugin result so callers (e.g. _renderZMenuBlock) can decide
    // whether to show a zBack button or hide the content (bounce vs exit semantics)
    return response.success ? (response.result ?? null) : null;
  }

  /**
   * Handle a request_input event scoped to a zFunc execution.
   * Renders an inline prompt widget inside the matching zfunc-wrapper div.
   *
   * For y/n prompts: two buttons (Yes / No).
   * For all other prompts: text input + Submit button.
   *
   * @param {Object} msg - WebSocket message with { requestId, prompt, zfuncRequestId }
   */
  _handleZFuncInput(msg) {
    const { requestId, prompt, zfuncRequestId } = msg;

    // Find wrapper via stored reference (direct ref avoids DOM query failure when
    // the wrapper's ancestor container hasn't been appended to the document yet)
    const wrapper = this._pendingZFuncInputs.get(zfuncRequestId)
      || document.querySelector(`[data-zfunc-request-id="${zfuncRequestId}"]`);
    if (!wrapper) {
      this.logger.warn('[ZFunc] No wrapper found for zfuncRequestId:', zfuncRequestId);
      return;
    }

    const sendResponse = (value) => {
      this.client.connection.send(JSON.stringify({
        event: 'input_response',
        requestId,   // backend's input request_id (routes to _pending_inputs)
        value,
      }));
      // Replace widget with "answered" indicator
      inputArea.innerHTML = `<span class="zText-muted zSmall">↩ ${value}</span>`;
    };

    // Build input widget
    const inputArea = document.createElement('div');
    inputArea.className = 'zfunc-input-area zp-2 zmt-1';

    const promptEl = document.createElement('p');
    promptEl.className = 'zSmall zmb-1';
    promptEl.textContent = prompt || 'Input required:';
    inputArea.appendChild(promptEl);

    // Generic zInput — SSOT: stdin maps to a plain text field regardless of prompt content
    const row = document.createElement('div');
    row.className = 'zd-flex zg-2 zalign-items-center';

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'zForm-control zForm-control-sm';
    textInput.placeholder = 'Enter value…';

    const submitBtn = document.createElement('button');
    submitBtn.className = 'zBtn zBtn-sm zBtn-primary';
    submitBtn.textContent = 'Submit';

    const submit = () => sendResponse(textInput.value.trim());

    submitBtn.addEventListener('click', submit, { once: true });
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    }, { once: true });

    row.appendChild(textInput);
    row.appendChild(submitBtn);
    inputArea.appendChild(row);

    // Replace spinner with input widget
    wrapper.innerHTML = '';
    wrapper.appendChild(inputArea);
  }

  /**
   * Handle execute_zfunc_response from backend — resolves the promise in _executeZFunc.
   *
   * @param {Object} msg - WebSocket message with { requestId, success, result?, error? }
   */
  _handleZFuncResponse(msg) {
    const resolve = this._zfuncResolvers.get(msg.requestId);
    if (!resolve) {
      this.logger.warn('[ZFunc] No resolver found for requestId:', msg.requestId);
      return;
    }
    this._zfuncResolvers.delete(msg.requestId);
    resolve(msg);
  }

}

export default ZDisplayOrchestrator;

