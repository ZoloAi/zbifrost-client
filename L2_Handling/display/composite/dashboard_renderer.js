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
 *   - The renderer owns click→activate (set .zActive on link + .zTab-pane). It
 *     does NOT rely on window.zTheme.initTabs(), which can be the host page's
 *     external theme at render time and leave panes unwired (race).
 *   - zdisplay_orchestrator.js targets .zDash-panel .zTab-pane.zActive for rendering
 *
 * Content loading:
 *   - Default panel: deferred WS execute_walker on init (setTimeout 0)
 *   - Other panels:  lazy-loaded via WS on first click (once per pane)
 */

import { createDiv } from '../primitives/generic_containers.js';

export default class DashboardRenderer {
  constructor(logger, client) {
    this.logger = logger;
    this.client = client;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async render(config, targetElement) {
    const { folder, sidebar, panels = {}, default: defaultPanel, type = 'sidebar', _zClass } = config;
    this.logger.log('[DashboardRenderer] render config:', config);

    const container  = this._buildStructure(sidebar, panels, defaultPanel, type);
    // Apply _zClass from zUI onto the container (e.g. _zClass: crm-dashboard)
    if (_zClass) {
      _zClass.split(/[\s,]+/).filter(Boolean).forEach(c => container.classList.add(c));
    }
    const nav        = container.querySelector('.zDash-sidebar');
    const tabContent = container.querySelector('.zDash-panel');
    const toggleBtn  = container.querySelector('.zDash-sidebar-toggle');

    if (targetElement) {
      targetElement.appendChild(container);
    }

    // Wire mobile sidebar toggle (hamburger)
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        container.classList.toggle('zDash-sidebar-open');
      });

      // Close sidebar on outside click
      document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
          container.classList.remove('zDash-sidebar-open');
        }
      });
    }

    // ── Tab switching + lazy panel load — OWNED by the renderer ───────────────
    // We deliberately do NOT depend on window.zTheme.initTabs() here. The host
    // page (zVaF.html) loads its own ztheme.js, so at render time window.zTheme
    // can be that *external* theme whose initTabs() doesn't wire zBifrost panes;
    // zBifrost's own initTabs only becomes active after injectZBase swaps the
    // global in — which races behind this render and leaves links unwired.
    // Owning the click here makes zDash navigation deterministic regardless of
    // which theme is on window.zTheme.
    const links = nav ? [...nav.querySelectorAll('[data-bs-toggle="tab"]')] : [];

    const _activatePane = (panelName) => {
      links.forEach((l) => {
        const on = l.dataset.panel === panelName;
        l.classList.toggle('zActive', on);
        l.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) l.removeAttribute('tabindex'); else l.setAttribute('tabindex', '-1');
      });
      tabContent?.querySelectorAll('.zTab-pane').forEach((p) => {
        const on = p.id === `panel-${panelName}`;
        p.classList.toggle('zActive', on);
        if (on) {
          requestAnimationFrame(() => p.classList.add('zShow'));
        } else {
          p.classList.remove('zShow');
        }
      });
    };

    links.forEach((link) => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const panelName = link.dataset.panel;
        container.classList.remove('zDash-sidebar-open');
        _activatePane(panelName);
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

  _buildStructure(sidebar, panels, defaultPanel, type = 'sidebar') {
    const container  = createDiv({ class: `zContainer-fluid zDash-container zDash-format-${type}` });
    const row        = createDiv({ class: 'zRow zG-0' });
    const sidebarCol = createDiv({ class: 'zCol-auto' });
    const contentCol = createDiv({ class: 'zCol' });

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

    // Mobile hamburger — visible only on small viewports via CSS
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'zDash-sidebar-toggle';
    toggleBtn.setAttribute('aria-label', 'Toggle navigation');
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.innerHTML = '&#9776; Menu';

    sidebarCol.appendChild(nav);
    contentCol.appendChild(toggleBtn);
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
