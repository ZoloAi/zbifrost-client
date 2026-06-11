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
    } catch (_) { /* storage unavailable — connect without resume */ }
    return url;
  }

  /**
   * Connect to WebSocket server
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this._effectiveUrl());
      
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
        
        // Auto-reconnect if enabled and connection was not cleanly closed
        if (this.options.autoReconnect && !event.wasClean) {
          setTimeout(() => {
            this.logger.info('Attempting to reconnect...');
            this.connect().catch(err => {
              this.logger.error('Reconnect failed:', err);
            });
          }, this.options.reconnectDelay);
        }
      };
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
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
    if (this.ws) {
      this.ws.onmessage = callback;
    }
  }
}
