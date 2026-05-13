/**
 * WidgetHookManager - Registers all default widget hooks
 *
 * Responsibilities:
 * - Register onDisplay hook (auto-rendering)
 * - Register onRenderChunk hook (progressive rendering)
 * - Register onInput hook (input rendering)
 * - Register onProgressBar/onProgressComplete hooks
 * - Register onSpinnerStart/onSpinnerStop hooks
 * - Register onSwiperInit/onSwiperUpdate/onSwiperComplete hooks
 * - Register onZDash hook (dashboard rendering)
 *
 * Extracted from bifrost_client.js (Phase 3.4)
 */

export class WidgetHookManager {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
    this.hooks = client.hooks;
  }

  /**
   * Register all default widget hooks
   */
  async registerAllWidgetHooks() {
    let count = 0;
    
    await this.registerDisplayHook() && count++;
    await this.registerRenderChunkHook() && count++;
    await this.registerInputHook() && count++;
    count += await this.registerProgressBarHooks();
    count += await this.registerSpinnerHooks();
    count += await this.registerSwiperHooks();
    await this.registerDashboardHook() && count++;
    await this.registerWizardGateResultHook() && count++;
    
    this.logger.log(`[WidgetHookManager] Registered ${count} hooks`);
  }

  /**
   * Register onDisplay hook for auto-rendering
   */
  async registerDisplayHook() {
    if (!this.hooks.has('onDisplay')) {
      this.hooks.register('onDisplay', async (event) => {
        this.logger.debug('[WidgetHookManager] onDisplay triggered:', event.display_event || event.event);

        // Check if this is a zDialog event (form)
        if (event.event === 'zDialog' || event.display_event === 'zDialog') {
          this.logger.debug('[WidgetHookManager] zDialog event - routing to FormRenderer');
          this.logger.debug('[WidgetHookManager] Event structure:', event);
          await this.client._ensureFormRenderer();

          const formData = event.data || event;
          this.logger.debug('[WidgetHookManager] FormData passed to renderer:', formData);
          this.logger.debug('[WidgetHookManager] Has _dialogId?', formData._dialogId);
          const formElement = this.client.formRenderer.renderForm(formData);

          // Append form to appropriate container
          const rootZone = document.getElementById(this.client.options.targetElement);
          const containers = rootZone ? rootZone.querySelectorAll('.zContainer') : [];
          const targetZone = containers.length > 0 ? containers[containers.length - 1] : rootZone;

          if (targetZone) {
            targetZone.appendChild(formElement);
          }
        } else {
          // Regular zDisplay event - delegate to orchestrator
          await this.client._ensureZDisplayOrchestrator();
          await this.client.zDisplayOrchestrator.renderZDisplayEvent(event);
        }
      });
      return true;
    }
    return false;
  }

  /**
   * Register onRenderChunk hook for progressive rendering
   */
  async registerRenderChunkHook() {
    if (!this.hooks.has('onRenderChunk')) {
      this.hooks.register('onRenderChunk', async (message) => {
        this.logger.debug('[WidgetHookManager] onRenderChunk triggered: chunk', message.chunk_num);

        // CRITICAL: Render first, cache after
        await this.client._renderChunkProgressive(message);
        this.logger.debug('[WidgetHookManager] Chunk rendered, preparing to cache');

        // _zScripts are pre-loaded at init (bifrost_client.js). Guard kept as
        // fallback for edge cases where early load was skipped (e.g. config not yet ready).
        if (!this.client._zScriptsLoaded && message.chunk_num === 1) {
          this.logger.debug('[WidgetHookManager] First chunk rendered - loading _zScripts (fallback)');
          this.client._loadZScripts();
          this.client._zScriptsLoaded = true;
        }

        // Cache page after render (debounced)
        // FIX: Ensure DOM updates are flushed before caching
        if (this.client._cachePageTimeout) {
          clearTimeout(this.client._cachePageTimeout);
        }

        this.client._cachePageTimeout = setTimeout(async () => {
          // Wait for DOM updates to flush (requestAnimationFrame ensures rendering is complete)
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          
          if (this.client.cache && typeof document !== 'undefined') {
            try {
              const currentPage = window.location.pathname;
              const contentArea = this.client._zVaFElement;
              if (contentArea) {
                this.logger.debug('[Cache] DOM flushed, caching content now');
                await this.client.cache.set(currentPage, contentArea.outerHTML, 'rendered');
                this.logger.log(`[Cache] Cached content: ${currentPage}`);
              }
            } catch (error) {
              this.logger.error('[Cache] Error caching content:', error);
            }
          }
        }, 1000); // TIMEOUTS.DEBOUNCE_WIDGET (increased from 500ms for safer debouncing)
      });
      return true;
    }
    return false;
  }

  /**
   * Register onInput hook for input rendering
   */
  async registerInputHook() {
    if (!this.hooks.has('onInput')) {
      this.hooks.register('onInput', async (inputRequest) => {
        this.logger.debug('[WidgetHookManager] onInput triggered:', inputRequest.type);
        const inputType = inputRequest.type || inputRequest.data?.type || 'string';

        // Use InputRequestRenderer directly instead of ZDisplayRenderer
        await this.client._ensureInputRequestRenderer();
        
        if (inputType === 'selection') {
          this.client.inputRequestRenderer.renderSelectionRequest(inputRequest);
        } else if (inputType === 'button') {
          this.client.inputRequestRenderer.renderButtonRequest(inputRequest);
        } else {
          this.client.inputRequestRenderer.renderInputRequest(inputRequest);
        }
      });
      return true;
    }
    return false;
  }

  /**
   * Register progress bar hooks
   */
  async registerProgressBarHooks() {
    let count = 0;
    
    if (!this.hooks.has('onProgressBar')) {
      this.hooks.register('onProgressBar', async (event) => {
        this.logger.debug('[WidgetHookManager] Progress bar update');
        await this.client._ensureProgressBarRenderer();
        this.client.progressBarRenderer.render(event);
      });
      count++;
    }

    if (!this.hooks.has('onProgressComplete')) {
      this.hooks.register('onProgressComplete', async (event) => {
        this.logger.debug('[WidgetHookManager] Progress complete');
        await this.client._ensureProgressBarRenderer();
        this.client.progressBarRenderer.complete(event);
      });
      count++;
    }
    
    return count;
  }

  /**
   * Register spinner hooks
   */
  async registerSpinnerHooks() {
    let count = 0;
    
    if (!this.hooks.has('onSpinnerStart')) {
      this.hooks.register('onSpinnerStart', async (event) => {
        this.logger.debug('[WidgetHookManager] Spinner start');
        await this.client._ensureSpinnerRenderer();
        this.client.spinnerRenderer.start(event);
      });
      count++;
    }

    if (!this.hooks.has('onSpinnerStop')) {
      this.hooks.register('onSpinnerStop', async (event) => {
        this.logger.debug('[WidgetHookManager] Spinner stop');
        await this.client._ensureSpinnerRenderer();
        this.client.spinnerRenderer.stop(event);
      });
      count++;
    }
    
    return count;
  }

  /**
   * Register swiper hooks
   */
  async registerSwiperHooks() {
    let count = 0;
    
    if (!this.hooks.has('onSwiperInit')) {
      this.hooks.register('onSwiperInit', async (event) => {
        this.logger.debug('[WidgetHookManager] Swiper init');
        await this.client._ensureSwiperRenderer();
        this.client.swiperRenderer.init(event);
      });
      count++;
    }

    if (!this.hooks.has('onSwiperUpdate')) {
      this.hooks.register('onSwiperUpdate', async (event) => {
        this.logger.debug('[WidgetHookManager] Swiper update');
        await this.client._ensureSwiperRenderer();
        this.client.swiperRenderer.update(event);
      });
      count++;
    }

    if (!this.hooks.has('onSwiperComplete')) {
      this.hooks.register('onSwiperComplete', async (event) => {
        this.logger.debug('[WidgetHookManager] Swiper complete');
        await this.client._ensureSwiperRenderer();
        this.client.swiperRenderer.complete(event);
      });
      count++;
    }
    
    return count;
  }

  /**
   * Register dashboard hook
   */
  async registerDashboardHook() {
    if (!this.hooks.has('onZDash')) {
      this.hooks.register('onZDash', async (dashConfig) => {
        this.logger.debug('[WidgetHookManager] onZDash triggered');
        await this.client._ensureDashboardRenderer();
        await this.client.dashboardRenderer.render(dashConfig, this.client._zVaFElement);
      });
      return true;
    }
    return false;
  }

  /**
   * Register wizard gate result hook
   */
  async registerWizardGateResultHook() {
    if (!this.hooks.has('onWizardGateResult')) {
      this.hooks.register('onWizardGateResult', async (message) => {
        this.logger.debug('[WidgetHookManager] onWizardGateResult triggered for gate:', message.gateKey);
        await this.client._ensureZDisplayOrchestrator();
        await this.client.zDisplayOrchestrator.handleWizardGateResult(message);
      });
      return true;
    }
    return false;
  }
}

export default WidgetHookManager;

