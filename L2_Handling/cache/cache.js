/**
 * Caching Module - Barrel Export
 *
 * Client caching surface after the SSOT collapse: the server (zLoader) is the
 * single cache of record. The client keeps only IDENTITY (SessionManager) and
 * the visited-page TRAIL (TrailStore / CacheOrchestrator alias), backed by
 * StorageManager (IndexedDB). The old per-tier "mirror of zLoader" and the HTTP
 * conditional-request manager are gone.
 *
 * @module caching
 */

// Constants
export * from './cache_constants.js';

// Storage Layer
export { StorageManager } from './storage/storage_manager.js';
export { SessionManager } from './storage/session_manager.js';

// Orchestration Layer
export { CacheOrchestrator } from './orchestration/cache_orchestrator.js';
export { CacheManager } from './orchestration/cache_manager.js';
