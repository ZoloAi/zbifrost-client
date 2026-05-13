/**
 * 
 * Base Cache Module - LRU + Storage Interface
 * 
 *
 * Base class for all cache modules providing:
 * - LRU (Least Recently Used) eviction
 * - Storage persistence (via StorageManager)
 * - Statistics tracking
 *
 * Subclasses:
 *   - SystemCache (LRU: 100 items)
 *   - PinnedCache (no eviction)
 *   - PluginCache (LRU: 50 items)
 *   - RenderedCache (LRU: 20 items)
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
    root.BaseCache = factory();
  }
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  class BaseCache {
    /**
         * Create base cache instance
         *
         * @param {StorageManager} storage - Storage manager instance
         * @param {string} tier - Cache tier name (system, pinned, etc.)
         * @param {number|null} limit - LRU limit (null = no limit)
         */
    constructor(storage, tier, limit = null) {
      this.storage = storage;
      this.tier = tier;
      this.limit = limit;

      // LRU tracking (in-memory)
      this.accessOrder = [];  // [key1, key2, ...] (most recent last)

      this.logger.log(`[${tier}Cache] Created (limit: ${limit || 'none'})`);
    }

    /**
         * Get value from cache
         *
         * @param {string} key - Cache key
         * @returns {Promise<any|null>} Cached value or null
         */
    async get(key) {
      const value = await this.storage.get(key, this.tier);

      if (value !== null) {
        // Update LRU (move to end = most recent)
        this._updateLRU(key);
      }

      return value;
    }

    /**
         * Set value in cache
         *
         * @param {string} key - Cache key
         * @param {any} value - Value to cache
         * @returns {Promise<boolean>} Success status
         */
    async set(key, value) {
      // Enforce LRU limit if set
      if (this.limit && this.accessOrder.length >= this.limit) {
        // Check if key already exists (update, not new)
        if (!this.accessOrder.includes(key)) {
          // Evict least recently used
          const evictKey = this.accessOrder[0];
          await this.remove(evictKey);
          this.logger.log(`[${this.tier}Cache] LRU evicted: ${evictKey}`);
        }
      }

      // Store value
      const success = await this.storage.set(key, value, this.tier);

      if (success) {
        this._updateLRU(key);
      }

      return success;
    }

    /**
         * Remove value from cache
         *
         * @param {string} key - Cache key
         * @returns {Promise<boolean>} Success status
         */
    async remove(key) {
      const success = await this.storage.remove(key, this.tier);

      if (success) {
        // Remove from LRU tracking
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
          this.accessOrder.splice(index, 1);
        }
        
        // Also remove metadata
        await this.removeMetadata(key);
      }

      return success;
    }

    /**
         * Clear entire cache
         *
         * @returns {Promise<void>}
         */
    async clear() {
      await this.storage.clear(this.tier);
      this.accessOrder = [];
    }

    /**
         * Get all keys in cache
         *
         * @returns {Promise<string[]>} Array of keys
         */
    async keys() {
      return await this.storage.keys(this.tier);
    }

    /**
         * Get cache statistics
         *
         * @returns {Promise<Object>} Stats object
         */
    async getStats() {
      const keys = await this.keys();

      return {
        size: keys.length,
        limit: this.limit,
        utilization: this.limit ? `${(keys.length / this.limit * 100).toFixed(1)  }%` : 'N/A',
        lru_order: this.accessOrder.slice(-5)  // Last 5 accessed
      };
    }

    /**
         * Set HTTP cache metadata for a key
         *
         * Stores ETag, Last-Modified, and Cache-Control headers for HTTP caching.
         * This metadata is stored alongside the cached data and used for conditional
         * requests (If-None-Match, If-Modified-Since).
         *
         * @param {string} key - Cache key
         * @param {string} etag - ETag header value
         * @param {string} lastModified - Last-Modified header value
         * @param {string} cacheControl - Cache-Control header value
         * @returns {Promise<boolean>} Success status
         *
         * @example
         * await cache.setMetadata('zui_config', 'W/"123"', 'Thu, 01 Jan 2024', 'no-cache');
         */
    async setMetadata(key, etag, lastModified, cacheControl) {
      const metadataKey = `${key}:metadata`;
      const metadata = {
        etag: etag,
        last_modified: lastModified,
        cache_control: cacheControl,
        stored_at: Date.now()
      };

      return await this.storage.set(metadataKey, metadata, this.tier);
    }

    /**
         * Get HTTP cache metadata for a key
         *
         * Retrieves ETag, Last-Modified, and Cache-Control headers stored for a key.
         * Returns null if no metadata exists.
         *
         * @param {string} key - Cache key
         * @returns {Promise<Object|null>} Metadata object or null
         *
         * @example
         * const metadata = await cache.getMetadata('zui_config');
         * if (metadata && metadata.etag) {
         *   headers['If-None-Match'] = metadata.etag;
         * }
         */
    async getMetadata(key) {
      const metadataKey = `${key}:metadata`;
      return await this.storage.get(metadataKey, this.tier);
    }

    /**
         * Remove HTTP cache metadata for a key
         *
         * Deletes stored metadata when cache entry is invalidated.
         *
         * @param {string} key - Cache key
         * @returns {Promise<boolean>} Success status
         */
    async removeMetadata(key) {
      const metadataKey = `${key}:metadata`;
      return await this.storage.remove(metadataKey, this.tier);
    }

    /**
         * Update LRU tracking (move key to end = most recent)
         *
         * @private
         * @param {string} key - Cache key
         */
    _updateLRU(key) {
      // Remove key if it exists
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }

      // Add to end (most recent)
      this.accessOrder.push(key);
    }
  }

  return BaseCache;
}));

