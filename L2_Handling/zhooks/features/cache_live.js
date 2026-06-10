/**
 * zHook: cache_live — live cache inspector (INTERNAL DEV TOOL)
 *
 * A self-contained zHook. Enable from the bootstrap with:
 *
 *   new BifrostClient({ zHooks: { cache_live: true } });
 *
 * Renders a full-width amber dev panel (top of viewport) that surfaces BOTH
 * sides of the caching system so we can dogfood it:
 *   - Frontend: the client CacheOrchestrator tiers (system / pinned / plugin /
 *     session / rendered). "rendered" is the block/page cache.
 *   - Backend: the server zLoader cache (system / pinned / schema / plugin),
 *     echoed over the live socket via &zdebug.cache().
 *
 * It also writes a server-side zCache.log (sibling to zNav.log) so a run's cache
 * behaviour is legible after the fact. Controls let us clear tiers for testing.
 *
 * Like crumbs_live this is a dev tool — it depends on plugins/zdebug.py and is a
 * safe no-op where that plugin is absent. Both will later be refined for users
 * or dropped from zHooks; for now they are dogfood instruments.
 *
 * @module L2_Handling/zhooks/features/cache_live
 * @layer 2 (Handling)
 */

const STYLE_ID = 'zhook-cache-live-style';
const EL_TAG = 'zCache_Debugging';

// Amber / warning dev palette — deliberately loud so it reads as "not product".
const CSS = `
${EL_TAG} {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 99998;
  box-sizing: border-box; max-height: 42vh; overflow: auto;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: repeating-linear-gradient(45deg, rgba(60,42,0,.96), rgba(60,42,0,.96) 14px, rgba(72,50,0,.96) 14px, rgba(72,50,0,.96) 28px);
  color: #ffe08a; border-top: 2px solid #ffb300;
  padding: 6px 12px 8px; box-shadow: 0 -4px 18px rgba(0,0,0,.4);
}
${EL_TAG} .zcl-title {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  color: #ffd24d; font-weight: 700; letter-spacing: .04em; margin-bottom: 4px;
}
${EL_TAG} .zcl-title .zcl-tag { color: #ff8f00; }
${EL_TAG} .zcl-spacer { flex: 1 1 auto; }
${EL_TAG} button {
  cursor: pointer; font: inherit; font-weight: 700; line-height: 1;
  color: #2a1d00; background: #ffb300; border: 1px solid #ffce5a;
  border-radius: 5px; padding: 3px 9px;
}
${EL_TAG} button:hover { background: #ffc740; }
${EL_TAG} button.zcl-ghost { color: #ffd24d; background: rgba(255,179,0,.12); border-color: #7a5a00; }
${EL_TAG} .zcl-cols { display: flex; gap: 24px; flex-wrap: wrap; }
${EL_TAG} .zcl-col { min-width: 220px; }
${EL_TAG} .zcl-head { color: #ff8f00; font-weight: 700; margin-bottom: 2px; }
${EL_TAG} .zcl-row { color: #ffe9b0; white-space: pre; }
${EL_TAG} .zcl-key { color: #ffd24d; }
${EL_TAG} .zcl-empty { color: #b89a5a; font-style: italic; }
${EL_TAG} .zcl-meta { color: #b89a5a; font-size: 10px; margin-top: 4px; }
${EL_TAG}.zcl-collapsed { max-height: none; overflow: visible; }
${EL_TAG}.zcl-collapsed .zcl-body { display: none; }
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function ensureElement() {
  let el = document.querySelector(EL_TAG);
  if (!el) {
    el = document.createElement(EL_TAG);
    document.body.appendChild(el);
  }
  return el;
}

// Reduce a tier's getStats() result to a short, readable count line.
function summarize(stats) {
  if (stats == null) return '—';
  if (typeof stats === 'number') return String(stats);
  if (typeof stats !== 'object') return String(stats);
  // Prefer an explicit count-ish field; else count own keys.
  for (const k of ['count', 'size', 'entries', 'length']) {
    if (typeof stats[k] === 'number') return `${stats[k]}`;
  }
  const keys = Object.keys(stats);
  return keys.length ? `${keys.length} keys` : 'empty';
}

function renderTiers(stats) {
  if (!stats || typeof stats !== 'object' || !Object.keys(stats).length) {
    return '<span class="zcl-empty">— none —</span>';
  }
  return Object.keys(stats).map(function (tier) {
    return '<div class="zcl-row"><span class="zcl-key">' + tier + '</span>: ' + summarize(stats[tier]) + '</div>';
  }).join('');
}

export function activate(client) {
  injectStyle();
  const el = ensureElement();

  const TAG = 'zCACHE-DBG';
  const STY = 'color:#ffb300;font-weight:700';
  let collapsed = localStorage.getItem('zclCollapsed') === '1';
  let feStats = null;
  let beStats = null;
  let lastSentFe = null; // dedupe: only echo to the server when FE stats change
  function log(...args) { console.log('%c' + TAG, STY, ...args); }

  function render() {
    el.classList.toggle('zcl-collapsed', collapsed);
    const head = '<div class="zcl-title">'
      + '<span class="zcl-tag">⚠ zCache</span> · live (dev)'
      + '<span class="zcl-spacer"></span>'
      + '<button data-act="refresh" class="zcl-ghost" type="button">refresh</button>'
      + '<button data-act="clear-blocks" type="button">clear blocks</button>'
      + '<button data-act="clear-fe" type="button">clear FE</button>'
      + '<button data-act="clear-be" type="button">clear BE</button>'
      + '<button data-act="toggle" class="zcl-ghost" type="button">' + (collapsed ? '+' : '–') + '</button>'
      + '</div>';
    const body = '<div class="zcl-body"><div class="zcl-cols">'
      + '<div class="zcl-col"><div class="zcl-head">frontend · client tiers</div>' + renderTiers(feStats) + '</div>'
      + '<div class="zcl-col"><div class="zcl-head">backend · zLoader</div>' + renderTiers(beStats) + '</div>'
      + '</div><div class="zcl-meta">FE: client CacheOrchestrator · BE: server zLoader (echoed via &zdebug.cache) · logged to zCache.log</div></div>';
    el.innerHTML = head + body;
  }

  // ── frontend stats ────────────────────────────────────────────────────────
  async function pollFrontend() {
    try {
      if (client.cache && typeof client.cache.getStats === 'function') {
        feStats = await client.cache.getStats();
      }
    } catch (e) { log('FE getStats error →', e); }
  }

  // ── backend echo + log via &zdebug.cache(action, payload) ──────────────────
  function sendBackend(action) {
    const conn = client && client.connection;
    if (!conn || typeof conn.send !== 'function') return;
    installWrap();
    try {
      const payload = JSON.stringify(feStats || {});
      const a = [JSON.stringify(String(action || 'report')), JSON.stringify(payload)];
      conn.send(JSON.stringify({
        event: 'execute_zfunc',
        zfunc: '&zdebug.cache(' + a.join(', ') + ')',
        requestId: 'zdebug-cache-' + Date.now()
      }));
    } catch (e) { /* not connected yet */ }
  }

  // Claim only our own reply prefix; pass everything else to the prior handler.
  function installWrap() {
    if (!client || !client.hooks || !client.hooks.hooks) return false;
    const orig = client.hooks.hooks.onZFuncResponse;
    if (orig && orig._zCacheWrapped) return true;
    const wrapped = function (msg) {
      const rid = (msg && typeof msg.requestId === 'string') ? msg.requestId : '';
      if (rid.indexOf('zdebug-cache') === 0) {
        if (msg.success) { beStats = msg.result; render(); }
        else { log('backend poll error →', msg.error); }
        return; // claimed
      }
      if (typeof orig === 'function') return orig(msg);
    };
    wrapped._zCacheWrapped = true;
    client.hooks.hooks.onZFuncResponse = wrapped;
    return true;
  }

  // The real BE cache events stream straight to zCache.log via the server-side
  // logging tap, so the panel no longer needs to poll on a blind timer. We only
  // echo to the server when the FE stats actually change — that kills the 2s
  // identical-payload spam while still refreshing BE counts on real activity.
  async function tick(force) {
    await pollFrontend();
    render();
    const sig = JSON.stringify(feStats || {});
    if (force || sig !== lastSentFe) {
      lastSentFe = sig;
      sendBackend('report');
    }
  }

  // Delegated controls — survive innerHTML rebuilds.
  el.addEventListener('click', async function (e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'toggle') {
      collapsed = !collapsed;
      localStorage.setItem('zclCollapsed', collapsed ? '1' : '0');
      render();
      return;
    }
    if (act === 'refresh') { tick(true); return; }
    if (act === 'clear-blocks') {
      try { await client.cache.clear('rendered'); log('cleared FE rendered (blocks)'); } catch (err) { log('clear blocks error →', err); }
      tick();
      return;
    }
    if (act === 'clear-fe') {
      try { await client.cache.clearAll(); log('cleared FE all tiers'); } catch (err) { log('clear FE error →', err); }
      tick();
      return;
    }
    if (act === 'clear-be') { sendBackend('clear'); log('requested BE clear'); return; }
  });

  render();

  // Setup loop: wait for the socket, install the reply wrap, then poll on an
  // interval (cache state drifts over time, unlike event-driven crumbs).
  const setup = setInterval(function () {
    if (installWrap()) {
      clearInterval(setup);
      tick(true);                  // first paint always echoes once
      setInterval(tick, 2000);     // subsequent ticks only echo on FE change
    }
  }, 300);

  log('cache inspector armed — FE tiers + BE zLoader echo → zCache.log');
}
