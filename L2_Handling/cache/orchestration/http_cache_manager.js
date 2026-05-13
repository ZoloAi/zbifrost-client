/**
 * HTTPCacheManager - Client-side HTTP caching with conditional requests
 *
 * Responsibilities:
 * - Wrap fetch() calls with conditional request logic
 * - Add If-None-Match / If-Modified-Since headers
 * - Handle 304 Not Modified responses
 * - Update cache metadata on 200 responses
 * - Integrate with CacheOrchestrator
 *
 * Usage:
 *   const httpCache = new HTTPCacheManager(client);
 *   const { data, fromCache } = await httpCache.fetchWithCache(
 *     '/api/zui/config',
 *     {},
 *     'zui_config',
 *     'system'
 *   );
 *
 * Extracted from bifrost_client.js (Phase 3 - HTTP Caching)
 */

export class HTTPCacheManager {
  constructor(client) {
    this.client = client;
    this.logger = client.logger;
    this.cache = client.cache;
  }

  /**
   * Fetch with HTTP caching support (ETag validation)
   *
   * This method wraps fetch() to add conditional request headers (If-None-Match)
   * and handle 304 Not Modified responses by returning cached data.
   *
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options (headers, method, etc.)
   * @param {string} cacheKey - Cache key for storing response
   * @param {string} cacheTier - Cache tier (system, pinned, etc.)
   * @returns {Promise<Object>} { data, fromCache, status }
   *
   * @example
   * // First request (cold cache)
   * const { data, fromCache } = await fetchWithCache('/api/zui/config', {}, 'zui_config', 'system');
   * // fromCache: false, data: {...}, status: 200
   *
   * // Second request (warm cache, file unchanged)
   * const { data, fromCache } = await fetchWithCache('/api/zui/config', {}, 'zui_config', 'system');
   * // fromCache: true, data: {...}, status: 304
   */
  async fetchWithCache(url, options = {}, cacheKey = null, cacheTier = 'system') {
    try {
      // If no cache key provided, use URL as key
      if (!cacheKey) {
        cacheKey = url;
      }

      // Check if we have cached data and metadata
      const cached = await this.cache.get(cacheKey, cacheTier);
      
      // Get the cache tier instance
      const cacheInstance = this.cache.getTier(cacheTier);
      const metadata = cacheInstance ? await cacheInstance.getMetadata(cacheKey) : null;

      // Add conditional headers if we have cached metadata
      if (metadata && metadata.etag) {
        options.headers = options.headers || {};
        options.headers['If-None-Match'] = metadata.etag;
        
        if (metadata.last_modified) {
          options.headers['If-Modified-Since'] = metadata.last_modified;
        }

        this.logger.log(`[HTTPCache] Conditional request: ${url} (ETag: ${metadata.etag})`);
      }

      // Fetch from server
      const response = await fetch(url, options);

      // Handle 304 Not Modified
      if (response.status === 304) {
        this.logger.log(`[HTTPCache] 304 Not Modified: ${url} (using cache)`);
        
        if (!cached) {
          // This shouldn't happen (304 means we sent If-None-Match, which means we had cache)
          // But handle gracefully by fetching without conditional headers
          this.logger.warn(`[HTTPCache] 304 but no cached data for ${url}, refetching`);
          delete options.headers['If-None-Match'];
          delete options.headers['If-Modified-Since'];
          return await this.fetchWithCache(url, options, cacheKey, cacheTier);
        }

        return {
          data: cached,
          fromCache: true,
          status: 304
        };
      }

      // Handle 200 OK (or other success codes)
      if (response.ok) {
        // Parse response based on content type
        const contentType = response.headers.get('Content-Type') || '';
        let data;

        if (contentType.includes('application/json')) {
          data = await response.json();
        } else if (contentType.includes('text/')) {
          data = await response.text();
        } else {
          // Binary data
          data = await response.blob();
        }

        // Extract cache headers
        const etag = response.headers.get('ETag');
        const lastModified = response.headers.get('Last-Modified');
        const cacheControl = response.headers.get('Cache-Control');

        // Store data in cache
        await this.cache.set(cacheKey, data, cacheTier);

        // Store metadata if we have ETag
        if (etag && cacheInstance) {
          await cacheInstance.setMetadata(
            cacheKey,
            etag,
            lastModified,
            cacheControl
          );
          this.logger.log(`[HTTPCache] Cached: ${url} (ETag: ${etag})`);
        } else {
          this.logger.log(`[HTTPCache] Cached: ${url} (no ETag)`);
        }

        return {
          data: data,
          fromCache: false,
          status: response.status
        };
      }

      // Handle error responses
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    } catch (error) {
      this.logger.error(`[HTTPCache] Fetch error: ${url}`, error);
      
      // Try to get cached data as fallback
      const cachedFallback = await this.cache.get(cacheKey, cacheTier);
      if (cachedFallback) {
        this.logger.log(`[HTTPCache] Using stale cache due to error: ${url}`);
        return {
          data: cachedFallback,
          fromCache: true,
          status: 0,  // Indicates offline/error
          error: error.message
        };
      }

      // No cache, re-throw error
      throw error;
    }
  }

  /**
   * Invalidate cache for a specific URL/key
   *
   * Removes both data and metadata from cache.
   *
   * @param {string} cacheKey - Cache key to invalidate
   * @param {string} cacheTier - Cache tier
   * @returns {Promise<void>}
   */
  async invalidate(cacheKey, cacheTier = 'system') {
    await this.cache.caches[cacheTier].remove(cacheKey);
    this.logger.log(`[HTTPCache] Invalidated: ${cacheKey}`);
  }

  /**
   * Clear all HTTP cache metadata
   *
   * Useful for debugging or forcing fresh fetches.
   *
   * @param {string} cacheTier - Cache tier to clear
   * @returns {Promise<void>}
   */
  async clearAll(cacheTier = 'system') {
    await this.cache.caches[cacheTier].clear();
    this.logger.log(`[HTTPCache] Cleared all cache: ${cacheTier}`);
  }

  /**
   * Get cache statistics
   *
   * Returns info about cache hits, misses, and stored entries.
   *
   * @param {string} cacheTier - Cache tier
   * @returns {Promise<Object>} Stats object
   */
  async getStats(cacheTier = 'system') {
    return await this.cache.caches[cacheTier].getStats();
  }
}
