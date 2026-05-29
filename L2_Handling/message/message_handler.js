/**
 * ═══════════════════════════════════════════════════════════════
 * Message Handler Module - Message Processing & Correlation
 * ═══════════════════════════════════════════════════════════════
 * 
 * @module core/message_handler
 * @layer 4 (Event Handlers)
 */

// Constants
import { TIMEOUTS, EVENT_TYPES } from '../../L1_Foundation/constants/bifrost_constants.js';

// zRender op-code decoder — reverse map of render_opcodes.py (op → display handler key)
// This table contains no business logic, wizard flows, or application routes.
const _ZRENDER_OPS = {"tx":"text","hd":"header","im":"image","rt":"rich_text","ic":"icon","zu":"zURL","zt":"zTable","er":"error","wr":"warning","su":"success","inf":"info","rs":"read_string","pb":"progress_bar","mn":"zMenu","zd":"zDash","zdl":"zDialog","zi":"zInput","sep":"separator","cod":"code","lnk":"link","bdg":"badge","spn":"spinner","ls":"list","dl":"dl","btn":"button","rb":"read_bool","rp":"read_password","jsn":"json","div":"divider","crd":"card","ztrm":"zTerminal","sel":"selection","zcr":"zCrumbs","pc":"progress_complete","swi":"swiper_init"};

function _decodeRenderNode(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(_decodeRenderNode);
  // Node with an op code — decode and recurse into children
  if ('e' in node && _ZRENDER_OPS[node.e]) {
    const decoded = { event: _ZRENDER_OPS[node.e] };
    for (const [k, v] of Object.entries(node)) {
      if (k === 'e') continue;
      decoded[k] = _decodeRenderNode(v);
    }
    return decoded;
  }
  // Container / metadata node — recurse into all values
  const decoded = {};
  for (const [k, v] of Object.entries(node)) {
    decoded[k] = _decodeRenderNode(v);
  }
  return decoded;
}

export class MessageHandler {
  constructor(logger, hooks, client = null) {
    this.logger = logger;
    this.hooks = hooks;
    this.client = client; // Store reference to BifrostClient for client-side navigation

    // Pass logger to hooks for better error handling
    if (this.hooks && typeof this.hooks.logger === 'undefined') {
      this.hooks.logger = logger;
    }

    this.requestId = 0;
    this.callbacks = new Map();
    this.timeout = TIMEOUTS.REQUEST_TIMEOUT; // Default timeout from constants
  }

  /**
   * Set timeout for requests
   */
  setTimeout(timeout) {
    this.timeout = timeout;
  }

  /**
   * Extract session ID from HTTP cookie for session sync
   * @private
   * @returns {string|null} Session ID or null if not found
   */
  _getSessionIdFromCookie() {
    // Parse all cookies
    const cookies = document.cookie.split(';');

    // Look for 'session' cookie (Flask default) or 'sessionid' (Django)
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'session' || name === 'sessionid') {
        this.logger.log(`[MessageHandler]  Found session cookie: ${name}=${value.substring(0, 10)}...`);
        return value;
      }
    }

    this.logger.log('[MessageHandler] [WARN]  No session cookie found (user not logged in)');
    return null;
  }

  /**
   * Validate outgoing message follows protocol
   * @private
   */
  _validateOutgoingMessage(payload) {
    // Warn if using deprecated 'action' field
    if (payload.action && !payload.event) {
      this.logger.warn(
        'Using deprecated "action" field. Please use "event" instead.',
        { action: payload.action }
      );
      // Auto-migrate: copy action to event
      payload.event = payload.action;
    }

    // Warn if message has both 'action' and 'event'
    if (payload.action && payload.event && payload.action !== payload.event) {
      this.logger.warn(
        'Message has both "action" and "event" fields with different values. Using "event".',
        { action: payload.action, event: payload.event }
      );
      delete payload.action;
    }
  }

  /**
   * Handle incoming message
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      this.logger.debug('[MessageHandler] Received message:', message.event || message.display_event || 'unknown');
      
      // Debug zDialog messages to see full structure
      if (message.display_event === 'zDialog' || (message.data && message.data.event === 'zDialog')) {
        this.logger.log('[MessageHandler] zDialog message structure:', JSON.stringify(message, null, 2));
      }

      // Call general message hook (with error boundary)
      try {
        this.hooks.call('onMessage', message);
      } catch (hookError) {
        this.logger.error('[MessageHandler] Error in onMessage hook:', hookError);
        // Continue processing - don't let hook errors break message handling
      }

      // Progressive chunk rendering (zWizard chunked execution for Bifrost)
      // MUST be checked BEFORE response correlation (chunks have _requestId but are NOT responses)
      if (message.event === EVENT_TYPES.RENDER_CHUNK) {
        this.logger.debug('[MessageHandler] Chunk event detected:', message.chunk_num);
        // Decode zRender op codes back to display event names before handing to renderers
        if (message.data) {
          message.data = _decodeRenderNode(message.data);
        }
        try {
          this.hooks.call('onRenderChunk', message);
        } catch (hookError) {
          this.logger.error('[MessageHandler] Error rendering chunk:', hookError);
          this.hooks.call('onError', { type: 'chunk_render_error', error: hookError, message });
        }
        return;
      }

      // Connection info event (session data from backend) - v1.6.0
      if (message.event === EVENT_TYPES.CONNECTION_INFO) {
        this.logger.debug('[MessageHandler] Connection info detected');
        this.hooks.call('onConnectionInfo', message.data);
        // Also trigger onConnected for backward compatibility
        this.hooks.call('onConnected', message.data);
        return;
      }

      // Error event from backend (walker execution errors, validation errors, etc.)
      if (message.event === EVENT_TYPES.ERROR || message.event === 'error') {
        this.logger.error('[MessageHandler] Backend error received:', message.message || message.error);
        
        // Clear navigation timeout if active
        if (this.client && this.client._navigationTimeout) {
          clearTimeout(this.client._navigationTimeout);
          this.client._navigationTimeout = null;
        }
        
        // Show error in content area
        if (this.client && this.client._zVaFElement) {
          this.client._zVaFElement.innerHTML = `
            <div class="zAlert zAlert-danger zmt-4">
              <strong>Backend Error:</strong> ${message.message || message.error || 'Unknown error'}
              ${message.details ? `<br><small>${message.details}</small>` : ''}
            </div>
          `;
        }
        
        // Call error hook
        this.hooks.call('onError', message);
        return;
      }

      // Navigate back event (^ bounce-back after block completion)
      if (message.event === EVENT_TYPES.NAVIGATE_BACK) {
        this.logger.log('[MessageHandler] NAVIGATE_BACK EVENT - triggering browser back');
        this.logger.log('[MessageHandler] Reason:', message.reason);

        // For bounce-back completions (e.g., after login/logout), always navigate to home via client-side nav
        // This avoids double-back issues and ensures correct block loading
        if (message.reason === 'bounce_back_block_completed') {
          // Refresh NavBar after any bounce (RBAC updates after login/logout).
          const refreshNav = () => {
            if (typeof this.client._fetchAndPopulateNavBar === 'function') {
              this.logger.log('[MessageHandler] Refreshing NavBar after bounce-back');
              this.client._fetchAndPopulateNavBar().catch(err => {
                this.logger.error('[MessageHandler] Failed to refresh NavBar:', err);
              });
            }
          };

          // ^ bounce block (no explicit target): return to the previous page.
          if (message.back) {
            this.logger.log('[MessageHandler] Bounce-back - returning to previous page');
            window.history.back();
            // History navigation re-renders asynchronously; refresh navbar after it settles.
            setTimeout(refreshNav, 300);
            return;
          }

          // Explicit (onSuccess) target, else home for plain bounces.
          const target = message.url || '/';
          this.logger.log('[MessageHandler] Bounce-back - navigating to ' + target + ' via client-side nav');
          if (this.client && typeof this.client._navigateToRoute === 'function') {
            this.client._navigateToRoute(target).then(refreshNav).catch(err => {
              this.logger.error('[MessageHandler] Navigation failed:', err);
            });
          } else {
            // Fallback: use window.location (will cause reload)
            window.location.href = target;
          }
          return;
        }

        // For RBAC denials, prefer an explicit redirect target (SSOT: zRBAC
        // onDenied / global login route resolved server-side). Falls back to
        // history.back()/home when no target was provided.
        if (message.reason === 'rbac_denied') {
          if (message.url) {
            this.logger.log('[MessageHandler] RBAC denied - redirecting to ' + message.url);
            if (this.client && typeof this.client._navigateToRoute === 'function') {
              this.client._navigateToRoute(message.url).then(() => {
                if (typeof this.client._fetchAndPopulateNavBar === 'function') {
                  this.client._fetchAndPopulateNavBar().catch(() => {});
                }
              }).catch(err => {
                this.logger.error('[MessageHandler] RBAC redirect failed:', err);
                window.location.href = message.url;
              });
            } else {
              window.location.href = message.url;
            }
            return;
          }

          const hasAppHistory = window.history.length > 2 ||
                                (window.history.length > 1 && document.referrer.includes(window.location.hostname));

          if (hasAppHistory) {
            this.logger.log('[MessageHandler] RBAC denied - using history.back()');
            window.history.back();
          } else {
            this.logger.log('[MessageHandler] RBAC denied, no history - navigating to home');
            if (this.client && typeof this.client._navigateToRoute === 'function') {
              this.client._navigateToRoute('/');
            } else {
              window.location.href = '/';
            }
          }
          return;
        }

        // Default: attempt history.back() for other navigate_back reasons
        this.logger.log('[MessageHandler] Other reason - using history.back()');
        window.history.back();
        return;
      }

      // Wizard gate result (post-gate steps from wizard_gate_submit)
      if (message.event === 'wizard_gate_result') {
        this.logger.debug('[MessageHandler] wizard_gate_result received for gate:', message.gateKey);
        this.hooks.call('onWizardGateResult', message);
        return;
      }

      // Dashboard event (zDash display event for sidebar navigation)
      if (message.event === 'zDash') {
        this.logger.debug('[MessageHandler] zDash event detected');
        this.logger.log(' [MessageHandler] Dashboard config:', message);
        this.hooks.call('onZDash', message);
        return;
      }

      // Menu event (menu navigation in Bifrost mode)
      // Note: Backend sends 'zMenu' not 'menu' (matches zDash, zDialog pattern)
      if (message.event === 'zMenu') {
        this.logger.debug('[MessageHandler] zMenu event detected');
        this.logger.log(' [MessageHandler] Menu config:', message);
        this.hooks.call('onMenu', message);
        return;
      }

      // RBAC denial event (access denied)
      if (message.event === 'rbac_denied') {
        this.logger.log(' [MessageHandler] RBAC ACCESS DENIED');
        this.logger.log(' RBAC Access Denied:', message.message);

        // Display the denial message
        if (message.message) {
          // Create a styled error display using zTheme classes
          const errorDiv = document.createElement('div');
          errorDiv.className = 'zAlert zAlert-danger zmt-4 zp-4';
          errorDiv.innerHTML = `
            <h3 class="zAlert-heading zmb-2"> Access Denied</h3>
            <div class="zAlert-body">${message.message.replace(/\n/g, '<br>')}</div>
            <hr class="zmy-3">
            <p class="zmb-0 zText-muted"><small>You will be redirected back in a moment...</small></p>
          `;

          // Clear content area and show error
          const contentArea = document.getElementById('zVaF-content');
          if (contentArea) {
            contentArea.innerHTML = '';  // Clear blank content
            contentArea.appendChild(errorDiv);
          }
        }

        return;
      }

      // Check if this is a response to a request
      const requestId = message._requestId;
      if (requestId !== undefined && this.callbacks.has(requestId)) {
        this._handleResponse(requestId, message);
        return;
      }

      // If a message looks like a BARE request/response (no event type) but carries
      // no _requestId while callbacks are pending, that's a real backend protocol bug.
      // Event-typed messages (execute_zfunc_response, execute_code_response,
      // input_response, …) legitimately carry `result` and route by their own
      // `event`/`requestId` below — they must NOT trip this guard or it false-fires
      // on every avatar zInja (execute_zfunc) render.
      if (!message.event &&
          (message.result !== undefined || message.error !== undefined) &&
          this.callbacks.size > 0) {
        this.logger.error(
          'Received response without _requestId! Backend must echo _requestId in all responses.',
          { message, pendingRequests: this.callbacks.size }
        );
        // Don't try to correlate - this is a backend bug that must be fixed
      }

      // Check for specific event types
      if (message.event === 'input_response') {
        return; // Handled internally by zDisplay
      }

      // Handle execute_zfunc_response — resolves promise in ZDisplayOrchestrator._executeZFunc
      if (message.event === 'execute_zfunc_response') {
        this.logger.log('[MessageHandler] execute_zfunc_response received:', message.requestId);
        this.hooks.call('onZFuncResponse', message);
        return;
      }

      // Handle execute_code_response for zTerminal
      if (message.event === 'execute_code_response') {
        this.logger.log('[MessageHandler] execute_code_response received:', message.requestId);
        // Route to TerminalRenderer's static handler
        const TerminalRenderer = window._TerminalRenderer;
        if (TerminalRenderer && TerminalRenderer.handleExecutionResponse) {
          TerminalRenderer.handleExecutionResponse(message.requestId, message);
        } else if (window._zTerminalResponses && window._zTerminalResponses[message.requestId]) {
          // Fallback to direct promise resolution
          window._zTerminalResponses[message.requestId](message);
          delete window._zTerminalResponses[message.requestId];
        }
        return;
      }

      // Handle request_input for zTerminal interactive input
      if (message.event === 'request_input') {
        this.logger.log('[MessageHandler] request_input received:', message.requestId, message.prompt, 'isPassword:', message.isPassword);

        // zFunc execution: route to inline widget rendered by ZDisplayOrchestrator
        if (message.zfuncRequestId) {
          this.hooks.call('onZFuncInput', message);
          return;
        }

        // Route to TerminalRenderer's static handler
        const TerminalRenderer = window._TerminalRenderer;
        if (TerminalRenderer && TerminalRenderer.handleInputRequest) {
          TerminalRenderer.handleInputRequest(
            message.requestId,
            message.prompt,
            message.inputType || 'text',
            message.required || false,
            message.isPassword || false,
            message.defaultValue || '',
            message.isReadonly || false,
            message.isDisabled || false,
            message.placeholder || '',
            message.datalist || [],
            message.min ?? null,
            message.max ?? null,
            message.step ?? null,
          );
        }
        return;
      }

      // Handle real-time output lines from execute_code execution (e.g. zText / Show_Result steps)
      if (message.event === 'output') {
        const TerminalRenderer = window._TerminalRenderer;
        if (TerminalRenderer && TerminalRenderer.handleOutput) {
          TerminalRenderer.handleOutput(message);
        }
        return;
      }

      // zTable event emitted standalone (non-walker contexts, or fallback).
      // In walker/chunk mode, zTable is now injected inline into render_chunk
      // (see advanced_table.py + message_walker._resolve_zdata_reads).
      if (message.event === 'zTable') {
        this.logger.log('[MessageHandler] Standalone zTable event received (non-chunk context)');
        this.hooks.call('onDisplay', { ...message, display_event: 'zTable' });
        return;
      }

      // Check for display events (supports multiple formats)
      // - Old: {event: 'display', data: {...}}
      // - New: {display_event: 'success', data: {...}}
      // - Progress: {event: 'progress_bar', ...} → treated as display event
      if (message.event === 'display' || message.type === 'display' || message.display_event) {
        this.logger.debug('[MessageHandler] Display event:', message.display_event);
        try {
          this.hooks.call('onDisplay', message);  // Pass full message with display_event
        } catch (hookError) {
          this.logger.error('[MessageHandler] Error in display event handler:', hookError);
          this.hooks.call('onError', { type: 'display_error', error: hookError, message });
        }
        return;
      }

      // Progress bar events - also route to display renderer
      if (message.event === 'progress_bar' || message.event === 'progress_complete') {
        message.display_event = 'progress_bar';
        this.hooks.call('onDisplay', message);
        this.hooks.call('onProgressBar', message);  // Also call specific hook for backwards compat
        return;
      }

      if (message.event === 'input_request' || message.type === 'input_request') {
        this.hooks.call('onInput', message);
        return;
      }

      if (message.event === 'progress_update') {
        this.hooks.call('onProgressUpdate', message);
        return;
      }

      if (message.event === 'progress_complete') {
        this.hooks.call('onProgressComplete', message);
        return;
      }

      // Spinner events
      if (message.event === 'spinner_start') {
        this.hooks.call('onSpinnerStart', message);
        return;
      }

      if (message.event === 'spinner_stop') {
        this.hooks.call('onSpinnerStop', message);
        return;
      }

      if (message.event === 'swiper_init') {
        this.hooks.call('onSwiperInit', message);
        return;
      }

      // App-level log event (zLogger / zos.app.log) — output to browser console
      if (message.event === 'app_log') {
        const level = (message.level || 'INFO').toUpperCase();
        const tag   = message.tag ? `[${message.tag}] ` : '';
        const line  = `${tag}${message.message}`;
        if      (level === 'ERROR' || level === 'CRITICAL') console.error('[zLog]', line);
        else if (level === 'WARNING')                        console.warn('[zLog]',  line);
        else if (level === 'DEBUG')                         console.debug('[zLog]', line);
        else                                                console.log('[zLog]',   line);
        return;
      }

      // zFunc execution signal — backend console confirmation, not a UI event
      if (message.event === 'zfunc_exec') {
        if (message.stdout) console.log('[zFunc stdout]', message.stdout);
        console.log('[zFunc]', message.spec, '→', message.result, message.success ? '✓' : '✗');
        return;
      }

      // Otherwise, treat as broadcast
      this._handleBroadcast(message);

    } catch (error) {
      this.logger.error('[ERROR][ERROR][ERROR] [MessageHandler] CRITICAL ERROR:', error);
      this.logger.error('[ERROR][ERROR][ERROR] [MessageHandler] Error stack:', error.stack);
      this.logger.error('[ERROR][ERROR][ERROR] [MessageHandler] Raw data:', data);
      this.logger.log('[ERROR] Failed to parse message', { data, error });
      this.hooks.call('onError', error);
    }
  }

  /**
   * Send a message and wait for response
   */
  async send(payload, sendFn, timeout = null) {
    try {
      // Validate message follows protocol
      this._validateOutgoingMessage(payload);

      // Attach session ID from HTTP cookie for session sync (WebSocket/HTTP bridge)
      // Only attach for walker execution requests, not for form submissions
      // (forms don't need session sync until AFTER successful login)
      const sessionId = this._getSessionIdFromCookie();
      if (sessionId && payload.event === 'execute_walker') {
        payload._sessionId = sessionId;
        this.logger.log('[MessageHandler]  Attached session ID to walker execution');
      }

      const requestId = this.requestId++;
      payload._requestId = requestId;

      const timeoutMs = timeout || this.timeout;

      return new Promise((resolve, reject) => {
        const callback = { resolve, reject };

        // Set timeout
        callback.timeoutId = setTimeout(() => {
          if (this.callbacks.has(requestId)) {
            this.callbacks.delete(requestId);
            reject(new Error(`Request timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);

        this.callbacks.set(requestId, callback);

        try {
          // Send message
          const message = JSON.stringify(payload);
          this.logger.log('Sending message', payload);
          sendFn(message);
        } catch (sendError) {
          // Clean up callback on send failure
          this.callbacks.delete(requestId);
          if (callback.timeoutId) {
            clearTimeout(callback.timeoutId);
          }
          reject(new Error(`Failed to send message: ${sendError.message}`));
        }
      });
    } catch (error) {
      this.logger.error('[MessageHandler] Error in send():', error);
      throw error; // Propagate to caller
    }
  }

  /**
   * Handle response to a request
   * @private
   */
  _handleResponse(requestId, message) {
    try {
      const callback = this.callbacks.get(requestId);
      if (!callback) {
        return;
      }

      this.callbacks.delete(requestId);

      // Clear timeout
      if (callback.timeoutId) {
        clearTimeout(callback.timeoutId);
      }

      // Resolve or reject
      if (message.error) {
        callback.reject(new Error(message.error));
      } else {
        // Return entire message (minus _requestId) for flexibility
        // Some responses use 'result' field, others use 'success', 'data', etc.
        const { _requestId, ...response } = message;
        callback.resolve(response.result !== undefined ? response.result : response);
      }
    } catch (error) {
      this.logger.error('[MessageHandler] Error handling response:', error);
      // Attempt to reject the callback if it still exists
      const callback = this.callbacks.get(requestId);
      if (callback) {
        this.callbacks.delete(requestId);
        if (callback.timeoutId) {
          clearTimeout(callback.timeoutId);
        }
        callback.reject(new Error(`Response handling error: ${error.message}`));
      }
    }
  }

  /**
   * Handle broadcast message
   * @private
   */
  _handleBroadcast(message) {
    try {
      this.logger.debug('Broadcast received:', message.type);
      this.hooks.call('onBroadcast', message);
    } catch (error) {
      this.logger.error('[MessageHandler] Error handling broadcast:', error);
      this.hooks.call('onError', { type: 'broadcast_error', error, message });
    }
  }

  /**
   * Send input response to server
   */
  sendInputResponse(requestId, value, sendFn) {
    const response = {
      event: 'input_response',
      requestId: requestId,
      value: value
    };

    sendFn(JSON.stringify(response));
    this.logger.log('Sent input response', response);
  }
}

