/**
 * L1_Foundation/bootstrap/prism_loader.js
 * 
 * Prism.js loader with sequential loading (core → components → .zolo languages).
 * Extracted from bifrost_client.js _loadPrismJS() and _loadPrismZolo().
 */

/**
 * Resolve the base URL for the .zolo Prism grammar bundle (SSOT).
 *
 * Preference order:
 *   1. Server-announced `syntaxBase` from the injected zui-config script —
 *      an OPAQUE, versioned URL (e.g. "/zsyntax/1.2.0/") served by zServer
 *      straight from the installed zolo-lsp package, so highlighting always
 *      matches the engine's actual grammar. Never assume its shape.
 *   2. The client's bundled syntax/ dir — a FROZEN fallback for servers that
 *      predate the announcement. Do not refresh it by hand; the served
 *      bundle supersedes it.
 *
 * @returns {{base: string, source: string}} trailing-slash base + origin tag
 */
export function resolveSyntaxBase() {
  try {
    const el = document.getElementById('zui-config');
    const announced = el ? JSON.parse(el.textContent)?.syntaxBase : null;
    if (announced && typeof announced === 'string') {
      const base = announced.endsWith('/') ? announced : `${announced}/`;
      return { base, source: 'server (zolo-lsp)' };
    }
  } catch (e) { /* malformed zui-config — fall back to bundled */ }
  return { base: new URL('../../syntax/', import.meta.url).href, source: 'bundled fallback' };
}

/**
 * Load Prism.js from CDN for syntax highlighting
 * 
 * NOTE: Prism requires specific load order (core → components → .zolo languages)
 * 
 * @param {Object} logger - Logger instance for debug output
 */
export function loadPrismJS(logger) {
  if (typeof document === 'undefined') {
    return;
  }

  logger.debug('[Prism] Loading...');

  const prismCDN = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0';
  const prismTheme = `${prismCDN}/themes/prism-tomorrow.min.css`;
  
  // Check if Prism CSS already loaded
  if (!document.querySelector(`link[href="${prismTheme}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = prismTheme;
    document.head.appendChild(link);
    logger.debug('[Prism] CSS loaded (prism-tomorrow)');
  } else {
    logger.debug('Prism.js CSS already loaded');
  }
  
  // Load custom .zolo theme overrides — server-announced bundle preferred
  // (matches the engine's zolo-lsp), bundled syntax/ as fallback.
  const syntaxAssets = resolveSyntaxBase();
  const zoloTheme = `${syntaxAssets.base}prism-zolo-theme.css`;
  if (!document.querySelector(`link[href="${zoloTheme}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = zoloTheme;
    document.head.appendChild(link);
    logger.debug(`[Prism] .zolo custom theme loaded (${syntaxAssets.source})`);
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
      logger.debug(`Prism ${scriptInfo.name} already loaded`);
      if (index < scripts.length - 1) {
        loadScript(scripts[index + 1], index + 1);
      } else {
        logger.debug('All Prism.js scripts already loaded');
        loadPrismZolo(logger);
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
        loadPrismZolo(logger);
      }
    };
    script.onerror = () => {
      logger.warn(`Failed to load Prism ${scriptInfo.name}`);
    };
    document.head.appendChild(script);
  };

  // Start loading chain
  loadScript(scripts[0], 0);
}

/**
 * Load custom .zolo language definition for Prism.js
 * @param {Object} logger - Logger instance
 */
function loadPrismZolo(logger) {
  if (typeof document === 'undefined') {
    return;
  }

  logger.debug('Loading custom .zolo languages...');

  // Keep dependency order deterministic: extensions rely on base "zolo".
  const zoloLanguages = ['zolo', 'zspark', 'zui', 'zschema', 'zconfig', 'zenv'];
  const totalLanguages = zoloLanguages.length;

  // Server-announced bundle preferred (grammar == the engine's zolo-lsp),
  // client-bundled syntax/ as fallback for servers that predate syntaxBase.
  const { base: syntaxBase, source } = resolveSyntaxBase();
  logger.debug(`[Prism] .zolo grammars from: ${syntaxBase} (${source})`);

  const alreadyLoaded = zoloLanguages.every((lang) => window.Prism?.languages?.[lang]);
  if (alreadyLoaded) {
    logger.debug('Prism .zolo languages already loaded');
    return;
  }

  const finishLoad = () => {
    logger.debug('Prism.js loaded (7 languages + %s .zolo variants)', totalLanguages);

    // Rehighlight ALL code blocks rendered before grammars loaded — covers
    // zolo variants AND stock languages (bash, python, …) from zMD fences.
    if (window.Prism) {
      const codeBlocks = document.querySelectorAll('pre code[class*="language-"]');
      if (codeBlocks.length > 0) {
        logger.debug(`Rehighlighting ${codeBlocks.length} code blocks`);
        codeBlocks.forEach(block => {
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
    const scriptSrc = `${syntaxBase}prism-${lang}.js`;

    // Check if already loaded
    if (document.querySelector(`script[src="${scriptSrc}"]`)) {
      logger.debug(`Prism ${lang} already loaded`);
      loadLanguageSequentially(index + 1);
      return;
    }

    const script = document.createElement('script');
    script.src = scriptSrc;
    script.onload = () => {
      loadLanguageSequentially(index + 1);
    };
    script.onerror = () => {
      logger.debug(`[Prism] language file not found: ${scriptSrc} (skipped)`);
      loadLanguageSequentially(index + 1);
    };
    document.head.appendChild(script);
  };

  loadLanguageSequentially(0);
}
