/**
 * bifrost_client.js — Thin bootstrap for BifrostCore
 *
 * Phase 4: Reduced to ~180 lines.
 * Responsibilities:
 *   1. Read zui-config from DOM
 *   2. Open a raw WebSocket to receive connection_info
 *   3. connection_info.bifrost_core_url → dynamic import(url) of the real client
 *   4. Instantiate BifrostCore and set window.bifrostClient
 *   5. Forward registerHook() calls queued before core is ready
 *
 * Intelligence lives in bifrost_core.js (server-controlled URL = Phase 3B).
 * zVaF.html still does: new BifrostClient(null, { autoConnect: true }) — unchanged.
 */

(function (root) {
  'use strict';

  // ─── helpers ────────────────────────────────────────────────────────────────

  function readZuiConfig() {
    try {
      const el = document.getElementById('zui-config');
      return el ? JSON.parse(el.textContent) : {};
    } catch (_) { return {}; }
  }

  function buildWsUrl(wsCfg) {
    wsCfg = wsCfg || {};
    const proto = wsCfg.ssl_enabled ? 'wss' : 'ws';
    const host  = wsCfg.host || '127.0.0.1';
    const port  = wsCfg.port || 8765;
    return `${proto}://${host}:${port}`;
  }

  function makeLogger(cfg) {
    const isProd = cfg.deployment === 'Production';
    const prefix = '[BifrostBootstrap]';
    return {
      debug: isProd ? () => {} : (...a) => console.debug(prefix, ...a),
      info:  isProd ? () => {} : (...a) => console.info(prefix,  ...a),
      warn:  (...a) => console.warn(prefix,  ...a),
      error: (...a) => console.error(prefix, ...a),
    };
  }

  // ─── BifrostClient (bootstrap) ──────────────────────────────────────────────

  class BifrostClient {
    constructor(url, options = {}) {
      this._cfg   = readZuiConfig();
      this._opts  = options;
      this._url   = url || buildWsUrl(this._cfg.websocket);
      this._core  = null;
      this._coreLoading = false;
      this._pendingHooks = [];   // hooks registered before core is ready
      this.logger = makeLogger(this._cfg);

      if (options.autoConnect !== false) {
        this._bootstrap();
      }
    }

    // ── bootstrap: minimal WS just to receive connection_info ─────────────────

    _bootstrap() {
      const ws = this._ws = new WebSocket(this._url);

      ws.addEventListener('open', () => {
        this.logger.info('Connected (bootstrap)');
        // Do NOT send execute_walker here — BifrostCore will do it on its own connect.
        // Sending here would cause a redundant server-side walker execution on an
        // orphaned WS connection that we are about to close.
      });

      ws.addEventListener('message', ({ data }) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.event === 'connection_info' && !this._core) {
          this._loadCore(msg).catch(err => this.logger.error('Core load failed:', err));
        }
        // All other messages are ignored by the bootstrap; BifrostCore handles them.
      });

      ws.addEventListener('close', () => {
        if (!this._core && !this._coreLoading) this.logger.warn('Bootstrap WS closed before core loaded');
      });

      ws.addEventListener('error', () => {
        this.logger.error('Bootstrap WS error');
      });
    }

    // ── core loading ──────────────────────────────────────────────────────────

    async _loadCore(connectionInfo) {
      this._coreLoading = true;
      // 3B: server tells us the authoritative core URL; falls back to local
      const coreUrl = connectionInfo.bifrost_core_url || '/bifrost/src/bifrost_core.js';
      this.logger.info('Loading core from', coreUrl);

      // Close the bootstrap WS cleanly before the core opens its own
      this._ws.close();

      const mod = await import(coreUrl);

      // Instantiate BifrostCore — it reads zui-config itself, connects, sends execute_walker
      const core = new mod.BifrostCore(this._url, {
        autoConnect: true,
        zTheme:      false,   // ztheme.js already loaded by zVaF.html
        ...this._opts,
      });

      this._core = core;
      window.bifrostClient = core;

      // Replay any hooks registered on the bootstrap before the core was ready
      for (const { hookName, fn } of this._pendingHooks) {
        core.registerHook(hookName, fn);
      }
      this._pendingHooks = [];

      this.logger.info('Core attached — window.bifrostClient is now BifrostCore');
    }

    // ── forwarding API (called by zVaF.html / menu_integration before core ready) ──

    registerHook(hookName, fn) {
      if (this._core) {
        this._core.registerHook(hookName, fn);
      } else {
        this._pendingHooks.push({ hookName, fn });
      }
    }

    unregisterHook(hookName) {
      if (this._core) this._core.unregisterHook(hookName);
    }

    send(data) {
      if (this._core) return this._core.send(data);
      this.logger.warn('send() called before core is ready');
    }

    read(resource, params) {
      if (this._core) return this._core.read(resource, params);
      return Promise.reject(new Error('BifrostClient: core not yet loaded'));
    }

    // Expose connect() for callers who do: client.connect() manually
    async connect() {
      // Bootstrap already opened a WS; if core is loaded, delegate
      if (this._core) return this._core.connect();
      // Otherwise wait for core to be ready (already bootstrapping)
      return new Promise((resolve) => {
        const poll = setInterval(() => {
          if (this._core) { clearInterval(poll); resolve(); }
        }, 50);
      });
    }
  }

  // Expose globally — zVaF.html does: window.bifrostClient = new BifrostClient(...)
  root.BifrostClient = BifrostClient;

}(typeof self !== 'undefined' ? self : this));
