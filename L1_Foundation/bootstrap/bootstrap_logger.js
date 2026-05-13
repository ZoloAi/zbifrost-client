/**
 * Bootstrap Logger - Lightweight inline logger for UMD bootstrap
 * 
 * Zero-dependency logger used before ES modules load.
 * Intentional duplication of core/logger.js for UMD compatibility.
 * 
 * @module bootstrap/bootstrap_logger
 * @layer -1 (Bootstrap - loaded before all other layers)
 * 
 * Pattern: UMD module that creates browser global
 * 
 * Usage:
 * ```javascript
 * const logger = createBootstrapLogger('Bifrost', 'INFO');
 * logger.log('Message');
 * logger.error('Error');
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
    root.createBootstrapLogger = factory();
  }
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  /**
   * Create a lightweight logger instance
   * 
   * @param {string} context - Logger context name (e.g., 'Bifrost')
   * @param {string} logLevel - Log level (DEBUG, INFO, WARN, ERROR)
   * @returns {Object} Logger instance
   */
  function createBootstrapLogger(context = 'Bifrost', logLevel = 'INFO') {
    const logger = {
      levels: { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 },
      level: logLevel === 'DEBUG' ? 0 : logLevel === 'INFO' ? 1 : logLevel === 'WARN' ? 2 : 3,
      context: context,
      
      _interpolate: (message, args) => {
        if (args.length === 0) return message;
        
        // Support Python-style %s interpolation
        if (message.includes('%s')) {
          let result = message;
          args.forEach(arg => {
            result = result.replace('%s', String(arg));
          });
          return result;
        }
        
        return message;
      },
      
      _formatMessage: (level, message, args = []) => {
        const interpolated = logger._interpolate(message, args);
        
        // ANSI color codes for browser console
        const colors = {
          debug: '\x1b[90m',     // Gray for DEBUG
          info: '\x1b[34m',      // Blue for INFO
          warn: '\x1b[33m',      // Yellow for WARN
          error: '\x1b[91m',     // Bright red for ERROR
          message: '\x1b[38;2;255;251;203m',  // Cream #fffbcb for message text
          bold: '\x1b[1m',       // Bold
          reset: '\x1b[0m'
        };
        
        const levelColor = colors[level.toLowerCase()] || colors.info;
        
        return `${colors.bold}${levelColor}[${level}]${colors.reset}: ${colors.message}${interpolated}${colors.reset}`;
      },
      
      debug: (message, ...args) => {
        if (logger.level <= logger.levels.DEBUG) {
          const formatted = logger._formatMessage('DEBUG', message, args);
          console.debug(formatted, ...args.filter(arg => typeof arg === 'object'));
        }
      },
      
      info: (message, ...args) => {
        if (logger.level <= logger.levels.INFO) {
          const formatted = logger._formatMessage('INFO', message, args);
          console.info(formatted, ...args.filter(arg => typeof arg === 'object'));
        }
      },
      
      log: (message, ...args) => {
        if (logger.level <= logger.levels.INFO) {
          const formatted = logger._formatMessage('INFO', message, args);
          console.log(formatted, ...args.filter(arg => typeof arg === 'object'));
        }
      },
      
      error: (message, ...args) => {
        const formatted = logger._formatMessage('ERROR', message, args);
        console.error(formatted, ...args.filter(arg => typeof arg === 'object'));
      },
      
      warn: (message, ...args) => {
        if (logger.level <= logger.levels.WARN) {
          const formatted = logger._formatMessage('WARN', message, args);
          console.warn(formatted, ...args.filter(arg => typeof arg === 'object'));
        }
      },
      
      setLevel: (level) => {
        const levelMap = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        logger.level = levelMap[level] || levelMap.INFO;
      },
      
      enable: () => {
        logger.level = logger.levels.DEBUG;
      },
      
      disable: () => {
        logger.level = logger.levels.ERROR;
      },
      
      isEnabled: () => {
        return logger.level <= logger.levels.INFO;
      }
    };
    
    return logger;
  }

  return createBootstrapLogger;
}));
