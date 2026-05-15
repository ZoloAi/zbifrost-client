/**
 * MenuRenderer - Handles menu rendering and interaction in Bifrost mode
 *
 * This module provides:
 * - Menu HTML rendering with zTheme classes
 * - Click event handlers for menu options
 * - Keyboard navigation support
 * - WebSocket communication for menu selection
 *
 * Integrates with:
 * - zDisplay (via zdisplay_orchestrator.js)
 * - BifrostClient (for WebSocket messaging)
 * - zTheme (for consistent styling)
 */

export class MenuRenderer {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
  }

  /**
   * Render menu from backend menu event (full-page menu)
   * @param {Object} message - Menu event data from backend
   */
  renderMenu(message) {
    this.logger.log('[MenuRenderer]  Rendering menu:', message);
    this.logger.log('[MenuRenderer] Rendering menu', message);

    const { menu_key, options, breadcrumbs, _current_file, _current_block } = message;

    // Get the zVaF content element
    const contentElement = this.client._zVaFElement;
    if (!contentElement) {
      this.logger.error('[MenuRenderer] [ERROR] zVaF element not found');
      return;
    }

    // Clear existing content
    contentElement.innerHTML = '';

    // Render breadcrumbs if available
    if (breadcrumbs && Object.keys(breadcrumbs).length > 0) {
      this._renderBreadcrumbs(breadcrumbs, contentElement);
    }

    // Render menu
    const menuHtml = this._createMenuHTML(menu_key, options);
    contentElement.innerHTML += menuHtml;

    // Attach event handlers
    this._attachMenuHandlers(menu_key, options);

    this.logger.log('[MenuRenderer] Menu rendered successfully');
  }

  /**
   * Render menu inline (within a specific container, e.g., dashboard panel)
   * @param {Object} menuData - Menu data { menu_key, options, title, allow_back }
   * @param {HTMLElement} container - Container element to render menu into
   */
  renderMenuInline(menuData, container) {
    this.logger.log('[MenuRenderer]  Rendering inline menu:', menuData);
    this.logger.log('[MenuRenderer] Rendering inline menu', menuData);

    const { menu_key, options, title, _allow_back } = menuData;

    // Create menu HTML
    const menuHtml = this._createMenuHTML(menu_key || 'Menu', options, title);

    // Insert into container
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = menuHtml;
    const menuElement = tempDiv.firstElementChild;

    if (menuElement && container) {
      container.appendChild(menuElement);

      // Attach event handlers
      this._attachMenuHandlers(menu_key || 'Menu', options, menuElement);

      this.logger.log('[MenuRenderer] Inline menu rendered successfully');
    } else {
      this.logger.error('[MenuRenderer] [ERROR] Failed to render inline menu');
    }
  }

  /**
   * Create menu HTML with zTheme classes
   * @private
   */
  _createMenuHTML(menuKey, options, customTitle = null) {
    const menuTitle = customTitle || menuKey.replace(/[*~]/g, '').trim() || 'Menu';

    return `
      <div class="zMenu-container zCard zp-4 zmy-4" data-menu="${this._escapeHtml(menuKey)}">
        <h2 class="zCard-title zmb-4">${this._escapeHtml(menuTitle)}</h2>
        <div class="zMenu-options">
          ${options.map((opt, idx) => this._createOptionHTML(opt, idx)).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Create HTML for a single menu option
   * @private
   */
  _createOptionHTML(option, index) {
    const label = option.label || option.key || option;
    const key = option.key || option;

    return `
      <div class="zMenu-option zmb-2" data-key="${this._escapeHtml(key)}">
        <button class="zBtn zBtn-outline-primary w-100 text-start zp-3" data-index="${index}">
          <span class="zBadge zBadge-secondary me-2">${index}</span>
          ${this._escapeHtml(label.replace(/[*~^$]/g, ''))}
        </button>
      </div>
    `;
  }

  /**
   * Render breadcrumbs
   * @private
   */
  _renderBreadcrumbs(breadcrumbs, container) {
    const breadcrumbsHtml = `
      <nav aria-label="breadcrumb" class="zmb-3">
        <ol class="breadcrumb">
          ${Object.entries(breadcrumbs).map(([_scope, trail]) => `
            <li class="breadcrumb-item active">${this._escapeHtml(trail)}</li>
          `).join('')}
        </ol>
      </nav>
    `;
    container.innerHTML = breadcrumbsHtml;
  }

  /**
   * Attach click and keyboard handlers to menu options
   * @private
   */
  _attachMenuHandlers(menuKey, options, containerElement = null) {
    // If container is provided, scope query to it; otherwise use document
    const root = containerElement || document;
    const optionButtons = root.querySelectorAll('.zMenu-option button');

    optionButtons.forEach((button, _idx) => {
      button.addEventListener('click', () => {
        const optionDiv = button.closest('.zMenu-option');
        const selectedKey = optionDiv.dataset.key;

        this.logger.log('[MenuRenderer]  Menu selection:', selectedKey);
        this.logger.log('[MenuRenderer] Menu selection', { menu: menuKey, selected: selectedKey });

        // Visual feedback
        button.classList.add('active');
        button.disabled = true;

        // Send selection to backend
        this._sendMenuSelection(menuKey, selectedKey);
      });
    });

    // Keyboard navigation (0-9 for options)
    const keydownHandler = (e) => {
      const num = parseInt(e.key);
      if (!isNaN(num) && num < optionButtons.length) {
        optionButtons[num].click();
        // Remove handler after selection
        document.removeEventListener('keydown', keydownHandler);
      }
    };

    document.addEventListener('keydown', keydownHandler);
    this.logger.log('[MenuRenderer]  Keyboard navigation enabled (0-9)');
  }

  /**
   * Render a zMenu event (new primitive format) inline into the content zone.
   * Wire format: { event: 'zMenu', options: string[], title: string|null, allow_back: bool, requestId: string|null }
   *
   * Appends a menu card to the active content zone. On selection sends
   * input_response back to Python (requestId will be populated once
   * ChunkedExecutor wires the async input_request path).
   *
   * @param {Object} message - zMenu event payload
   * @param {string} [zone='zVaF-content'] - Target DOM element ID
   */
  renderZMenu(message, zone = 'zVaF-content') {
    this.logger.log('[MenuRenderer] renderZMenu:', message);

    const { options = [], title = null, allow_back = false, requestId = null } = message;
    // Accept a DOM element directly or an element ID string
    const container = (zone instanceof Element || zone instanceof DocumentFragment)
      ? zone
      : document.getElementById(zone);
    if (!container) {
      this.logger.error(`[MenuRenderer] Zone not found: ${zone}`);
      return;
    }

    const menuTitle = title || 'Select an option';
    const menuEl = document.createElement('div');
    menuEl.className = 'zMenu-container zCard zp-4 zmy-4';
    menuEl.dataset.zmenu = menuTitle;
    if (requestId) menuEl.dataset.requestId = requestId;

    // Title
    const titleEl = document.createElement('h3');
    titleEl.className = 'zCard-title zmb-3';
    titleEl.textContent = menuTitle;
    menuEl.appendChild(titleEl);

    // Option buttons
    const optionsEl = document.createElement('div');
    optionsEl.className = 'zMenu-options zd-flex zflex-column zgap-2';

    options.forEach((optKey, idx) => {
      const label = optKey.replace(/_/g, ' ');
      const btn = document.createElement('button');
      btn.className = 'zBtn zBtn-outline-primary text-start zp-3 w-100';
      btn.dataset.key = optKey;
      btn.dataset.index = idx;
      btn.innerHTML = `<span class="zBadge zBadge-secondary me-2">${idx + 1}</span>${this._escapeHtml(label)}`;
      btn.addEventListener('click', () => {
        // Visual feedback
        btn.classList.add('active');
        menuEl.querySelectorAll('button').forEach(b => { b.disabled = true; });
        this._sendMenuSelection(menuTitle, optKey, requestId);
      });
      optionsEl.appendChild(btn);
    });

    // Back button (if allow_back)
    if (allow_back) {
      const backBtn = document.createElement('button');
      backBtn.className = 'zBtn zBtn-secondary zmt-2 text-start zp-3 w-100';
      backBtn.dataset.key = '__back__';
      backBtn.innerHTML = '<span class="zBadge zBadge-secondary me-2">↩</span>Back';
      backBtn.addEventListener('click', () => {
        backBtn.disabled = true;
        this._sendMenuSelection(menuTitle, '__back__', requestId);
      });
      optionsEl.appendChild(backBtn);
    }

    menuEl.appendChild(optionsEl);
    container.appendChild(menuEl);

    // Keyboard shortcuts (1–9)
    const optBtns = optionsEl.querySelectorAll('button[data-key]');
    const keyHandler = (e) => {
      const n = parseInt(e.key);
      if (n >= 1 && n <= optBtns.length) {
        optBtns[n - 1].click();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);
    this.logger.log('[MenuRenderer] zMenu rendered inline, waiting for selection');
  }

  /**
   * Send menu selection to backend via WebSocket
   * @private
   */
  _sendMenuSelection(menuKey, selected, requestId = null) {
    // Use input_response when requestId is available (ChunkedExecutor async path)
    // Fall back to menu_selection for legacy/old-menu flows
    const message = requestId
      ? { event: 'input_response', requestId, value: selected }
      : { event: 'menu_selection', menu_key: menuKey, selected };

    this.logger.log('[MenuRenderer] Sending menu selection to backend:', message);
    this.client.send(message);
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
}

