/**
 * L4_Orchestration - Top-Level Coordination Layer
 * 
 * Facade, lifecycle management, module loading.
 * Depends on: L1_Foundation, L2_Handling, L3_Abstraction
 * Provides: BifrostClient public API
 */

// Export subdirectories (will be populated in Step 5)
export * from './client/index.js';
export * from './lifecycle/lifecycle.js';
