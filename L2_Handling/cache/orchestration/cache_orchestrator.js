/**
 * 
 * zCLI - CacheOrchestrator (Tier 3 - Mirrors zLoader Backend)
 * 
 *
 * Coordinates 5 cache tiers for progressive enhancement and offline-first UX.
 * Mirrors zLoader's backend cache architecture for consistency and predictability.
 *
 * 5-Tier Cache System:
 *   1. System Cache   - UI files, configs, YAML (LRU: 100 items)
 *   2. Pinned Cache   - User bookmarks (no eviction)
 *   3. Plugin Cache   - JS modules (LRU: 50 items)
 *   4. Session Cache  - In-memory user state (no persistence)
 *   5. Rendered Cache - DOM for offline mode (TTL: 30 min, LRU: 20 items)
 *
 * Usage:
 *   const cache = new CacheOrchestrator(storage, session);
 *   await cache.init();
 *
 *   // Store UI file
 *   await cache.set('zUI.zLogin.yaml', yamlData, 'system');
 *
 *   // Get with cache validation
 *   const data = await cache.get('zUI.zLogin.yaml', 'system');
 *
 *   // Clear stale caches on session change
 *   cache.clearOnSessionChange();
 *
 * Architecture:
 *   - Delegates to individual cache modules (separation of concerns)
 *   - Validates session_hash for stale cache detection
 *   - TTL enforcement for time-sensitive data
 *   - LRU eviction for memory management
 *
 * @version 1.6.0
 * @since 2025-12-16
 * 
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CacheOrchestrator = factory();
  }
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // 
  // Constants
  // 

  const TIER_SYSTEM = 'system';
  const TIER_PINNED = 'pinned';
  const TIER_PLUGIN = 'plugin';
  const TIER_SESSION = 'session';
  const TIER_RENDERED = 'rendered';

  const VALID_TIERS = [TIER_SYSTEM, TIER_PINNED, TIER_PLUGIN, TIER_SESSION, TIER_RENDERED];

  // TTL (Time-To-Live) in milliseconds
  const TTL = {
    system: 3600000,    // 1 hour
    pinned: Infinity,   // Never expires (user-controlled)
    plugin: 3600000,    // 1 hour
    session: 0,         // In-memory only (no persistence)
    rendered: 1800000   // 30 minutes
  };

  // LRU Limits
  const LRU_LIMITS = {
    system: 100,   // Match zLoader backend
    pinned: null,  // No limit (user-controlled)
    plugin: 50,    // Smaller (JS modules are large)
    session: null, // No limit (in-memory only)
    rendered: 20   // Smallest (HTML is very large)
  };

  // 
  // CacheOrchestrator Class
  // 

  class CacheOrchestrator {
    /**
         * Create cache orchestrator instance
         *
         * @param {StorageManager} storage - StorageManager instance
         * @param {SessionManager} session - SessionManager instance
         * @param {Object} logger - Optional logger instance
         */
    constructor(storage, session, logger = null) {
      if (!storage) {
        throw new Error('[CacheOrchestrator] StorageManager required');
      }
      if (!session) {
        throw new Error('[CacheOrchestrator] SessionManager required');
      }

      this.storage = storage;
      this.session = session;
      this.caches = {};
      this.initialized = false;
      this.logger = logger || console;

      this.logger.debug('[CacheOrchestrator] Created');
    }

    /**
         * Initialize cache orchestrator
         *
         * Loads cache modules and sets up session change listeners.
         *
         * @returns {Promise<boolean>} Success status
         */
    async init() {
      if (this.initialized) {
        this.logger.debug('[CacheOrchestrator] Already initialized');
        return true;
      }

      try {
        // Load cache modules (will be created in next steps)
        // For now, we'll use placeholder implementations
        this.caches = {
          system: await this._createSystemCache(),
          pinned: await this._createPinnedCache(),
          plugin: await this._createPluginCache(),
          session: await this._createSessionCache(),
          rendered: await this._createRenderedCache()
        };

        // Listen for session changes to invalidate caches
        this.session.addListener((event, _data) => {
          if (event === 'session_changed') {
            this.logger.debug('[CacheOrchestrator] Session changed, invalidating caches');
            this.clearOnSessionChange();
          } else if (event === 'session_cleared') {
            this.logger.debug('[CacheOrchestrator] Session cleared, clearing all caches');
            this.clearAll();
          }
        });

        this.initialized = true;
        this.logger.debug('[CacheOrchestrator] Initialized (5 tiers: system, pinned, plugin, session, rendered)');
        return true;
      } catch (error) {
        this.logger.debug('[CacheOrchestrator] Initialization failed:', error);
        this.initialized = false;
        return false;
      }
    }

    /**
         * Get value from cache with validation
         *
         * @param {string} key - Cache key
         * @param {string} tier - Cache tier
         * @returns {Promise<any|null>} Cached value or null
         */
    async get(key, tier = TIER_SYSTEM) {
      if (!this.initialized) {
        this.logger.debug('[CacheOrchestrator] Not initialized');
        return null;
      }

      if (!VALID_TIERS.includes(tier)) {
        this.logger.info(`[CacheOrchestrator] Invalid tier: ${tier}`);
        return null;
      }

      const cache = this.caches[tier];
      if (!cache) {
        this.logger.info(`[CacheOrchestrator] Cache not found for tier: ${tier}`);
        return null;
      }

      // Get entry from cache
      const entry = await cache.get(key);
      if (!entry) {
        return null;
      }

      // Validate TTL
      if (this._isExpired(entry, tier)) {
        this.logger.info(`[CacheOrchestrator] Cache expired for ${tier}/${key}`);
        await cache.remove(key);
        return null;
      }

      // Validate session_hash (for all tiers except session)
      if (tier !== TIER_SESSION && !this._isValidSession(entry)) {
        this.logger.info(`[CacheOrchestrator] Session hash mismatch for ${tier}/${key}`);
        await cache.remove(key);
        return null;
      }

      this.logger.info(`[CacheOrchestrator] Cache hit: ${tier}/${key}`);
      return entry.value;
    }

    /**
         * Set value in cache
         *
         * @param {string} key - Cache key
         * @param {any} value - Value to cache
         * @param {string} tier - Cache tier
         * @returns {Promise<boolean>} Success status
         */
    async set(key, value, tier = TIER_SYSTEM) {
      if (!this.initialized) {
        this.logger.debug('[CacheOrchestrator] Not initialized');
        return false;
      }

      if (!VALID_TIERS.includes(tier)) {
        this.logger.info(`[CacheOrchestrator] Invalid tier: ${tier}`);
        return false;
      }

      const cache = this.caches[tier];
      if (!cache) {
        this.logger.info(`[CacheOrchestrator] Cache not found for tier: ${tier}`);
        return false;
      }

      // Create cache entry with metadata
      const entry = {
        key: key,
        value: value,
        timestamp: Date.now(),
        ttl: TTL[tier],
        session_hash: tier !== TIER_SESSION ? this.session.getHash() : null
      };

      // Store in cache
      const success = await cache.set(key, entry);
      if (success) {
        this.logger.info(`[CacheOrchestrator] Cached: ${tier}/${key}`);
      }

      return success;
    }

    /**
         * Remove value from cache
         *
         * @param {string} key - Cache key
         * @param {string} tier - Cache tier
         * @returns {Promise<boolean>} Success status
         */
    async remove(key, tier = TIER_SYSTEM) {
      if (!this.initialized) {
        this.logger.debug('[CacheOrchestrator] Not initialized');
        return false;
      }

      const cache = this.caches[tier];
      if (!cache) {
        this.logger.info(`[CacheOrchestrator] Cache not found for tier: ${tier}`);
        return false;
      }

      return await cache.remove(key);
    }

    /**
         * Clear entire tier
         *
         * @param {string} tier - Cache tier to clear
         * @returns {Promise<boolean>} Success status
         */
    async clear(tier) {
      if (!this.initialized) {
        this.logger.debug('[CacheOrchestrator] Not initialized');
        return false;
      }

      const cache = this.caches[tier];
      if (!cache) {
        this.logger.info(`[CacheOrchestrator] Cache not found for tier: ${tier}`);
        return false;
      }

      await cache.clear();
      this.logger.info(`[CacheOrchestrator] Cleared tier: ${tier}`);
      return true;
    }

    /**
         * Clear all caches
         *
         * @returns {Promise<void>}
         */
    async clearAll() {
      if (!this.initialized) {
        this.logger.debug('[CacheOrchestrator] Not initialized');
        return;
      }

      for (const tier of VALID_TIERS) {
        await this.clear(tier);
      }

      this.logger.debug('[CacheOrchestrator] Cleared all caches');
    }

    /**
         * Get cache tier instance
         *
         * @param {string} tier - Cache tier name
         * @returns {Object|null} Cache instance or null
         */
    getTier(tier) {
      if (!this.initialized) {
        this.logger.debug('[CacheOrchestrator] Not initialized');
        return null;
      }

      if (!VALID_TIERS.includes(tier)) {
        this.logger.info(`[CacheOrchestrator] Invalid tier: ${tier}`);
        return null;
      }

      return this.caches[tier] || null;
    }

    /**
         * Clear caches on session change (except pinned)
         *
         * Called automatically when session_hash changes.
         * Preserves pinned cache (user bookmarks).
         */
    async clearOnSessionChange() {
      if (!this.initialized) {
        return;
      }

      // Clear all except pinned
      const tiersToClean = [TIER_SYSTEM, TIER_PLUGIN, TIER_SESSION, TIER_RENDERED];

      for (const tier of tiersToClean) {
        await this.clear(tier);
      }

      this.logger.debug('[CacheOrchestrator] Cleared caches on session change (preserved pinned)');
    }

    /**
         * Get cache statistics
         *
         * @returns {Object} Stats for all tiers
         */
    async getStats() {
      if (!this.initialized) {
        return {};
      }

      const stats = {};

      for (const tier of VALID_TIERS) {
        const cache = this.caches[tier];
        if (cache && cache.getStats) {
          stats[tier] = await cache.getStats();
        }
      }

      return stats;
    }

    // 
    // Private Methods
    // 

    /**
         * Check if cache entry is expired
         *
         * @private
         * @param {Object} entry - Cache entry
         * @param {string} tier - Cache tier
         * @returns {boolean} True if expired
         */
    _isExpired(entry, tier) {
      const ttl = TTL[tier];

      // Pinned cache never expires
      if (ttl === Infinity) {
        return false;
      }

      // Session cache has no TTL (in-memory only)
      if (ttl === 0) {
        return false;
      }

      // Check age
      const age = Date.now() - entry.timestamp;
      return age > ttl;
    }

    /**
         * Validate session hash
         *
         * @private
         * @param {Object} entry - Cache entry
         * @returns {boolean} True if valid
         */
    _isValidSession(entry) {
      const currentHash = this.session.getHash();

      // If no current hash, session not initialized yet
      if (!currentHash) {
        return true;
      }

      // If entry has no hash, it's from before session system
      if (!entry.session_hash) {
        return false;
      }

      // Compare hashes
      return entry.session_hash === currentHash;
    }

    /**
         * Create system cache
         * @private
         */
    async _createSystemCache() {
      // In production, this would be: const SystemCache = await import('./caches/system_cache.js');
      // For now, return placeholder until modules are loaded via script tags
      // System cache ready (silent - logged in summary)
      return {
        data: new Map(),
        metadata: new Map(),
        async get(key) {
          return this.data.get(key);
        },
        async set(key, value) {
          this.data.set(key, value); return true;
        },
        async remove(key) {
          this.data.delete(key);
          this.metadata.delete(key);
          return true;
        },
        async clear() {
          this.data.clear();
          this.metadata.clear();
        },
        async getStats() {
          return { size: this.data.size, limit: LRU_LIMITS.system };
        },
        async getMetadata(key) {
          return this.metadata.get(key);
        },
        async setMetadata(key, etag, lastModified, cacheControl) {
          this.metadata.set(key, {
            etag: etag,
            last_modified: lastModified,
            cache_control: cacheControl,
            timestamp: Date.now()
          });
          return true;
        }
      };
    }

    /**
         * Create pinned cache
         * @private
         */
    async _createPinnedCache() {
      // Pinned cache ready (silent - logged in summary)
      return {
        data: new Map(),
        metadata: new Map(),
        async get(key) {
          return this.data.get(key);
        },
        async set(key, value) {
          this.data.set(key, value); return true;
        },
        async remove(key) {
          this.data.delete(key);
          this.metadata.delete(key);
          return true;
        },
        async clear() {
          this.data.clear();
          this.metadata.clear();
        },
        async getStats() {
          return { size: this.data.size, limit: null };
        },
        async getMetadata(key) {
          return this.metadata.get(key);
        },
        async setMetadata(key, etag, lastModified, cacheControl) {
          this.metadata.set(key, {
            etag: etag,
            last_modified: lastModified,
            cache_control: cacheControl,
            timestamp: Date.now()
          });
          return true;
        }
      };
    }

    /**
         * Create plugin cache
         * @private
         */
    async _createPluginCache() {
      // Plugin cache ready (silent - logged in summary)
      return {
        data: new Map(),
        metadata: new Map(),
        async get(key) {
          return this.data.get(key);
        },
        async set(key, value) {
          this.data.set(key, value); return true;
        },
        async remove(key) {
          this.data.delete(key);
          this.metadata.delete(key);
          return true;
        },
        async clear() {
          this.data.clear();
          this.metadata.clear();
        },
        async getStats() {
          return { size: this.data.size, limit: LRU_LIMITS.plugin };
        },
        async getMetadata(key) {
          return this.metadata.get(key);
        },
        async setMetadata(key, etag, lastModified, cacheControl) {
          this.metadata.set(key, {
            etag: etag,
            last_modified: lastModified,
            cache_control: cacheControl,
            timestamp: Date.now()
          });
          return true;
        }
      };
    }

    /**
         * Create session cache (in-memory only)
         * @private
         */
    async _createSessionCache() {
      // Session cache ready (silent - logged in summary)
      return {
        data: new Map(),
        metadata: new Map(),
        async get(key) {
          return this.data.get(key);
        },
        async set(key, value) {
          this.data.set(key, value); return true;
        },
        async remove(key) {
          this.data.delete(key);
          this.metadata.delete(key);
          return true;
        },
        async clear() {
          this.data.clear();
          this.metadata.clear();
        },
        async getStats() {
          return { size: this.data.size, limit: null };
        },
        async getMetadata(key) {
          return this.metadata.get(key);
        },
        async setMetadata(key, etag, lastModified, cacheControl) {
          this.metadata.set(key, {
            etag: etag,
            last_modified: lastModified,
            cache_control: cacheControl,
            timestamp: Date.now()
          });
          return true;
        }
      };
    }

    /**
         * Create rendered cache
         * @private
         */
    async _createRenderedCache() {
      // Rendered cache ready (silent - logged in summary)
      return {
        data: new Map(),
        metadata: new Map(),
        async get(key) {
          return this.data.get(key);
        },
        async set(key, value) {
          this.data.set(key, value); return true;
        },
        async remove(key) {
          this.data.delete(key);
          this.metadata.delete(key);
          return true;
        },
        async clear() {
          this.data.clear();
          this.metadata.clear();
        },
        async getStats() {
          return { size: this.data.size, limit: LRU_LIMITS.rendered };
        },
        async getMetadata(key) {
          return this.metadata.get(key);
        },
        async setMetadata(key, etag, lastModified, cacheControl) {
          this.metadata.set(key, {
            etag: etag,
            last_modified: lastModified,
            cache_control: cacheControl,
            timestamp: Date.now()
          });
          return true;
        }
      };
    }
  }

  // 
  // Export
  // 

  return CacheOrchestrator;
}));

