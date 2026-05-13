/**
 * L3_Abstraction - High-Level Abstractions Layer
 * 
 * Coordinates L2 handlers, provides unified interfaces.
 * Depends on: L1_Foundation, L2_Handling
 * Provides: Orchestration, Rendering, Session management
 */

// Export subdirectories (will be populated in Step 4)
export * from './orchestrator/orchestrator.js';
export * from './renderer/renderer.js';
export * from './session/session.js';
