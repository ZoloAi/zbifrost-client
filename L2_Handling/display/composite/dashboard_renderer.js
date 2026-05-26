/**
 * DashboardRenderer - Render zDash as zTheme native tab layout
 *
 * Uses zTheme's tab system:
 *   - Sidebar: .zNav.zFlex-column.zNav-pills with [data-bs-toggle="tab"] links
 *   - Content:  .zTab-content > .zTab-pane#panel-{Name} for each panel
 *   - zTheme.initTabs() wires click ↔ show/hide
 *   - zTabShown event triggers WS lazy-load on first visit
 *   - Default panel loads via deferred WS on init
 */

import { createDiv } from '../primitives/generic_containers.js';

export default class DashboardRenderer {
  constructor(logger, client) {
    this.logger = logger;
    this.client = client;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async render(config, targetElement) {
    const { folder, sidebar, panels = {}, default: defaultPanel } = config;

    this.logger.log('[DashboardRenderer] Rendering dashboard:', config);

    const container   = this._buildStructure(sidebar, panels, defaultPanel);
    const nav         = container.querySelector('.zDash-sidebar');
    const tabContent  = container.querySelector('.zTab-content');

    // Insert into DOM before triggering anything async
    if (targetElement) {
      targetElement.appendChild(container);
    }

    // Let zTheme wire its tab click ↔ show/hide behaviour
    if (window.zTheme?.initTabs) {
      window.zTheme.initTabs();
    }

    // Lazy-load on tab switch (only if pane not yet loaded)
    nav?.querySelectorAll('[data-bs-toggle="tab"]').forEach(link => {
      link.addEventListener('zTabShown', async () => {
        const panelName = link.dataset.panel;
        const pane = tabContent?.querySelector(`#panel-${panelName}`);
        if (pane && !pane.dataset.loaded) {
          await this._loadPanel(folder, panelName, pane);
        }
      });
    });

    // Load default panel once the element is in the DOM (next task tick)
    const defaultPaneName = defaultPanel || (sidebar?.[0] ?? null);
    if (defaultPaneName) {
      setTimeout(() => {
        const pane = tabContent?.querySelector(`#panel-${defaultPaneName}`);
        if (pane && !pane.dataset.loaded) {
          this._loadPanel(folder, defaultPaneName, pane);
        }
      }, 0);
    }

    return container;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _buildStructure(sidebar, panels, defaultPanel) {
    const container = createDiv({ class: 'zContainer-fluid zDash-container' });
    const row       = createDiv({ class: 'zRow zG-0' });

    // ── Sidebar column ──────────────────────────────────────────────────────
    const sidebarCol = createDiv({ class: 'zCol-auto' });
    const nav = document.createElement('nav');
    nav.className = 'zNav zFlex-column zNav-pills zDash-sidebar';
    nav.setAttribute('role', 'tablist');

    // ── Content column ──────────────────────────────────────────────────────
    const contentCol = createDiv({ class: 'zCol' });
    const tabContent = createDiv({ class: 'zTab-content zDash-panel', id: 'dashboard-panel-content' });

    // ── Build one nav-link + one tab-pane per sidebar item ──────────────────
    (sidebar || []).forEach((panelName) => {
      const isDefault = panelName === defaultPanel;
      const meta      = panels[panelName] || {};
      const panelId   = `panel-${panelName}`;
      const label     = meta.label || panelName.replace(/_/g, ' ');

      // Nav link
      const link = document.createElement('a');
      link.className = `zNav-link${isDefault ? ' zActive' : ''}`;
      link.href = `#${panelId}`;
      link.setAttribute('data-bs-toggle', 'tab');
      link.setAttribute('data-bs-target', `#${panelId}`);
      link.setAttribute('role', 'tab');
      link.setAttribute('aria-selected', isDefault ? 'true' : 'false');
      link.dataset.panel = panelName;
      if (!isDefault) link.setAttribute('tabindex', '-1');

      if (meta.icon) {
        const icon = document.createElement('i');
        icon.className = `bi ${meta.icon} zme-2`;
        link.appendChild(icon);
      }
      link.appendChild(document.createTextNode(label));
      nav.appendChild(link);

      // Tab pane (empty – filled by WS on first visit)
      const pane = createDiv({
        id: panelId,
        class: `zTab-pane${isDefault ? ' zActive' : ''}`,
        role: 'tabpanel',
      });
      pane.dataset.panel = panelName;
      tabContent.appendChild(pane);
    });

    sidebarCol.appendChild(nav);
    contentCol.appendChild(tabContent);
    row.appendChild(sidebarCol);
    row.appendChild(contentCol);
    container.appendChild(row);

    return container;
  }

  async _loadPanel(folder, panelName, pane) {
    if (!this.client?.connection) {
      this.logger.warn('[DashboardRenderer] No WS connection – cannot load panel', panelName);
      return;
    }

    pane.dataset.loaded = 'pending';

    // Show spinner while loading
    const spinner = createDiv({ class: 'zSpinner-border zSpinner-border-sm zText-muted zm-3', role: 'status' });
    pane.innerHTML = '';
    pane.appendChild(spinner);

    try {
      // Ask the chunk renderer to target THIS pane via a custom attribute
      // The orchestrator checks for #dashboard-panel-content first – we temporarily
      // give the pane that id so incoming chunks land in the right place.
      const prevId = pane.id;
      pane.id = 'dashboard-panel-content';

      await this.client.connection.send(JSON.stringify({
        event:        'execute_walker',
        zBlock:       panelName,
        zVaFile:      `zUI.${panelName}`,
        zVaFolder:    folder,
        _renderTarget: prevId,
      }));

      // Restore after a render cycle (chunks arrive async; the id swap is a hint
      // for the first chunk – subsequent chunks use querySelector which still finds it)
      setTimeout(() => {
        if (pane.id === 'dashboard-panel-content') pane.id = prevId;
        pane.dataset.loaded = 'done';
      }, 3000);

    } catch (err) {
      this.logger.error(`[DashboardRenderer] Failed to load panel ${panelName}:`, err);
      pane.innerHTML = `<div class="zAlert zAlert-danger zm-2">Failed to load ${panelName}</div>`;
      pane.dataset.loaded = 'error';
    }
  }
}
