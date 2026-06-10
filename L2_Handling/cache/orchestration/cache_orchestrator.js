/**
 *
 * TrailStore — the client's visited-trail of rendered pages (offline-browse engine)
 *
 *
 * SSOT: the server (zLoader) is the single cache of record. The browser is a
 * renderer, not a second zLoader. This store holds ONE thing: the rendered
 * output of pages the user has actually visited, keyed by route path, persisted
 * in IndexedDB (via StorageManager). It is the replacement for the bfcache the
 * browser gives a normal MPA for free but cannot give a WebSocket-driven SPA:
 * it lets Back/forward — and navigation while the socket is down — replay a
 * page the user already saw, with no server round-trip.
 *
 * A replayed page is STALE RENDER OUTPUT, never authority:
 *   - every entry is stamped with the session_hash and dropped when it changes
 *   - a TTL caps how stale a replay can be
 *   - the trail is LRU-capped so it can't grow unbounded
 *
 * Static assets (CSS/JS/images/fonts) are NOT stored here — the browser's
 * native HTTP cache (SHA-pinned, immutable) already owns those.
 *
 * Back-compat: exported as both `TrailStore` and `CacheOrchestrator` (the
 * loader and `client.cache` still reference the latter name).
 *
 * @version 2.0.0
 *
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const TrailStore = factory();
    root.TrailStore = TrailStore;
    root.CacheOrchestrator = TrailStore; // back-compat alias
  }
}(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // SSOT lives in ../cache_constants.js; duplicated here for UMD compatibility.
  const TIER = 'rendered';
  const TRAIL_TTL = 86400000; // 24h
  const TRAIL_LIMIT = 50;

  class TrailStore {
    /**
     * @param {StorageManager} storage - persistent backing store (IndexedDB)
     * @param {SessionManager} session - identity (for session_hash gating)
     * @param {Object} logger - optional logger
     */
    constructor(storage, session, logger = null) {
      if (!storage) {
        throw new Error('[TrailStore] StorageManager required');
      }
      if (!session) {
        throw new Error('[TrailStore] SessionManager required');
      }
      this.storage = storage;
      this.session = session;
      this.logger = logger || console;
      this.initialized = false;
      this.logger.debug('[TrailStore] Created');
    }

    async init() {
      if (this.initialized) {
        return true;
      }
      // StorageManager owns IndexedDB init; it may already be initialized by the
      // CacheManager. Calling init() again is a no-op there.
      try {
        if (typeof this.storage.init === 'function') {
          await this.storage.init();
        }
        // Drop trail on identity change (pages are session-scoped).
        if (this.session && typeof this.session.addListener === 'function') {
          this.session.addListener((event) => {
            if (event === 'session_changed' || event === 'session_cleared') {
              this.logger.debug(`[TrailStore] ${event} → clearing trail`);
              this.clear();
            }
          });
        }
        this.initialized = true;
        this.logger.debug('[TrailStore] Initialized (rendered trail only)');
        return true;
      } catch (error) {
        this.logger.debug('[TrailStore] Init failed:', error);
        this.initialized = false;
        return false;
      }
    }

    /**
     * Read a trail entry. Returns the stored value, or null if missing / expired
     * / from a different session.
     * @param {string} key - route path
     */
    async get(key) {
      if (!this.initialized) {
        return null;
      }
      const entry = await this.storage.get(key, TIER);
      if (!entry) {
        return null;
      }
      if (this._isExpired(entry)) {
        await this.storage.remove(key, TIER);
        this.logger.debug(`[TrailStore] Expired: ${key}`);
        return null;
      }
      if (!this._isValidSession(entry)) {
        await this.storage.remove(key, TIER);
        this.logger.debug(`[TrailStore] Session mismatch: ${key}`);
        return null;
      }
      return entry.value;
    }

    /**
     * Write a rendered page into the trail (LRU-capped, session-stamped).
     * @param {string} key - route path
     * @param {any} value - rendered payload (HTML string / structured snapshot)
     */
    async set(key, value) {
      if (!this.initialized) {
        return false;
      }
      const entry = {
        value: value,
        timestamp: Date.now(),
        session_hash: this.session && typeof this.session.getHash === 'function'
          ? this.session.getHash()
          : null
      };
      const ok = await this.storage.set(key, entry, TIER);
      if (ok) {
        await this._enforceLimit();
        this.logger.debug(`[TrailStore] Stored: ${key}`);
      }
      return ok;
    }

    /** @param {string} key - route path */
    async has(key) {
      return (await this.get(key)) !== null;
    }

    /** @param {string} key - route path */
    async remove(key) {
      if (!this.initialized) {
        return false;
      }
      return await this.storage.remove(key, TIER);
    }

    /**
     * Clear the trail. Accepts an optional tier arg for back-compat with callers
     * that pass 'rendered'; there is only one tier now, so it always clears it.
     */
    async clear() {
      if (!this.initialized) {
        return false;
      }
      await this.storage.clear(TIER);
      this.logger.debug('[TrailStore] Cleared trail');
      return true;
    }

    /** Back-compat alias — only one tier exists. */
    async clearAll() {
      return this.clear();
    }

    /** Back-compat alias — trail is already session-scoped. */
    async clearOnSessionChange() {
      return this.clear();
    }

    /**
     * List trail keys (route paths currently cached). Useful for diagnostics and
     * for the navigator deciding whether a Back target can be replayed offline.
     */
    async keys() {
      if (!this.initialized) {
        return [];
      }
      return await this.storage.keys(TIER);
    }

    async getStats() {
      if (!this.initialized) {
        return {};
      }
      const keys = await this.keys();
      return { rendered: { size: keys.length, limit: TRAIL_LIMIT } };
    }

    /**
     * Back-compat shim. The old multi-tier API exposed getTier(); the trail is
     * the only tier now, so callers get this store back.
     */
    getTier() {
      return this.initialized ? this : null;
    }

    // ── private ──────────────────────────────────────────────────────────────

    _isExpired(entry) {
      if (!entry || typeof entry.timestamp !== 'number') {
        return true;
      }
      return (Date.now() - entry.timestamp) > TRAIL_TTL;
    }

    _isValidSession(entry) {
      const current = this.session && typeof this.session.getHash === 'function'
        ? this.session.getHash()
        : null;
      // No current session yet → accept (anonymous browsing).
      if (!current) {
        return true;
      }
      // Entry predates the session system → reject.
      if (!entry.session_hash) {
        return false;
      }
      return entry.session_hash === current;
    }

    /**
     * Enforce the LRU cap: if the trail exceeds TRAIL_LIMIT, evict the oldest
     * entries by write timestamp. Relies on StorageManager.getAll() exposing the
     * per-entry timestamp.
     */
    async _enforceLimit() {
      try {
        if (typeof this.storage.getAll !== 'function') {
          return;
        }
        const all = await this.storage.getAll(TIER);
        if (!Array.isArray(all) || all.length <= TRAIL_LIMIT) {
          return;
        }
        all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const evictCount = all.length - TRAIL_LIMIT;
        for (let i = 0; i < evictCount; i++) {
          await this.storage.remove(all[i].key, TIER);
        }
        this.logger.debug(`[TrailStore] LRU evicted ${evictCount} entr${evictCount === 1 ? 'y' : 'ies'}`);
      } catch (err) {
        this.logger.debug('[TrailStore] LRU enforce skipped:', err && err.message);
      }
    }
  }

  return TrailStore;
}));
