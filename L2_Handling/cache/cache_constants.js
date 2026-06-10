/**
 * Cache Constants - SSOT for client-side caching configuration
 *
 * The client is NOT a second zLoader. The server (zLoader) is the single cache
 * of record for everything parsed/rendered. The browser holds exactly two
 * things: IDENTITY (SessionManager) and the user's own VISITED TRAIL of
 * rendered pages (the TrailStore, backed by IndexedDB) — the offline-browse
 * engine that lets Back/forward work when the socket is down.
 *
 * Static assets (CSS / JS plugins / images / fonts) are cached by the BROWSER's
 * native HTTP cache (SHA-pinned, immutable) — we do not reimplement that here.
 *
 * @module cache_constants
 * @layer 0 (Constants - imported by all cache layers)
 */

// ─────────────────────────────────────────────────────────────────
// Trail tier — the ONLY client cache tier (rendered pages)
// ─────────────────────────────────────────────────────────────────

export const TIER_RENDERED = 'rendered';

export const VALID_TIERS = [TIER_RENDERED];

// ─────────────────────────────────────────────────────────────────
// TTL (Time-To-Live) in milliseconds
// The trail is bounded primarily by session_hash + LRU; TTL is a secondary
// safety so a long-abandoned tab can't replay very stale paints.
// ─────────────────────────────────────────────────────────────────

export const TRAIL_TTL = 86400000; // 24 hours

export const TTL = {
  rendered: TRAIL_TTL
};

// ─────────────────────────────────────────────────────────────────
// LRU (Least Recently Used) limit — cap the trail size
// ─────────────────────────────────────────────────────────────────

export const TRAIL_LIMIT = 50;

export const LRU_LIMITS = {
  rendered: TRAIL_LIMIT
};

// ─────────────────────────────────────────────────────────────────
// Storage Configuration
// DB_VERSION bumped to 2: legacy stores (system/pinned/plugin) are dropped —
// only the rendered trail persists now.
// ─────────────────────────────────────────────────────────────────

export const DB_VERSION = 2;
export const STORE_NAMES = ['rendered'];
export const LEGACY_STORE_NAMES = ['system', 'pinned', 'plugin'];

// ─────────────────────────────────────────────────────────────────
// Session Configuration
// ─────────────────────────────────────────────────────────────────

export const SESSION_KEY = 'public_session';
export const DEFAULT_SESSION = {
  authenticated: false,
  username: null,
  role: null,
  session_hash: null,
  app: null,
  timestamp: null
};
