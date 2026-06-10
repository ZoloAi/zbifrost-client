/**
 * zHooks Manager — declarative, opt-in client features (SSOT registry)
 *
 * A zHook is NOT a callback (that is `registerHook(fn)`). A zHook is a *data
 * flag* that toggles a feature the client already ships — closer to WordPress
 * `add_theme_support()` than to a WooCommerce action hook. The bootstrap script
 * declares them:
 *
 *   new BifrostClient({ zHooks: { crumbs_live: true } });
 *
 * Trust: zHooks are data (booleans), never code, so they cannot inject behavior
 * into the page — they only switch on capabilities the audited client owns. A
 * deployment (or the server) can therefore reason about exactly what is enabled.
 *
 * Adding a feature: register its module path below and ship a module that
 * exports `activate(client)`. Nothing else in the core needs to change.
 *
 * @module L2_Handling/zhooks/zhooks_manager
 * @layer 2 (Handling)
 */

// name → module path (resolved against the client BASE_URL at load time).
// SSOT for the set of module zHooks (opt-in, dynamically imported features).
const ZHOOK_REGISTRY = {
  crumbs_live: 'L2_Handling/zhooks/features/crumbs_live.js',
};

// Core zHooks are gated where they live in the client (not imported as modules)
// — typically default-ON chrome with opt-out, e.g. the connection badge handled
// in zvaf_manager. Listed here only so explicit toggles aren't flagged unknown.
const CORE_ZHOOKS = new Set(['badge']);

/**
 * Activate every enabled zHook declared in the config.
 * @param {Object} client - the BifrostCore instance
 * @param {Object} config - { <featureName>: true|false }
 * @param {string} baseUrl - client BASE_URL for dynamic feature import
 */
export async function activateZHooks(client, config, baseUrl) {
  if (!config || typeof config !== 'object') return;
  const logger = client.logger || console;

  for (const [name, enabled] of Object.entries(config)) {
    if (!enabled) continue;
    // Core zHooks are gated in-core (e.g. badge in zvaf_manager) — not imported.
    if (CORE_ZHOOKS.has(name)) continue;
    const path = ZHOOK_REGISTRY[name];
    if (!path) {
      logger.warn(`[zHooks] Unknown zHook "${name}" — ignored. Known: ${[...Object.keys(ZHOOK_REGISTRY), ...CORE_ZHOOKS].join(', ')}`);
      continue;
    }
    try {
      const mod = await import(`${baseUrl}${path}`);
      if (typeof mod.activate !== 'function') {
        logger.error(`[zHooks] Feature "${name}" has no activate(client) export`);
        continue;
      }
      mod.activate(client);
      logger.debug(`[zHooks] Activated: ${name}`);
    } catch (err) {
      logger.error(`[zHooks] Failed to activate "${name}":`, err);
    }
  }
}
