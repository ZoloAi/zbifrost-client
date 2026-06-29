/**
 * 
 * Terminal Renderer - zTerminal Code Execution Sandbox
 * 
 *
 * Renders zTerminal events as code blocks with optional execution.
 * Displays code with syntax highlighting and a Run button for
 * sandboxed execution.
 *
 * @module rendering/terminal_renderer
 * @layer 3
 * @pattern Strategy (single event type)
 *
 * Dependencies:
 * - Layer 0: primitives/interactive_primitives.js (createButton)
 * - Prism.js: Syntax highlighting (already loaded by BifrostClient)
 * - zTheme: Card and button component classes
 *
 * Exports:
 * - TerminalRenderer: Class for rendering terminal events
 *
 * Example:
 * ```javascript
 * import TerminalRenderer from './terminal_renderer.js';
 *
 * const renderer = new TerminalRenderer(logger, client);
 * renderer.render({
 *   title: 'Python Demo',
 *   content: '```python\nprint("Hello!")\n```'
 * });
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────

// Layer 0: Constants
import { TYPOGRAPHY } from '../../../L1_Foundation/constants/bifrost_constants.js';

// Layer 0: Primitives
import { createButton } from '../primitives/interactive_primitives.js';

// Byte-exact source store, keyed by terminalId. zTerminal source is
// whitespace-significant (zUI/Python), and a DOM `data-*` attribute is NOT a
// safe round-trip for multi-line, indentation-sensitive text — re-serialization
// of the host node can silently drop leading spaces on a line, corrupting the
// indentation the parser depends on. Holding the raw content in memory keeps the
// Run payload identical to what the server sent.
const _zTerminalSource = new Map();

// 
// Main Implementation
// 

/**
 * Renders zTerminal code execution sandbox for zDisplay
 *
 * Handles the 'zTerminal' event type from zCLI backend, creating
 * code blocks with syntax highlighting and interactive Run button.
 *
 * @class
 */
export default class TerminalRenderer {
  /**
   * Create a terminal renderer
   * @param {Object} logger - Logger instance for debugging
   * @param {Object} client - BifrostClient instance for sending responses
   */
  constructor(logger, client = null) {
    if (!logger) {
      throw new Error('[TerminalRenderer] logger is required');
    }

    this.logger = logger;
    this.client = client;
  }

  /**
   * Render a zTerminal code block
   *
   * @param {Object} data - Terminal configuration
   * @param {string} data.title - Title for the terminal block
   * @param {string} data.content - Code content with code fences (```language ... ```)
   * @param {string} [data._zClass] - Optional custom classes
   * @returns {HTMLElement} Created terminal container
   */
  render(data) {
    const title = data.title || 'Terminal';
    const rawContent = data.content || '';
    const terminalId = data._id || `terminal_${Math.random().toString(36).substr(2, 9)}`;

    // Extract language and code from code fences (```language ... ```)
    const { language, code } = this._parseCodeFences(rawContent);

    // Effective zTerminal mode for THIS instance, stamped server-side from zEnv
    // (readonly | sandbox | trust). Missing → assume sandbox for continuity.
    const mode = (data.mode || 'sandbox').toString().toLowerCase();

    // Per-block opt-out: zRun:false hides the Run button even when the mode and
    // language would allow it — for "copy this snippet" blocks. Default true.
    const runEnabled = !(data.zRun === false || data.zRun === 'false' || data.zRun === 'False');

    // Create main container (_zClass is appended centrally by the orchestrator SSOT)
    const container = document.createElement('div');
    container.className = 'zTerminal-container zCard zMb-3';
    container.id = terminalId;

    // Header: title + language, a constant mode badge, Copy, and Run (only when
    // execution is possible for this mode + language AND not opted out via zRun).
    const header = this._createHeader(title, language, terminalId, code, mode, runEnabled);
    container.appendChild(header);

    // Create code block with syntax highlighting (display extracted code)
    const codeBlock = this._createCodeBlock(code, language);
    container.appendChild(codeBlock);

    // Create output area (initially hidden)
    const outputArea = this._createOutputArea(terminalId);
    container.appendChild(outputArea);

    // Store raw content + title for execution (backend parses fences). The
    // content lives in an in-memory Map — NOT a data-* attribute — so its
    // indentation survives byte-exact to the Run payload. Title is short and
    // whitespace-insensitive, so the dataset is fine for it.
    _zTerminalSource.set(terminalId, rawContent);
    container.dataset.title = title;

    return container;
  }

  /**
   * Parse code fences to extract language and code
   * Handles nested code fences: if content has nested ```, closing will have 6+ backticks
   * Example: ```zui\n  content: ```python\n    print("hi")``````
   * @private
   * @param {string} content - Raw content possibly with code fences
   * @returns {{language: string, code: string}} Extracted language and code
   */
  _parseCodeFences(content) {
    // Match opening fence and handle nested closings (3, 6, 9+ backticks)
    const fenceMatch = content.match(/^```(\w+)?\s*\n?([\s\S]*?)(`{3,})\s*$/);
    if (fenceMatch) {
      const language = (fenceMatch[1] || 'text').toLowerCase();
      let innerContent = fenceMatch[2];
      const closingBackticks = fenceMatch[3];
      
      // If closing has more than 3 backticks, there's nested content
      // Strip one level of fence (3 backticks) from display, keep for execution
      if (closingBackticks.length > 3) {
        // Nested fences - append remaining backticks to inner content
        const remainingBackticks = '`'.repeat(closingBackticks.length - 3);
        innerContent = innerContent.trimEnd() + remainingBackticks;
      }
      
      return {
        language: language,
        code: innerContent.trim()
      };
    }
    // No code fence - treat as plain text
    return {
      language: 'text',
      code: content
    };
  }

  /**
   * Create terminal header with title, an always-present Copy button, and a
   * Run button when the snippet is runnable (python / zui).
   * @private
   */
  _createHeader(title, language, terminalId, code = '', mode = 'sandbox', runEnabled = true) {
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #1e1e2e;
      border-bottom: 1px solid #333;
      border-radius: 8px 8px 0 0;
      padding: 8px 12px;
      margin: 0;
    `;

    // Left side: title + badge
    const leftContainer = document.createElement('div');
    leftContainer.style.cssText = 'display: flex; align-items: center; gap: 10px; margin: 0;';

    // Title
    const titleEl = document.createElement('span');
    titleEl.style.cssText = `color: #e0e0e0; font-weight: ${TYPOGRAPHY.FONT_WEIGHTS.MEDIUM}; font-size: 0.9rem; margin: 0;`;
    titleEl.textContent = title;

    // Language badge
    const langBadge = document.createElement('span');
    langBadge.style.cssText = `
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: ${TYPOGRAPHY.FONT_WEIGHTS.MEDIUM};
      margin: 0;
    `;
    langBadge.textContent = language;

    leftContainer.appendChild(titleEl);
    leftContainer.appendChild(langBadge);

    // Right side: constant mode badge (the instance's trust dial) + Copy +
    // a Run button ONLY when execution is actually possible here.
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin: 0;';

    // The mode badge is a per-instance fact (from zEnv), shown on every block so
    // the trust context is unambiguous — never a per-language guess.
    buttonContainer.appendChild(this._createModeBadge(mode));

    // Copy is present on every zTerminal — runnable or display-only.
    buttonContainer.appendChild(this._createCopyButton(code));

    // Run appears only when the mode permits it AND the language can run AND the
    // block didn't opt out (zRun:false). Over Bifrost runnable means sandbox +
    // python/zui; readonly never runs, bash is never executable on the web.
    // No run → no button (and no fake pill).
    if (runEnabled && this._isRunnable(mode, language)) {
      const runButton = createButton('button', {});
      runButton.innerHTML = '<i class="bi bi-play-fill"></i> Run';
      runButton.style.cssText = `
        background: #22c55e;
        border: none;
        color: white;
        font-weight: ${TYPOGRAPHY.FONT_WEIGHTS.MEDIUM};
        font-size: 0.8rem;
        padding: 5px 12px;
        border-radius: 4px;
        cursor: pointer;
        transition: background 0.2s;
      `;
      runButton.addEventListener('mouseenter', () => {
        runButton.style.background = '#16a34a';
      });
      runButton.addEventListener('mouseleave', () => {
        runButton.style.background = '#22c55e';
      });
      runButton.addEventListener('click', () => this._executeCode(terminalId));
      buttonContainer.appendChild(runButton);
    }

    header.appendChild(leftContainer);
    header.appendChild(buttonContainer);

    return header;
  }

  /**
   * Whether a Run button should appear at all. Execution over Bifrost is only
   * possible in `sandbox` for runnable languages (python / zui). `readonly`
   * never runs; bash is never executable on the web surface. trust is clamped to
   * sandbox server-side, so it never reaches the client.
   * @private
   */
  _isRunnable(mode, language) {
    return mode === 'sandbox' && (language === 'python' || language === 'zui');
  }

  /**
   * Create the constant mode badge — the instance's trust dial (from zEnv),
   * shown on every zTerminal so the execution context is never ambiguous.
   * @private
   */
  _createModeBadge(mode) {
    const META = {
      readonly: { icon: 'bi-eye',               label: 'read-only', fg: '#9aa4b2', bg: 'rgba(154,164,178,0.15)', bd: 'rgba(154,164,178,0.30)' },
      sandbox:  { icon: 'bi-shield-check',       label: 'sandbox',   fg: '#fbbf24', bg: 'rgba(234,179,8,0.18)',   bd: 'rgba(234,179,8,0.35)'   },
      trust:    { icon: 'bi-shield-exclamation', label: 'trust',     fg: '#f87171', bg: 'rgba(248,113,113,0.18)', bd: 'rgba(248,113,113,0.35)' },
    };
    const meta = META[mode] || META.sandbox;
    const badge = document.createElement('span');
    badge.title = `zTerminal mode: ${meta.label}`;
    badge.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: ${meta.bg};
      color: ${meta.fg};
      border: 1px solid ${meta.bd};
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: ${TYPOGRAPHY.FONT_WEIGHTS.MEDIUM};
    `;
    badge.innerHTML = `<i class="bi ${meta.icon}"></i> ${meta.label}`;
    return badge;
  }

  /**
   * Create the always-present "Copy code" button. Copies the displayed snippet
   * (fences stripped) to the clipboard, with brief inline confirmation.
   * @private
   */
  _createCopyButton(code) {
    const copyButton = createButton('button', {});
    copyButton.innerHTML = '<i class="bi bi-clipboard"></i>';
    copyButton.title = 'Copy code';
    copyButton.style.cssText = `
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid #3a3a4a;
      color: #c8c8d4;
      font-weight: ${TYPOGRAPHY.FONT_WEIGHTS.MEDIUM};
      font-size: 0.8rem;
      padding: 5px 9px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
    `;
    copyButton.addEventListener('mouseenter', () => {
      copyButton.style.background = 'rgba(255, 255, 255, 0.12)';
    });
    copyButton.addEventListener('mouseleave', () => {
      copyButton.style.background = 'rgba(255, 255, 255, 0.06)';
    });
    copyButton.addEventListener('click', () => this._copyCode(copyButton, code));
    return copyButton;
  }

  /**
   * Copy the snippet to the clipboard and flash a short confirmation on the
   * button. Falls back to a hidden textarea + execCommand on older browsers.
   * @private
   */
  async _copyCode(button, code) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.cssText = 'position: fixed; top: -9999px; opacity: 0;';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      button.innerHTML = '<i class="bi bi-check2"></i> Copied!';
      button.style.color = '#22c55e';
    } catch (e) {
      this.logger.warn('[TerminalRenderer] Copy failed:', e.message);
      button.innerHTML = '<i class="bi bi-x-lg"></i> Failed';
      button.style.color = '#ff6b6b';
    }
    setTimeout(() => {
      button.innerHTML = '<i class="bi bi-clipboard"></i>';
      button.style.color = '#c8c8d4';
    }, 1500);
  }

  /**
   * Create code block with syntax highlighting
   * @private
   */
  _createCodeBlock(content, language) {
    const codeWrapper = document.createElement('div');
    codeWrapper.className = 'zCard-body zP-0';
    codeWrapper.style.backgroundColor = 'var(--zs-dark, #1e1e2e)';

    const pre = document.createElement('pre');
    pre.className = 'zM-0 zP-3';
    pre.style.backgroundColor = 'transparent';
    pre.style.overflow = 'auto';

    const code = document.createElement('code');
    
    // Map language to Prism.js language class
    const prismLang = this._mapToPrismLanguage(language);
    code.className = `language-${prismLang}`;
    code.textContent = content;

    pre.appendChild(code);
    codeWrapper.appendChild(pre);

    // Apply Prism syntax highlighting if available
    if (typeof Prism !== 'undefined') {
      try {
        Prism.highlightElement(code);
      } catch (e) {
        this.logger.warn('[TerminalRenderer] Prism highlighting failed:', e.message);
      }
    }

    return codeWrapper;
  }

  /**
   * Create output area for execution results
   * @private
   */
  _createOutputArea(terminalId) {
    const outputArea = document.createElement('div');
    outputArea.id = `${terminalId}_output`;
    outputArea.className = 'zTerminal-output zCard-footer zP-3';
    outputArea.style.display = 'none';
    outputArea.style.backgroundColor = 'var(--zs-dark, #0d0d14)';
    outputArea.style.color = '#e0e0e0';
    outputArea.style.borderTop = '1px solid var(--zs-border-color, #333)';
    outputArea.style.fontFamily = 'monospace';
    outputArea.style.whiteSpace = 'pre-wrap';
    outputArea.style.overflow = 'auto';

    return outputArea;
  }

  /**
   * Map language to Prism.js language identifier
   * @private
   */
  _mapToPrismLanguage(language) {
    const langMap = {
      'python': 'python',
      'bash': 'bash',
      'zui': 'zui',
      'javascript': 'javascript',
      'js': 'javascript',
      'typescript': 'typescript',
      'ts': 'typescript',
      'json': 'json',
      'yaml': 'yaml',
      'html': 'html',
      'css': 'css'
    };
    return langMap[language.toLowerCase()] || 'plaintext';
  }

  /**
   * Execute code via WebSocket and display output
   * @private
   */
  async _executeCode(terminalId) {
    const container = document.getElementById(terminalId);
    if (!container) {
      this.logger.error('[TerminalRenderer] Container not found:', terminalId);
      return;
    }

    // Read the byte-exact source from the in-memory store (indentation intact).
    // Fall back to the legacy data-attribute only if the Map entry is missing.
    const content = _zTerminalSource.has(terminalId)
      ? _zTerminalSource.get(terminalId)
      : container.dataset.content;
    const outputArea = document.getElementById(`${terminalId}_output`);

    if (!outputArea) {
      this.logger.error('[TerminalRenderer] Output area not found');
      return;
    }

    // Show output area with loading state
    outputArea.style.display = 'block';
    outputArea.dataset.executing = 'true';
    outputArea.innerHTML = '<span class="zText-info"><i class="bi bi-hourglass-split"></i> Executing...</span>';

    // Send execute request via WebSocket
    if (!window.bifrostClient || !window.bifrostClient.connection) {
      outputArea.innerHTML = '<span class="zText-danger"><i class="bi bi-exclamation-triangle"></i> Not connected to server</span>';
      return;
    }

    try {
      const requestId = `zterminal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create a promise that will be resolved when we receive the response
      const responsePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Execution timeout'));
        }, 90000); // 90 second timeout (allows for interactive input)

        // Store resolver for this request
        if (!window._zTerminalResponses) {
          window._zTerminalResponses = {};
        }
        window._zTerminalResponses[requestId] = (response) => {
          clearTimeout(timeout);
          resolve(response);
        };

        // Map requestId → output area so handleInputRequest routes to the correct terminal
        if (!window._zTerminalOutputAreas) {
          window._zTerminalOutputAreas = {};
        }
        window._zTerminalOutputAreas[requestId] = outputArea;
      });

      // Send execution request - language is extracted from code fences by backend
      // Include title for zUI swap file naming
      const title = container.dataset.title || 'Terminal';
      window.bifrostClient.connection.send(JSON.stringify({
        event: 'execute_code',
        requestId: requestId,
        content: content,
        title: title
      }));


      // Wait for response
      const response = await responsePromise;
      delete outputArea.dataset.executing;

      if (response.success) {
        // zUI mode: output was streamed in real-time via `output` events.
        // Python mode: output is captured in a buffer and returned in response.output.
        // Display batch output if present; otherwise fall back to "(no output)" if
        // the spinner is still showing (meaning nothing was streamed either).
        if (response.output && response.output.trim()) {
          if (outputArea.querySelector('.bi-hourglass-split')) {
            outputArea.innerHTML = '';
          }
          const helper = new TerminalRenderer({ log: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
          for (const line of response.output.split('\n')) {
            const lineEl = document.createElement('div');
            lineEl.style.color = '#e0e0e0';
            lineEl.innerHTML = helper._cleanOutput(line);
            outputArea.appendChild(lineEl);
          }
        } else if (outputArea.querySelector('.bi-hourglass-split')) {
          outputArea.innerHTML = '<span class="zText-muted"><i class="bi bi-info-circle"></i> (no output)</span>';
        }
      } else {
        outputArea.innerHTML = `<span class="zText-danger"><i class="bi bi-x-circle"></i> Error:</span>\n<span class="zText-warning">${this._cleanOutput(response.error || 'Unknown error')}</span>`;
      }

    } catch (error) {
      this.logger.error('[TerminalRenderer] Execution failed:', error);
      outputArea.innerHTML = `<span class="zText-danger"><i class="bi bi-x-circle"></i> ${this._cleanOutput(error.message)}</span>`;
    }
  }

  /**
   * Handle execution response from backend
   * Called by message handler when execute_code_response is received
   * @static
   */
  static handleExecutionResponse(requestId, response) {
    if (window._zTerminalResponses && window._zTerminalResponses[requestId]) {
      window._zTerminalResponses[requestId](response);
      delete window._zTerminalResponses[requestId];
    }
    if (window._zTerminalOutputAreas) {
      delete window._zTerminalOutputAreas[requestId];
    }
  }

  /**
   * Handle real-time output line from backend during execute_code execution.
   * Appends the line to the active terminal output area immediately,
   * so intermediate wizard steps (like Show_Result) are visible before
   * subsequent input prompts appear.
   * Called by message handler when an {event: "output"} WebSocket message is received.
   * @static
   * @param {Object} eventData - The output event data from backend
   */
  static handleOutput(eventData) {
    const content = eventData.content;
    const requestId = eventData.requestId;
    if (content == null) return;

    // Prefer precise lookup by requestId, fall back to dataset.executing flag
    let targetOutput = null;
    if (requestId && window._zTerminalOutputAreas && window._zTerminalOutputAreas[requestId]) {
      targetOutput = window._zTerminalOutputAreas[requestId];
    } else {
      const outputAreas = document.querySelectorAll('.zTerminal-output');
      for (const area of outputAreas) {
        if (area.dataset.executing === 'true') {
          targetOutput = area;
          break;
        }
      }
    }
    if (!targetOutput) return;

    // Clear "Executing..." spinner on first real output line
    if (targetOutput.querySelector('.bi-hourglass-split')) {
      targetOutput.innerHTML = '';
    }

    // In-place redraw detection: CLI animations (progress bars, spinners) emit
    // one frame per tick, each prefixed with \r (return to line start) and/or
    // \x1b[2K (erase line). In a real tty those overwrite the SAME line; here we
    // mirror that by REUSING the previous animation frame's <div> instead of
    // stacking a new one per frame. A bare \r not part of a \r\n newline, or any
    // erase-line code, marks the chunk as a redraw of the current line.
    const text = String(content);
    const isRedraw = /\x1b\[2K/.test(text) || /\r(?!\n)/.test(text);

    const helper = new TerminalRenderer({ log: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
    const html = helper._cleanOutput(text);

    const prev = targetOutput.lastElementChild;
    let line;
    if (isRedraw && prev && prev.dataset.zRedraw === 'true') {
      line = prev;              // overwrite the live animation frame in place
    } else {
      line = document.createElement('div');
      line.style.color = '#e0e0e0'; // default terminal fg — overridden by ANSI spans
      targetOutput.appendChild(line);
    }
    if (isRedraw) line.dataset.zRedraw = 'true';
    line.innerHTML = html;
    targetOutput.scrollTop = targetOutput.scrollHeight;
  }

  /**
   * ANSI color code to CSS color mapping
   * Maps terminal ANSI codes to web colors (mirroring colors.py)
   * @private
   */
  _ansiColorMap = {
    // Standard bright colors (90-97 range) — mirrors Colors class in colors.py
    '30': '#282c34',   // dark/black fg — used with light backgrounds (e.g. highlight)
    '91': '#ff6b6b',   // RED
    '92': '#52B788',   // GREEN (zSuccess)
    '93': '#FFB347',   // YELLOW (zWarning)
    '94': '#5CA9FF',   // BLUE
    '95': '#c678dd',   // MAGENTA
    '96': '#56b6c2',   // CYAN — Colors.CYAN = \033[96m
    '97': '#abb2bf',   // WHITE

    // 256-color mode (38;5;N) — mirrors CSS-aligned semantic colors in colors.py
    '38;5;75':  '#5CA9FF',  // zInfo
    '38;5;78':  '#52B788',  // zSuccess
    '38;5;98':  '#9370DB',  // SECONDARY
    '38;5;150': '#A2D46E',  // PRIMARY
    '38;5;203': '#E63946',  // zError
    '38;5;215': '#FFB347',  // zWarning

    // Reset
    '0': null,
  };

  /**
   * ANSI background color code to CSS background-color mapping.
   * Used when compound codes (e.g. 30;103) set a background alongside foreground.
   * @private
   */
  _ansiBgColorMap = {
    '43':  '#b8860b',  // standard yellow bg
    '103': '#FFD700',  // bright yellow bg — Colors.EXTERNAL (\033[30;103m = highlight)
  };

  /**
   * ANSI style code to CSS property mapping
   * Handles text-style codes that are not colors (bold, dim, etc.)
   * @private
   */
  _ansiStyleMap = {
    '1': 'font-weight: bold',             // bold         — \033[1m
    '2': 'opacity: 0.65',                 // dim          — \033[2m
    '4': 'text-decoration: underline',    // underline    — \033[4m
    '9': 'text-decoration: line-through', // strikethrough — \033[9m
  };

  /**
   * Convert ANSI escape codes to HTML spans with CSS colors, backgrounds, and styles.
   * Handles bright colors (90–97), 256-color (38;5;N), background colors (4N/10N),
   * and text-style codes (bold, dim, strikethrough).
   * Mirrors the Python inline_transformer.py + colors.py SSOT.
   * @private
   */
  _ansiToHtml(text) {
    if (!text) return '';

    // Drop terminal control codes we don't emulate as text: carriage return and
    // non-SGR CSI sequences (erase-line \x1b[2K, cursor moves \x1b[1A, etc.).
    // Their in-place-redraw INTENT is handled in handleOutput (which line to
    // overwrite); here we just make sure they never paint as literal "[2K".
    text = text.replace(/\r/g, '').replace(/\x1b\[[0-9;]*[A-Za-ln-z]/g, '');

    const ansiRegex = /\x1b\[([0-9;]+)m/g;
    const segments = [];
    let pos = 0;
    let currentColor = null;
    let currentBg    = null;
    let currentStyle = null;

    let match;
    while ((match = ansiRegex.exec(text)) !== null) {
      // Capture text before this escape code
      if (match.index > pos) {
        segments.push({ text: text.substring(pos, match.index), color: currentColor, bg: currentBg, style: currentStyle });
      }

      const code = match[1];

      if (code === '0') {
        // Full reset
        currentColor = null;
        currentBg    = null;
        currentStyle = null;
      } else if (code === '22' || code === '23' || code === '24' || code === '29') {
        // Normal intensity / italic off / underline off / strikethrough off — color + bg preserved
        currentStyle = null;
      } else if (this._ansiStyleMap[code]) {
        // Style code (bold, dim, strikethrough)
        currentStyle = this._ansiStyleMap[code];
      } else if (this._ansiColorMap[code] !== undefined) {
        // Direct single-code foreground color
        currentColor = this._ansiColorMap[code];
      } else {
        // Multi-part code: 38;5;N (256-color fg) OR compound like 30;103 (fg+bg)
        const parts = code.split(';');
        if (parts[0] === '38' && parts[1] === '5' && parts[2]) {
          // 256-color foreground: look up full key "38;5;N"
          const key256 = `38;5;${parts[2]}`;
          if (this._ansiColorMap[key256] !== undefined) {
            currentColor = this._ansiColorMap[key256];
          }
        } else {
          // Apply each part individually (handles e.g. "30;103" → dark fg + yellow bg)
          for (const part of parts) {
            if (this._ansiColorMap[part] !== undefined) {
              currentColor = this._ansiColorMap[part];
            } else if (this._ansiBgColorMap[part] !== undefined) {
              currentBg = this._ansiBgColorMap[part];
            }
          }
        }
      }

      pos = match.index + match[0].length;
    }

    // Capture trailing text
    if (pos < text.length) {
      segments.push({ text: text.substring(pos), color: currentColor, bg: currentBg, style: currentStyle });
    }

    // Build HTML — combine color + bg + style into a single span
    let result = '';
    for (const seg of segments) {
      const escapedText = this._escapeHtml(seg.text);
      const cssParts = [];
      if (seg.color) cssParts.push(`color: ${seg.color}`);
      if (seg.bg)    cssParts.push(`background-color: ${seg.bg}; padding: 0 2px; border-radius: 2px`);
      if (seg.style) cssParts.push(seg.style);
      if (cssParts.length) {
        result += `<span style="${cssParts.join('; ')}">${escapedText}</span>`;
      } else {
        result += escapedText;
      }
    }

    return result;
  }

  /**
   * Escape HTML to prevent XSS
   * @private
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clean and render output for web display
   * Converts ANSI codes to HTML colors
   * @private
   */
  _cleanOutput(text) {
    return this._ansiToHtml(text);
  }

  /**
   * Handle input request from backend
   * Shows an input field in the terminal output area
   * Called by message handler when sandbox_input_request is received
   * @static
   * @param {string} requestId - The request ID for this input
   * @param {string} prompt - The prompt text to display
   * @param {boolean} isPassword - Whether this is a password/secret input (masked)
   */
  static handleInputRequest(requestId, prompt, inputType = 'text', required = false,
                            isPassword = false, defaultValue = '', isReadonly = false,
                            isDisabled = false, placeholder = '', datalist = [],
                            min = null, max = null, step = null) {
    // Resolve the output area that belongs to this requestId.
    // _zTerminalOutputAreas is populated in _executeCode when Run is clicked.
    let targetOutput = window._zTerminalOutputAreas && window._zTerminalOutputAreas[requestId]
      ? window._zTerminalOutputAreas[requestId]
      : null;

    // Fallback: find first visible output area (single-terminal case)
    if (!targetOutput) {
      const outputAreas = document.querySelectorAll('.zTerminal-output');
      for (const area of outputAreas) {
        if (area.style.display !== 'none') {
          targetOutput = area;
          break;
        }
      }
    }

    if (!targetOutput) {
      console.error('[TerminalRenderer] No active output area for input request');
      return;
    }

    // Readonly: display-only with lock icon, auto-resolve immediately
    if (isReadonly) {
      const readonlyLine = document.createElement('div');
      readonlyLine.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 4px; opacity: 0.7;';
      readonlyLine.innerHTML = `<span class="zText-muted"><i class="bi bi-lock"></i> ${prompt || 'Value:'}</span> <span class="zText-light">${defaultValue}</span>`;
      targetOutput.appendChild(readonlyLine);
      if (window.bifrostClient && window.bifrostClient.connection) {
        window.bifrostClient.connection.send(JSON.stringify({ event: 'input_response', requestId, value: defaultValue }));
      }
      return;
    }

    // Disabled: greyed-out display, no interaction, auto-resolve immediately
    if (isDisabled) {
      const disabledLine = document.createElement('div');
      disabledLine.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.02); border-radius: 4px; opacity: 0.4;';
      disabledLine.innerHTML = `<span class="zText-muted"><i class="bi bi-slash-circle"></i> ${prompt || 'Value:'}</span> <span class="zText-muted">${defaultValue}</span>`;
      targetOutput.appendChild(disabledLine);
      if (window.bifrostClient && window.bifrostClient.connection) {
        window.bifrostClient.connection.send(JSON.stringify({ event: 'input_response', requestId, value: defaultValue }));
      }
      return;
    }

    // Create input UI
    const inputContainer = document.createElement('div');
    inputContainer.className = 'zTerminal-input-container';
    inputContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;';
    
    // Prompt label
    const promptLabel = document.createElement('span');
    promptLabel.className = 'zText-info';
    const requiredStar = required ? ' <span style="color:#e74c3c" title="required">*</span>' : '';
    promptLabel.innerHTML = `<i class="bi bi-keyboard"></i> ${prompt || 'Input:'}${requiredStar}`;
    
    // Input field — type and constraints driven by backend flags
    const inputField = document.createElement('input');
    inputField.type = isPassword ? 'password' : (inputType || 'text');
    inputField.className = 'zForm-control zForm-control-sm';
    inputField.style.cssText = 'flex: 1; background: #1e1e2e; border: 1px solid #444; color: #e0e0e0; padding: 4px 8px;';
    inputField.placeholder = isPassword ? (placeholder || '••••••••') : (placeholder || 'Type your input...');
    if (min !== null) inputField.min = min;
    if (max !== null) inputField.max = max;
    if (step !== null) inputField.step = step;
    if (defaultValue && !isPassword) {
      inputField.value = defaultValue;
    }
    
    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'zBtn zBtn-sm zBtn-primary';
    submitBtn.innerHTML = '<i class="bi bi-arrow-return-left"></i> Submit';
    
    // Handle submit
    const submitInput = () => {
      const value = inputField.value;
      
      // Send input response via WebSocket
      if (window.bifrostClient && window.bifrostClient.connection) {
        window.bifrostClient.connection.send(JSON.stringify({
          event: 'input_response',
          requestId: requestId,
          value: value
        }));
      }
      
      // Replace input UI with submitted value display (mask password values)
      const displayValue = isPassword ? '•'.repeat(value.length || 8) : value;
      const icon = isPassword ? 'bi-shield-lock' : 'bi-keyboard';
      inputContainer.innerHTML = `<span class="zText-muted"><i class="bi ${icon}"></i> ${prompt || 'Input:'}</span> <span class="zText-light">${displayValue}</span>`;
    };
    
    // Submit on Enter key
    inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        submitInput();
      }
    });
    
    // Submit on button click
    submitBtn.addEventListener('click', submitInput);
    
    // Assemble input row
    inputContainer.appendChild(promptLabel);
    inputContainer.appendChild(inputField);
    inputContainer.appendChild(submitBtn);
    targetOutput.appendChild(inputContainer);

    // Datalist suggestion chips (free text still allowed)
    if (!isPassword && Array.isArray(datalist) && datalist.length > 0) {
      const chipsRow = document.createElement('div');
      chipsRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; padding: 0 8px 4px;';
      datalist.forEach((option) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = option;
        chip.style.cssText = 'background: rgba(255,255,255,0.07); border: 1px solid #555; color: #ccc; border-radius: 12px; padding: 2px 10px; font-size: 0.82em; cursor: pointer;';
        chip.addEventListener('mouseenter', () => { chip.style.background = 'rgba(255,255,255,0.15)'; });
        chip.addEventListener('mouseleave', () => { chip.style.background = 'rgba(255,255,255,0.07)'; });
        chip.addEventListener('click', () => {
          inputField.value = option;
          submitInput();
        });
        chipsRow.appendChild(chip);
      });
      targetOutput.appendChild(chipsRow);
    }

    // Focus the input field
    inputField.focus();
  }
}
