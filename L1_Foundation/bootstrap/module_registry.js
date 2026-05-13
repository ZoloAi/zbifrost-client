/**
 * Module Registry - SSOT for dynamic module loading paths
 * 
 * Centralized registry of all dynamically loaded modules and their paths.
 * Eliminates hardcoded string paths in _loadModule().
 * 
 * @module bootstrap/module_registry
 * @layer -1 (Bootstrap)
 * 
 * Pattern: ES module (not UMD - only used by bifrost_client.js)
 * 
 * Usage:
 * ```javascript
 * import { MODULE_REGISTRY, getModulePath } from './bootstrap/module_registry.js';
 * const path = getModulePath('connection');  // 'core/connection.js'
 * ```
 * 
 * Created in Phase 2
 */

// ─────────────────────────────────────────────────────────────────
// Module Registry - SSOT for all module paths
// ─────────────────────────────────────────────────────────────────

export const MODULE_REGISTRY = {
  // L1 Foundation modules
  connection: 'L1_Foundation/connection/connection.js',
  logger: 'L1_Foundation/logger/logger.js',
  
  // L2 Handling modules
  message_handler: 'L2_Handling/message/message_handler.js',
  navigation_manager: 'L2_Handling/navigation/navigation_manager.js',
  widget_hook_manager: 'L2_Handling/hooks/widget_hook_manager.js',
  zvaf_manager: 'L2_Handling/zvaf/zvaf_manager.js',
  error_display: 'zSys/errors/error_display.js', // Step 6: Moved to zSys
  
  // L2 Display: Orchestration
  renderer: 'L2_Handling/display/orchestration/renderer.js',
  zdisplay_orchestrator: 'L2_Handling/display/orchestration/zdisplay_orchestrator.js',
  // L2 Display: Navigation
  navigation_renderer: 'L2_Handling/display/navigation/navigation_renderer.js',
  menu_renderer: 'L2_Handling/display/navigation/menu_renderer.js',
  
  // L2 Display: Inputs
  form_renderer: 'L2_Handling/display/inputs/form_renderer.js',
  button_renderer: 'L2_Handling/display/inputs/button_renderer.js',
  input_renderer: 'L2_Handling/display/inputs/input_renderer.js',
  
  // L2 Display: Outputs
  text_renderer: 'L2_Handling/display/outputs/text_renderer.js',
  table_renderer: 'L2_Handling/display/outputs/table_renderer.js',
  card_renderer: 'L2_Handling/display/outputs/card_renderer.js',
  header_renderer: 'L2_Handling/display/outputs/header_renderer.js',
  typography_renderer: 'L2_Handling/display/outputs/typography_renderer.js',
  alert_renderer: 'L2_Handling/display/outputs/alert_renderer.js',
  list_renderer: 'L2_Handling/display/outputs/list_renderer.js',
  image_renderer: 'L2_Handling/display/outputs/image_renderer.js',
  icon_renderer: 'L2_Handling/display/outputs/icon_renderer.js',
  dl_renderer: 'L2_Handling/display/outputs/dl_renderer.js',
  
  // L2 Display: Composite
  dashboard_renderer: 'L2_Handling/display/composite/dashboard_renderer.js',
  terminal_renderer: 'L2_Handling/display/composite/terminal_renderer.js',
  swiper_renderer: 'L2_Handling/display/composite/swiper_renderer.js',
  wizard_conditional_renderer: 'L2_Handling/display/composite/wizard_conditional_renderer.js',
  
  // L2 Display: Feedback
  progressbar_renderer: 'L2_Handling/display/feedback/progressbar_renderer.js',
  spinner_renderer: 'L2_Handling/display/feedback/spinner_renderer.js',
  
  // L2 Display: Specialized
  input_request_renderer: 'L2_Handling/display/specialized/input_request_renderer.js',
};

/**
 * Get module path from registry
 * 
 * @param {string} moduleName - Module name (e.g., 'connection')
 * @returns {string|null} Module path or null if not found
 */
export function getModulePath(moduleName) {
  return MODULE_REGISTRY[moduleName] || null;
}

/**
 * Get all registered module names
 * 
 * @returns {string[]} Array of module names
 */
export function getAllModuleNames() {
  return Object.keys(MODULE_REGISTRY);
}

/**
 * Check if module is registered
 * 
 * @param {string} moduleName - Module name to check
 * @returns {boolean} True if module is registered
 */
export function isModuleRegistered(moduleName) {
  return moduleName in MODULE_REGISTRY;
}
