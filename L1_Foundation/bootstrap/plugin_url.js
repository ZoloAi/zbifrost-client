/**
 * L1_Foundation/bootstrap/plugin_url.js
 *
 * SSOT for the `&.` client-plugin URL grammar.
 *
 * Both consumers of `&.` plugin refs — asset_loader's zScripts (<script> tags)
 * and button_renderer's this-bound click actions (dynamic import()) — resolve
 * dot-segments to nested folders under the app's canonical /plugins/ root:
 *
 *   &.confetti          → /plugins/confetti.js
 *   &.demos.confetti    → /plugins/demos/confetti.js
 *
 * Plugins are ALWAYS served by the app's own server, never the CDN the client
 * bundle ships from. resolvePluginUrl() therefore returns an ABSOLUTE
 * page-origin URL: a bare root-relative specifier handed to dynamic import()
 * resolves against the importing MODULE's URL (the CDN in production) and
 * 404s — see ZoloAi/zbifrost-client#3. <script src> tags don't have that trap,
 * but both twins share this helper so the grammar can never drift again.
 */

/**
 * Resolve a `&.` plugin ref (or bare dot-path) to an absolute page-origin URL.
 *
 * @param {string} ref - "&.demos.confetti" or "demos.confetti".
 * @returns {string} e.g. "https://app.example.com/plugins/demos/confetti.js"
 */
export function resolvePluginUrl(ref) {
  const dotPath = ref.startsWith('&.') ? ref.substring(2) : ref;
  const path = dotPath.replace(/\./g, '/');
  return new URL(`/plugins/${path}.js`, window.location.origin).href;
}
