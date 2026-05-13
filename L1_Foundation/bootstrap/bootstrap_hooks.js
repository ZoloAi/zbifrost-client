/**
 * Bootstrap Hooks - Lightweight inline hook manager for UMD bootstrap
 * 
 * Zero-dependency hook system used before ES modules load.
 * Intentional duplication of core/hooks.js for UMD compatibility.
 * 
 * @module bootstrap/bootstrap_hooks
 * @layer -1 (Bootstrap - loaded before all other layers)
 * 
 * Pattern: UMD module that creates browser global
 * 
 * Usage:
 * ```javascript
 * const hooks = createBootstrapHooks({ onConnected: () => {} }, logger);
 * hooks.call('onConnected', data);
 * hooks.register('onMessage', (msg) => {});
 * ```
 * 
 * Extracted from bifrost_client.js (Phase 2)
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.createBootstrapHooks = factory();
  }
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  /**
   * Create a lightweight hook manager instance
   * 
   * @param {Object} initialHooks - Initial hooks object
   * @param {Object} logger - Logger instance for debugging
   * @returns {Object} Hook manager instance
   */
  function createBootstrapHooks(initialHooks = {}, logger = console) {
    const hookManager = {
      hooks: initialHooks,
      errorHandler: null,
      logger: logger,
      
      call: (hookName, ...args) => {
        const hook = hookManager.hooks[hookName];
        hookManager.logger.debug(`[Hooks] Calling hook: ${hookName}`);
        
        if (typeof hook === 'function') {
          try {
            return hook(...args);
          } catch (error) {
            // Log to console
            hookManager.logger.error(`Error in ${hookName} hook:`, error);

            // Display in UI if error handler is set
            if (hookManager.errorHandler) {
              try {
                hookManager.errorHandler({
                  type: 'hook_error',
                  hookName,
                  error,
                  message: error.message,
                  stack: error.stack
                });
              } catch (displayError) {
                hookManager.logger.error('Error handler itself failed:', displayError);
              }
            }

            // Call onError hook if it exists and isn't the one that failed
            if (hookName !== 'onError' && hookManager.hooks.onError) {
              try {
                hookManager.hooks.onError(error);
              } catch (onErrorError) {
                hookManager.logger.error('onError hook failed:', onErrorError);
              }
            }
          }
        }
      },
      
      has: (hookName) => {
        return typeof hookManager.hooks[hookName] === 'function';
      },
      
      register: (hookName, fn) => {
        if (typeof fn === 'function') {
          hookManager.hooks[hookName] = fn;
          hookManager.logger.debug(`[Hooks] Registered hook: ${hookName}`);
        } else {
          hookManager.logger.error(`[Hooks] [ERROR] Failed to register hook ${hookName}: not a function`);
        }
      },
      
      unregister: (hookName) => {
        delete hookManager.hooks[hookName];
      },
      
      list: () => Object.keys(hookManager.hooks),
      
      // Dark mode utilities (requires dynamic import)
      initBuiltInHooks: () => {
        // Initialize dark mode from localStorage
        const savedTheme = localStorage.getItem('zTheme-mode');
        if (savedTheme === 'dark') {
          hookManager._applyDarkMode(true);
        }
      },
      
      _applyDarkMode: async (isDark) => {
        // Note: This requires import, so it's kept in bifrost_client.js
        // This method is a placeholder that will be overridden
        hookManager.logger.warn('[Hooks] _applyDarkMode not yet initialized');
      }
    };
    
    return hookManager;
  }

  return createBootstrapHooks;
}));
