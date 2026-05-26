/**
 * DashboardRenderer — zTheme native tab layout for zDash
 *
 * Structure:
 *   .zDash-container
 *     .zRow.zG-0
 *       .zCol-auto  →  nav.zNav.zFlex-column.zNav-pills.zDash-sidebar [role=tablist]
 *       .zCol       →  .zTab-content.zDash-panel
 *                        .zTab-pane#panel-{Name} (one per sidebar item)
 *
 * Tab switching:
 *   - zTheme.initTabs() wires [data-bs-toggle="tab"] → show/hide .zTab-pane
 *   - zdisplay_orchestrator.js targets .zDash-panel .zTab-pane.zActive for rendering
 *
 * Content loading:
 *   - Default panel: deferred WS execute_walker on init (setTimeout 0)
 *   - Other panels:  lazy-loaded via WS on first zTabShown event
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
    this.logger.log('[DashboardRenderer] render config:', config);

    const container  = this._buildStructure(sidebar, panels, defaultPanel);
    const nav        = container.querySelector('.zDash-sidebar');
    const tabContent = container.querySelector('.zDash-panel');

    if (targetElement) {
      targetElement.appendChild(container);
    }

    // Wire zTheme tab show/hide behaviour
    if (window.zTheme?.initTabs) {
      window.zTheme.initTabs();
    }

    // Lazy-load panel content on first tab switch
    nav?.querySelectorAll('[data-bs-toggle="tab"]').forEach(link => {
      link.addEventListener('zTabShown', async () => {
        const panelName = link.dataset.panel;
        const pane = tabContent?.querySelector(`#panel-${panelName}`);
        if (pane && !pane.dataset.loaded) {
          await this._loadPanel(folder, panelName, pane);
        }
      });
    });

    // Load default panel once in the DOM
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
    const container  = createDiv({ class: 'zContainer-fluid zDash-container' });
    const row        = createDiv({ class: 'zRow zG-0' });
    // Structural layout: sidebar+panel always side-by-side regardless of app CSS
    row.style.cssText = 'display:flex;flex-wrap:nowrap;align-items:flex-start;';
    const sidebarCol = createDiv({ class: 'zCol-auto' });
    sidebarCol.style.cssText = 'flex-shrink:0;';
    const contentCol = createDiv({ class: 'zCol' });
    contentCol.style.cssText = 'flex:1;min-width:0;';

    const nav = document.createElement('nav');
    nav.className = 'zNav zFlex-column zNav-pills zDash-sidebar';
    nav.setAttribute('role', 'tablist');

    const tabContent = createDiv({ class: 'zTab-content zDash-panel' });

    (sidebar || []).forEach((panelName) => {
      const isDefault = panelName === defaultPanel;
      const meta      = panels[panelName] || {};
      const label     = meta.label || panelName.replace(/_/g, ' ');
      const paneId    = `panel-${panelName}`;

      // Nav link — zTheme uses data-bs-target to show/hide panes
      const link = document.createElement('a');
      link.className = `zNav-link${isDefault ? ' zActive' : ''}`;
      link.href = `#${paneId}`;
      link.setAttribute('data-bs-toggle', 'tab');
      link.setAttribute('data-bs-target', `#${paneId}`);
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

      // Tab pane — chunk renderer targets .zDash-panel .zTab-pane.zActive
      const pane = createDiv({
        id: paneId,
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
      this.logger.warn('[DashboardRenderer] No WS connection — cannot load panel', panelName);
      return;
    }

    pane.dataset.loaded = 'pending';
    pane.innerHTML = '<div class="zSpinner-border zSpinner-border-sm zText-muted zm-3" role="status"></div>';

    try {
      await this.client.connection.send(JSON.stringify({
        event:         'execute_walker',
        zBlock:        panelName,
        zVaFile:       `zUI.${panelName}`,
        zVaFolder:     folder,
        _renderTarget: 'dashboard-panel-content',
      }));
      setTimeout(() => { pane.dataset.loaded = 'done'; }, 2000);
    } catch (err) {
      this.logger.error(`[DashboardRenderer] Failed to load panel ${panelName}:`, err);
      pane.innerHTML = `<div class="zAlert zAlert-danger zm-2">Failed to load ${panelName}</div>`;
      pane.dataset.loaded = 'error';
    }
  }
}
