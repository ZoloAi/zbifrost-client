/**
 * Cache Constants - SSOT for all caching configuration
 * 
 * Extracted from cache_orchestrator.js (Phase 0)
 * 
 * @module cache_constants
 * @layer 0 (Constants - imported by all cache layers)
 */

// ─────────────────────────────────────────────────────────────────
// Cache Tier Names
// ─────────────────────────────────────────────────────────────────

export const TIER_SYSTEM = 'system';
export const TIER_PINNED = 'pinned';
export const TIER_PLUGIN = 'plugin';
export const TIER_SESSION = 'session';
export const TIER_RENDERED = 'rendered';

export const VALID_TIERS = [
  TIER_SYSTEM,
  TIER_PINNED,
  TIER_PLUGIN,
  TIER_SESSION,
  TIER_RENDERED
];

// ─────────────────────────────────────────────────────────────────
// TTL (Time-To-Live) in milliseconds
// ─────────────────────────────────────────────────────────────────

export const TTL = {
  system: 3600000,    // 1 hour
  pinned: Infinity,   // Never expires (user-controlled)
  plugin: 3600000,    // 1 hour
  session: 0,         // In-memory only (no persistence)
  rendered: 1800000   // 30 minutes
};

// ─────────────────────────────────────────────────────────────────
// LRU (Least Recently Used) Limits
// ─────────────────────────────────────────────────────────────────

export const LRU_LIMITS = {
  system: 100,   // Match zLoader backend
  pinned: null,  // No limit (user-controlled)
  plugin: 50,    // Smaller (JS modules are large)
  session: null, // No limit (in-memory only)
  rendered: 20   // Smallest (HTML is very large)
};

// ─────────────────────────────────────────────────────────────────
// Storage Configuration
// ─────────────────────────────────────────────────────────────────

export const DB_VERSION = 1;
export const STORE_NAMES = ['system', 'pinned', 'plugin', 'rendered']; // session is in-memory only

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
