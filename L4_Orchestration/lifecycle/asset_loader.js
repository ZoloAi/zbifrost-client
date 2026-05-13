/**
 * L4_Orchestration/lifecycle/asset_loader.js
 * 
 * Asset Loading Orchestrator
 * 
 * Manages loading of external assets and libraries:
 * - Prism.js syntax highlighting (core + languages + .zolo variants)
 * - _zScripts from YAML metadata (plugin scripts)
 * 
 * Extracted from bifrost_client.js (Phase 5.4)
 *
 * TODO: Tiered renderer initialization for publish-time performance
 * ──────────────────────────────────────────────────────────────────
 * This is the right place to orchestrate the two-phase load sequence:
 *
 *   Phase 1 — before WebSocket connect (called from initializer.js):
 *     await client.rendererRegistry.preloadTier('critical')
 *     // loads: typography, text, list — ~4 files, unblocks first paint
 *
 *   Phase 2 — after first chunk renders (post-paint, background):
 *     const afterFirstPaint = () => {
 *       requestIdleCallback(() => client.rendererRegistry.preloadTier('deferred'));
 *     };
 *     // hook into message_handler.js first-chunk-rendered signal, or
 *     // use a one-shot WebSocket message ACK as the trigger
 *
 * Prerequisite: add `priority: 'critical' | 'deferred'` to each entry
 * in renderer_registry.js (see TODO there), then add preloadTier() to
 * RendererRegistry that filters by priority and calls ensureRenderer().
 *
 * No changes to ensureRenderer() needed — cache hit on pre-loaded renderers
 * means existing lazy-load call sites stay identical.
 */

export class AssetLoader {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
  }

  /**
   * Load _zScripts from YAML metadata (plugin scripts)
   * Resolves plugin references: &.plugin_name → /plugins/plugin_name.js
   */
  loadZScripts() {
    if (typeof document === 'undefined') {
      return;
    }

    // Extract _zScripts from zuiConfig.zMeta (v1.5.13: Server passes zMeta section from YAML)
    const zScripts = this.client.zuiConfig?.zMeta?._zScripts || [];
    
    if (!Array.isArray(zScripts) || zScripts.length === 0) {
      this.logger.debug('[AssetLoader] No _zScripts found in YAML metadata');
      return;
    }

    this.logger.debug('[AssetLoader] Loading %s _zScripts from YAML', zScripts.length);

    zScripts.forEach(scriptRef => {
      // Resolve plugin reference: &.plugin_name → /plugins/plugin_name.js
      let scriptUrl = scriptRef;
      if (scriptRef.startsWith('&.')) {
        const pluginName = scriptRef.substring(2);
        scriptUrl = `/plugins/${pluginName}.js`;
        this.logger.debug('[AssetLoader] Resolving plugin: %s → %s', scriptRef, scriptUrl);
      }

      // Check if script already loaded
      if (!document.querySelector(`script[src="${scriptUrl}"]`)) {
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.onload = () => {
          this.logger.debug('[AssetLoader] Loaded _zScript: %s', scriptUrl);
        };
        script.onerror = () => {
          this.logger.error('[AssetLoader] Failed to load _zScript: %s', scriptUrl);
        };
        document.head.appendChild(script);
      } else {
        this.logger.debug('[AssetLoader] _zScript already loaded: %s', scriptUrl);
      }
    });
  }

  /**
   * Load Prism.js from CDN for syntax highlighting
   * Complex sequential loading: core → components → .zolo languages
   */
  loadPrismJS() {
    if (typeof document === 'undefined') {
      return;
    }

    this.logger.debug('[AssetLoader] Loading Prism.js...');

    const prismCDN = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0';
    const prismTheme = `${prismCDN}/themes/prism-tomorrow.min.css`;
    
    // Check if Prism CSS already loaded
    if (!document.querySelector(`link[href="${prismTheme}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = prismTheme;
      document.head.appendChild(link);
      this.logger.debug('[AssetLoader] Prism CSS loaded (prism-tomorrow)');
    } else {
      this.logger.debug('[AssetLoader] Prism CSS already loaded');
    }
    
    // Load custom .zolo theme overrides
    const zoloTheme = '/static/css/prism-zolo-theme.css';
    if (!document.querySelector(`link[href="${zoloTheme}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = zoloTheme;
      document.head.appendChild(link);
      this.logger.debug('[AssetLoader] Prism .zolo custom theme loaded');
    }

    // Load Prism core + common languages
    const scripts = [
      { src: `${prismCDN}/prism.min.js`, name: 'core' },
      { src: `${prismCDN}/components/prism-markup.min.js`, name: 'markup' },
      { src: `${prismCDN}/components/prism-css.min.js`, name: 'css' },
      { src: `${prismCDN}/components/prism-javascript.min.js`, name: 'javascript' },
      { src: `${prismCDN}/components/prism-python.min.js`, name: 'python' },
      { src: `${prismCDN}/components/prism-bash.min.js`, name: 'bash' },
      { src: `${prismCDN}/components/prism-yaml.min.js`, name: 'yaml' }
    ];

    // Load scripts sequentially (Prism components depend on core)
    const loadScript = (scriptInfo, index) => {
      // Check if script already loaded
      if (document.querySelector(`script[src="${scriptInfo.src}"]`)) {
        // Already loaded, continue to next
        this.logger.debug(`[AssetLoader] Prism ${scriptInfo.name} already loaded`);
        if (index < scripts.length - 1) {
          loadScript(scripts[index + 1], index + 1);
        } else {
          this.logger.debug('[AssetLoader] All Prism.js scripts already loaded');
          this.loadPrismZolo();
        }
        return;
      }

      const script = document.createElement('script');
      script.src = scriptInfo.src;
      script.onload = () => {
        // Load next script in sequence (silent)
        if (index < scripts.length - 1) {
          loadScript(scripts[index + 1], index + 1);
        } else {
          // Load custom .zolo language definition
          this.loadPrismZolo();
        }
      };
      script.onerror = () => {
        this.logger.warn(`[AssetLoader] Failed to load Prism ${scriptInfo.name}`);
      };
      document.head.appendChild(script);
    };

    // Start loading chain
    loadScript(scripts[0], 0);
  }

  /**
   * Load custom .zolo language definitions for Prism.js
   * Loads 6 .zolo variants: zolo, zspark, zui, zschema, zconfig, zenv
   */
  loadPrismZolo() {
    if (typeof document === 'undefined') {
      return;
    }

    this.logger.debug('[AssetLoader] Loading custom .zolo languages...');

    // Keep dependency order deterministic: extensions rely on base "zolo".
    const zoloLanguages = ['zolo', 'zspark', 'zui', 'zschema', 'zconfig', 'zenv'];
    const totalLanguages = zoloLanguages.length;

    const alreadyLoaded = zoloLanguages.every((lang) => window.Prism?.languages?.[lang]);
    if (alreadyLoaded) {
      this.logger.debug('[AssetLoader] Prism .zolo languages already loaded');
      return;
    }

    const finishLoad = () => {
      this.logger.debug('[AssetLoader] Prism.js loaded (7 languages + %s .zolo variants)', totalLanguages);

      // Rehighlight any zolo code blocks that were rendered before languages loaded
      if (window.Prism) {
        const zoloBlocks = document.querySelectorAll(
          zoloLanguages.map(lang => `pre code.language-${lang}`).join(', ')
        );
        if (zoloBlocks.length > 0) {
          this.logger.debug(`[AssetLoader] Rehighlighting ${zoloBlocks.length} zolo code blocks`);
          zoloBlocks.forEach(block => {
            Prism.highlightElement(block);
          });
        }
      }
    };

    const loadLanguageSequentially = (index) => {
      if (index >= totalLanguages) {
        finishLoad();
        return;
      }

      const lang = zoloLanguages[index];
      const path = `/static/js/prism-${lang}.js`;

      // If language is already registered, continue.
      if (window.Prism?.languages?.[lang]) {
        this.logger.debug(`[AssetLoader] Prism ${lang} already registered`);
        loadLanguageSequentially(index + 1);
        return;
      }

      // Reuse existing script tag if present but language not yet available.
      const existingScript = document.querySelector(`script[src="${path}"]`);
      if (existingScript) {
        existingScript.addEventListener('load', () => {
          this.logger.debug(`[AssetLoader] Loaded Prism language ${index + 1}/${totalLanguages}: ${path}`);
          loadLanguageSequentially(index + 1);
        }, { once: true });
        existingScript.addEventListener('error', () => {
          this.logger.error(`[AssetLoader] Failed to load Prism language: ${path}`);
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = path;
      script.onload = () => {
        this.logger.debug(`[AssetLoader] Loaded Prism language ${index + 1}/${totalLanguages}: ${path}`);
        loadLanguageSequentially(index + 1);
      };
      script.onerror = () => {
        this.logger.error(`[AssetLoader] Failed to load Prism language: ${path}`);
      };
      document.head.appendChild(script);
    };

    loadLanguageSequentially(0);
  }
}
