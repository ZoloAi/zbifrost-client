/**
 * Runs automatically after `npm publish` (postpublish hook).
 *
 * 1. Purges the jsDelivr floating @1 URLs so the new release propagates
 *    immediately instead of waiting out the CDN cache. Only the files served
 *    off the floating channel need purging; pinned @1.7.x URLs are new paths
 *    and are never stale. (bifrost_core.js is included while the zOS/zGuard
 *    side still floats the core on @1 — harmless once the server pins it.)
 * 2. Prints the pin line for the zOS-side core-URL pin file.
 */
const PKG = '@zolomedia/bifrost-client';
const FLOATING_FILES = ['bifrost_client.js', 'bifrost_core.js', 'zSys/theme/zbase.css'];

const version = process.env.npm_package_version;

for (const file of FLOATING_FILES) {
  const url = `https://purge.jsdelivr.net/npm/${PKG}@1/${file}`;
  try {
    const res = await fetch(url);
    console.log(`[postpublish] purge ${file}: ${res.status}`);
  } catch (err) {
    console.warn(`[postpublish] purge ${file} failed (non-fatal): ${err.message}`);
  }
}

console.log('');
console.log(`[postpublish] zOS core pin line (update the pin file):`);
console.log(`  ${PKG}@${version}/bifrost_core.js`);
