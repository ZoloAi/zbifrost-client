/**
 * Orchestration Module - Barrel Export
 *
 * Trail coordination (TrailStore / CacheOrchestrator alias) + lifecycle wiring
 * (CacheManager). The HTTP conditional-request manager was removed in the SSOT
 * collapse — static assets are cached by the browser, pages by the server.
 *
 * @module caching/orchestration
 */

export { CacheOrchestrator } from './cache_orchestrator.js';
export { CacheManager } from './cache_manager.js';
