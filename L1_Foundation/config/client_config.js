/**
 * L1_Foundation/config/client_config.js
 * 
 * Client configuration management, option validation, default values.
 * Extracted from bifrost_client.js constructor logic.
 */

// Default values (mirror bifrost_constants.js TIMEOUTS)
const RECONNECT_DELAY_DEFAULT = 3000;  // TIMEOUTS.RECONNECT_DELAY
const REQUEST_TIMEOUT_DEFAULT = 30000; // TIMEOUTS.REQUEST_TIMEOUT

/**
 * ClientConfig - Manages BifrostClient configuration
 */
export class ClientConfig {
  /**
   * Parse and validate client options
   * @param {Object} options - Raw options from constructor
   * @returns {Object} Validated and normalized options
   */
  static parseOptions(options = {}) {
    return {
      autoConnect: options.autoConnect === true,
      zTheme: options.zTheme !== false, // Default true
      zThemeCDN: options.zThemeCDN || 'https://cdn.jsdelivr.net/gh/ZoloAi/zTheme@main/dist',
      targetElement: options.targetElement || 'zVaF',
      autoRequest: options.autoRequest || null,
      autoReconnect: options.autoReconnect !== false, // Default true
      reconnectDelay: typeof options.reconnectDelay === 'number' ? options.reconnectDelay : RECONNECT_DELAY_DEFAULT,
      timeout: typeof options.timeout === 'number' ? options.timeout : REQUEST_TIMEOUT_DEFAULT,
      debug: options.debug === true,
      token: options.token || null,
      hooks: options.hooks || {},
      
      // Walker-specific options
      zVaFile: options.zVaFile || null,
      zVaFolder: options.zVaFolder || null,
      zBlock: options.zBlock || null,
    };
  }

  /**
   * Read zUI config from page (server-injected)
   * @returns {Object} Parsed zUI config or empty object
   */
  static readZUIConfig() {
    if (typeof document === 'undefined') {
      return {};
    }

    const zuiConfigEl = document.getElementById('zui-config');
    if (!zuiConfigEl) {
      return {};
    }

    try {
      return JSON.parse(zuiConfigEl.textContent);
    } catch (e) {
      console.error('[ClientConfig] Failed to parse zui-config:', e);
      return {};
    }
  }

  /**
   * Auto-construct WebSocket URL from backend config
   * @param {Object} zuiConfig - Parsed zUI config
   * @returns {Object} { url, ssl_enabled }
   */
  static autoConstructURL(zuiConfig) {
    const wsConfig = zuiConfig.websocket || {};
    const protocol = wsConfig.ssl_enabled ? 'wss:' : 'ws:';
    const wsHost = wsConfig.host || '127.0.0.1';
    const wsPort = wsConfig.port || 8765;
    const url = `${protocol}//${wsHost}:${wsPort}`;
    
    return {
      url,
      ssl_enabled: wsConfig.ssl_enabled || false
    };
  }

  /**
   * Validate WebSocket URL
   * @param {string} url - URL to validate
   * @throws {Error} If URL is invalid
   */
  static validateURL(url) {
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error('BifrostClient: URL must be a non-empty string');
    }
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      throw new Error('BifrostClient: URL must start with ws:// or wss://');
    }
  }

  /**
   * Merge walker options from zUI config
   * @param {Object} options - Current options
   * @param {Object} zuiConfig - zUI config from page
   * @returns {Object} Merged options
   */
  static mergeWalkerOptions(options, zuiConfig) {
    return {
      ...options,
      zVaFile: options.zVaFile || zuiConfig.zVaFile || null,
      zVaFolder: options.zVaFolder || zuiConfig.zVaFolder || null,
      zBlock: options.zBlock || zuiConfig.zBlock || null,
    };
  }
}
