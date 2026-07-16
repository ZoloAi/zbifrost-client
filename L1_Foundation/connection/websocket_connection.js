/**
 * L1_Foundation/connection/websocket_connection.js
 * 
 * WebSocket Connection - Browser WebSocket Connection Management
 * 
 * Handles WebSocket connection lifecycle, auto-reconnect, and message routing.
 * Extracted from bifrost_client.js inline stub (Task 0, Step 1.5)
 * 
 * @module connection/websocket_connection
 * @layer L1 (Foundation)
 */

import { TIMEOUTS } from '../constants/bifrost_constants.js';

export class WebSocketConnection {
  constructor(url, logger, hooks, options = {}) {
    this.url = url;
    this.logger = logger;
    this.hooks = hooks;
    this.options = {
      autoReconnect: options.autoReconnect !== false,
      reconnectDelay: options.reconnectDelay || TIMEOUTS.RECONNECT_DELAY
    };
    this.ws = null;
    this._messageCallback = null;   // re-bound on every (re)connect — see onMessage()
    this._intentionalClose = false; // disconnect() was called — stay down
    this._reconnectPending = false; // one reconnect in flight at a time
    this._bindWakeListeners();
  }

  /**
   * Instant reconnect on tab wake / network return.
   *
   * Mobile browsers kill the socket when a tab backgrounds — often with a
   * CLEAN close, which the onclose reconnect used to skip entirely, and even
   * a scheduled retry sat in a FROZEN timer until well after the user was
   * back. Result: return to the tab, tap, dead socket, error toast — a false
   * positive, since the next interaction reconnected anyway. These listeners
   * make the wake itself the trigger: page becomes visible / bfcache-restores
   * / network returns → if the socket isn't OPEN, reconnect NOW. Intentional
   * disconnect() stays respected (the offline debug toggle depends on it).
   */
  _bindWakeListeners() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const wake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (this._intentionalClose || this.isConnected()) return;
      this._reconnect('wake');
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
  }

  /**
   * Guarded reconnect — at most one attempt in flight; re-binds the message
   * callback (connect() creates a FRESH ws, and a reconnect that forgets the
   * onmessage re-bind is a deaf socket).
   * @private
   */
  _reconnect(reason) {
    if (this._reconnectPending || this._intentionalClose || this.isConnected()) return;
    this._reconnectPending = true;
    this.logger.info(`Reconnecting (${reason})...`);
    this.connect()
      .catch(err => { this.logger.error('Reconnect failed:', err); })
      .finally(() => { this._reconnectPending = false; });
  }

  /**
   * Check if WebSocket is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Effective connect URL — appends the blue-green resume id (prior server
   * full_session_id) when one is remembered, so a reconnect that lands on a
   * swapped-in instance resumes the same session. No id (first connect / cleared
   * storage) → the base URL, i.e. today's fresh-mint behavior.
   * @returns {string}
   */
  _effectiveUrl() {
    let url = this.url;
    try {
      const resumeId = (typeof sessionStorage !== 'undefined')
        ? sessionStorage.getItem('zOS_resume_id') : null;
      if (resumeId) {
        url += (url.includes('?') ? '&' : '?') + 'zresume=' + encodeURIComponent(resumeId);
      }
      // Per-tab trail token (ztab): sessionStorage is scoped to THIS tab and
      // survives a reload (but not a new tab), so the server can rehydrate this
      // tab's crumb trail on reconnect and keep browser Back/Forward in lockstep
      // with the engine trail. Mint once per tab; a new tab mints a fresh token →
      // a fresh trail. Paired with the zsid IDENTITY cookie (per browser) — scope
      // dictates the carrier: cookie for identity, sessionStorage for the trail.
      if (typeof sessionStorage !== 'undefined') {
        let ztab = sessionStorage.getItem('zOS_tab');
        if (!ztab) {
          ztab = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
          sessionStorage.setItem('zOS_tab', ztab);
        }
        url += (url.includes('?') ? '&' : '?') + 'ztab=' + encodeURIComponent(ztab);
      }
    } catch (_) { /* storage unavailable — connect without resume/ztab */ }
    return url;
  }

  /**
   * Connect to WebSocket server
   * @returns {Promise<void>}
   */
  async connect() {
    this._intentionalClose = false;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this._effectiveUrl());

      // Re-bind the message pump on EVERY connect — a reconnect creates a
      // fresh ws, and the callback registered on the old one dies with it.
      if (this._messageCallback) {
        this.ws.onmessage = this._messageCallback;
      }

      this.ws.onopen = () => {
        this.logger.info('Connected to server');
        this.hooks.call('onConnected', { url: this.url });
        resolve();
      };
      
      this.ws.onerror = (error) => {
        this.logger.error('WebSocket error:', error);
        this.hooks.call('onError', error);
        reject(error);
      };
      
      this.ws.onclose = (event) => {
        this.logger.info('Disconnected from server');
        this.hooks.call('onDisconnected', event);
        
        // Auto-reconnect regardless of wasClean — mobile browsers close the
        // socket CLEANLY when a tab backgrounds, and that close deserves a
        // retry too. Intentional disconnect() is the one true opt-out.
        if (this.options.autoReconnect && !this._intentionalClose) {
          setTimeout(() => this._reconnect('close'), this.options.reconnectDelay);
        }
      };
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    this._intentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Send message to server
   * @param {string} msg - Message to send (JSON string)
   */
  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.logger.warn('Cannot send message: WebSocket not connected');
    }
  }

  /**
   * Set message handler callback
   * @param {Function} callback - Callback function for incoming messages
   */
  onMessage(callback) {
    this._messageCallback = callback; // survives reconnects (re-bound in connect())
    if (this.ws) {
      this.ws.onmessage = callback;
    }
  }
}
